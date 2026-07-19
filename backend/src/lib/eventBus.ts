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

function ensureConnections(): { sub: Redis; pub: Redis } {
  if (!sub) {
    sub = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      // Backoff exponencial com teto de 3s (mesmo padrão do client principal)
      retryStrategy: (times) => {
        if (times > 20) return null;
        return Math.min(times * 150, 3000);
      },
    });

    sub.on('error', (err) => logger.error('EventBus subscriber com erro', { error: err.message }));

    // Resubscrever patterns ativos no reconnect (Redis dropa subscriptions ao cair)
    sub.on('connect', () => {
      for (const pattern of activePatterns) {
        sub!.psubscribe(pattern).catch((e) =>
          logger.error('EventBus resubscribe falhou', { pattern, error: (e as Error).message }),
        );
      }
      logger.info('EventBus subscriber conectado', { patterns: activePatterns.size });
    });

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
      retryStrategy: (times) => {
        if (times > 20) return null;
        return Math.min(times * 150, 3000);
      },
    });
    pub.on('error', (err) => logger.error('EventBus publisher com erro', { error: err.message }));
  }

  return { sub, pub };
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
