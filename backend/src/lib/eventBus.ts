/**
 * EventBus centralizado sobre Redis Pub/Sub.
 *
 * Antes, `broadcast()` em websocket.ts iterava um `Map<string, Set<ClientMeta>>`
 * in-process: se o pipeline rodava em worker separado (outro processo), chamadas
 * como `ws.progress(sessionId, ...)` falavam para o vazio — o Map do worker não
 * tem clientes WS. Agora, todo `publish()` vai para o Redis e o subscriber local
 * distribui para os clientes WS/SSE do processo.
 *
 * Canais:
 *   `session:{sessionId}` — eventos de sessão (WS: agent:token, design:update, etc.)
 *   `job:{jobId}`         — eventos de job SSE (generation, fix)
 *
 * O subscriber roda em conexão Redis dedicada (Redis não permite pub/sub e
 * comandos regulares na mesma conexão) e reconecta automaticamente.
 */

import Redis from 'ioredis';
import { config } from '../config.js';
import { logger } from './logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BusEvent {
  /** Tipo do evento (ex: 'agent:token', 'job:progress', 'design:update') */
  type: string;
  /** Payload do evento */
  data: unknown;
}

type BusListener = (channel: string, event: BusEvent) => void;

// ── Conexão dedicada para subscriber ──────────────────────────────────────────

let sub: Redis | null = null;
let pub: Redis | null = null;

const listeners: BusListener[] = [];

// Pattern subscriptions ativas — para resubscrever no reconnect.
const activePatterns = new Set<string>();

// Backoff exponencial SEM teto de tentativas — teto de 3s no delay.
//
// Bug real observado (2026-07-20): com `times > 20 ? null : ...`, um Redis
// remoto (proxy que mata conexão ociosa) resetava a conexão (ECONNRESET)
// e, se os retries esgotassem o teto, o ioredis desistia de vez — sem log
// de erro nenhum (só o handler de 'error' via ECONNRESET, não um evento de
// "desisti"). Resultado: PUBSUB NUMPAT ficava 0 pro resto da vida do
// processo — WS parava de entregar QUALQUER evento (chat ao vivo, geração,
// reconexão) até reiniciar o servidor. EventBus é infra de longa duração;
// nunca deve desistir de reconectar sozinho.
function backoff(times: number): number {
  return Math.min(times * 150, 3000);
}

function ensureConnections(): { sub: Redis; pub: Redis } {
  if (!sub) {
    sub = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      retryStrategy: backoff,
    });

    sub.on('error', (err) => logger.error('EventBus subscriber com erro', { error: err.message }));
    sub.on('reconnecting', (delay: number) => logger.warn('EventBus subscriber reconectando', { delay }));
    sub.on('end', () => logger.error('EventBus subscriber conexão ENCERRADA — sem retry automático até o próximo psubscribeAll()'));

    // Resubscrever patterns ativos no reconnect (Redis dropa subscriptions ao cair).
    // 'ready' (não só 'connect'): é o ponto em que a conexão aceita comandos de
    // verdade — mais confiável para reemitir o psubscribe.
    sub.on('ready', () => { void psubscribeAll('reconnect (ready)'); });

    // Mensagens de pattern subscription chegam aqui
    sub.on('pmessage', (_pattern: string, channel: string, message: string) => {
      try {
        const event = JSON.parse(message) as BusEvent;
        for (const listener of listeners) {
          try {
            listener(channel, event);
          } catch (e) {
            logger.error('EventBus listener lançou exceção', { channel, error: (e as Error).message });
          }
        }
      } catch {
        // Mensagem não-JSON — ignora silenciosamente
      }
    });
  }

  if (!pub) {
    pub = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 5,
      retryStrategy: backoff,
    });
    pub.on('error', (err) => logger.error('EventBus publisher com erro', { error: err.message }));
    pub.on('reconnecting', (delay: number) => logger.warn('EventBus publisher reconectando', { delay }));
  }

  return { sub, pub };
}

async function psubscribeAll(motivo: string): Promise<void> {
  if (!sub || activePatterns.size === 0) return;
  for (const pattern of activePatterns) {
    try {
      await sub.psubscribe(pattern);
    } catch (e) {
      logger.error('EventBus resubscribe falhou', { pattern, motivo, error: (e as Error).message });
    }
  }
  logger.info('EventBus subscriber (re)inscrito', { patterns: activePatterns.size, motivo });
}

// ── Watchdog: reconciliação periódica ────────────────────────────────────────
// Rede-de-segurança contra QUALQUER forma de "inscrição perdida silenciosa"
// (o bug real acima, ou outra que apareça): confere a cada 30s se o Redis
// enxerga as inscrições que deveriam existir e reemite psubscribe se não.
// psubscribe é idempotente — reemitir sem necessidade não tem efeito colateral.
let watchdog: ReturnType<typeof setInterval> | null = null;

function startWatchdog(): void {
  if (watchdog) return;
  watchdog = setInterval(() => {
    if (!sub || sub.status !== 'ready' || activePatterns.size === 0) return;
    sub.call('PUBSUB', 'NUMPAT')
      .then((numpat) => {
        if (Number(numpat) < activePatterns.size) {
          logger.warn('EventBus watchdog: inscrição divergente do esperado — reemitindo', {
            numpatRedis: numpat,
            esperado: activePatterns.size,
          });
          void psubscribeAll('watchdog');
        }
      })
      .catch(() => { /* checagem best-effort; próximo tick tenta de novo */ });
  }, 30_000);
  watchdog.unref?.(); // não segura o processo vivo sozinho (ex.: em testes)
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Inicializa as conexões do EventBus. Chamar uma vez no boot do app.
 * É idempotente — pode chamar várias vezes sem efeito colateral.
 */
export async function initEventBus(): Promise<void> {
  const { sub: s, pub: p } = ensureConnections();
  // lazyConnect: precisa de connect() explícito
  if (s.status === 'wait') await s.connect();
  if (p.status === 'wait') await p.connect();
}

/**
 * Publica um evento num canal. Fire-and-forget (não bloqueia na resposta).
 * Se o Redis não estiver disponível, loga e segue — melhor perder um evento
 * de progresso do que travar o pipeline.
 */
export function publish(channel: string, event: BusEvent): void {
  const { pub: p } = ensureConnections();
  const payload = JSON.stringify(event);
  p.publish(channel, payload).catch((err) => {
    logger.warn('EventBus publish falhou', { channel, type: event.type, error: (err as Error).message });
  });
}

/**
 * Subscreve a um pattern de canal (ex: 'session:*' ou 'job:*').
 * Usa psubscribe para cobrir todos os sessionIds/jobIds de uma vez.
 */
export async function subscribe(pattern: string): Promise<void> {
  const { sub: s } = ensureConnections();
  activePatterns.add(pattern);
  if (s.status === 'wait') await s.connect();
  await s.psubscribe(pattern);
  startWatchdog();
}

/**
 * Registra um listener que recebe TODOS os eventos de TODOS os canais
 * subscritos. O listener decide o que fazer com base no `channel` e `event.type`.
 */
export function onEvent(listener: BusListener): void {
  listeners.push(listener);
}

/**
 * Fecha conexões do EventBus (shutdown limpo).
 */
export async function closeEventBus(): Promise<void> {
  if (watchdog) { clearInterval(watchdog); watchdog = null; }
  if (sub) {
    try { await sub.quit(); } catch { /* já desconectado */ }
    sub = null;
  }
  if (pub) {
    try { await pub.quit(); } catch { /* já desconectado */ }
    pub = null;
  }
  activePatterns.clear();
  listeners.length = 0;
}

// ── Helpers de canal ──────────────────────────────────────────────────────────

/** Canal de sessão: eventos WS para um sessionId específico. */
export const sessionChannel = (sessionId: string): string => `session:${sessionId}`;

/** Canal de job: eventos SSE para um jobId específico. */
export const jobChannel = (jobId: string): string => `job:${jobId}`;
