import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { config } from '../config.js';
import type { FabricaQuestion, ReviewMode, SessionPhase, WorkerStatus } from './fabricaSession.js';
import { logger } from './logger.js';

export const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 5,
  connectTimeout: 10000,
  // TCP keepalive — previne ECONNRESET por idle em hosts gerenciados
  keepAlive: 10000,
  // Backoff exponencial com teto de 3s
  retryStrategy: (times) => {
    if (times > 20) return null;
    return Math.min(times * 150, 3000);
  },
  // Re-conecta automaticamente em erros de rede transitórios
  reconnectOnError: (err) => {
    const resetErrors = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'];
    return resetErrors.some(code => err.message.includes(code));
  },
});

redis.on('error', (err) => logger.error('Redis com erro', { error: err.message }));
redis.on('reconnecting', () => logger.warn('Redis reconectando'));
redis.on('connect', () => logger.info('Redis conectado'));

// ── TTLs ──────────────────────────────────────────────────────────────────────
const SESSION_TTL = 60 * 60 * 24;      // 24h
const RECENT_TTL  = 60 * 60 * 2;       // 2h  (hot cache para reabertura rápida)

// ── Keys ──────────────────────────────────────────────────────────────────────
//
// A sessão vivia numa ÚNICA key: um JSON com metadados + histórico de mensagens
// (com anexos em base64) + o currentDesign inteiro. Num deck de 200 slides o design
// passa de 2MB, e CADA mensagem de chat fazia GET+SETEX do blob todo — duas vezes,
// porque o "recent" era uma cópia integral. Ou seja, ~5MB de tráfego e re-serialização
// para gravar uma frase, tudo serializado por um lock: era esse o gargalo em decks
// longos.
//
// Agora a sessão são três keys, e cada escrita toca só o que mudou:
//   :meta     HASH   — campos escalares (fase, status, pergunta ativa...). Bytes.
//   :messages LIST   — RPUSH por mensagem: O(1) e não reescreve o histórico.
//   :design   STRING — o design, gravado só quando o design muda.
//
// O sufixo v2 é de propósito: as sessões antigas (JSON string na key antiga) têm tipo
// incompatível com HASH e dariam WRONGTYPE. Assim elas simplesmente expiram sozinhas.
const sessionMetaKey = (id: string) => `fabrica:session:v2:${id}:meta`;
const sessionMsgsKey = (id: string) => `fabrica:session:v2:${id}:messages`;
const sessionDesignKey = (id: string) => `fabrica:session:v2:${id}:design`;
const memBrandKey = (slug: string) => `fabrica:memory:brand:${slug}`;
const memUserKey  = (uid: string)  => `fabrica:memory:user:${uid}`;
/** Marcador de "esteve ativa" — não é mais uma CÓPIA da sessão, só uma bandeira. */
const recentKey   = (id: string)   => `fabrica:recent:v2:${id}`;

// ── Types ─────────────────────────────────────────────────────────────────────

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatAttachment {
  name: string;
  mimeType: string;
  dataBase64: string;
  /** URL pública no R2, preenchida ao receber o anexo (ver brain/index.ts). Permite
   *  reaproveitar a imagem na geração (embutida no deck) sem carregar o base64
   *  de volta — antes o anexo só existia como base64 e nunca saía do chat. */
  url?: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  timestamp: number;
  attachments?: ChatAttachment[];
  toolCall?: { name: string; args: object };
}

export interface FabricaSession {
  id: string;
  userId?: string;
  brandSlug: string;
  /**
   * Pasta de destino do deck que esta sessão vai gerar. É a sessão que carrega isto
   * porque o Post só nasce lá no fim do pipeline — e sem um destino combinado ANTES,
   * o deck caía solto na raiz e o usuário tinha de ir caçá-lo na galeria.
   * `null`/ausente = raiz (sem pasta), que continua sendo o default.
   */
  folderId?: string | null;
  phase: SessionPhase;
  reviewMode: ReviewMode;
  /** Último progresso emitido. Persistido de propósito: `ws.progress` é
   *  fire-and-forget para socket ABERTO — quem estava desconectado (troca de
   *  aba, wifi, restart do backend) perdia os eventos e, ao reconectar, via
   *  "Preparando… · 0%" enquanto a geração ia no slide 5 de 7. Guardado aqui,
   *  o `session:state` do reconnect devolve o estado real. */
  progress?: number;
  progressLabel?: string;
  activeQuestion?: FabricaQuestion | null;
  /**
   * Roteiro aguardando aprovação (fluxo copy-first): o brain planeja ANTES de
   * gerar quando há copy oficial, mostra a estrutura no chat e só enfileira o
   * pipeline depois do "aprovar". Estrutural (não importa o tipo do planner)
   * para não acoplar o Redis aos agents.
   */
  pendingPlan?: {
    format: 'presentation' | 'carousel';
    /** Proporção pedida pro Design (1:1 default) — apresentação ignora, sempre 16:9. */
    aspectRatio?: string;
    skeleton: Array<{ title: string; goal: string; layout_type: string; order: number; copy?: string }>;
    sourceCopy?: string;
    brief: string;
  } | null;
  /**
   * Pausa estratégica (Amostra de Estilo): o pipeline gera apenas o slide 0 e
   * pausa aguardando o usuário aprovar o estilo visual antes de continuar.
   */
  pendingStyleProof?: {
    format: 'presentation' | 'carousel';
    aspectRatio?: string;
    postId: string;
    skeleton: Array<{ title: string; goal: string; layout_type: string; order: number; copy?: string }>;
    brief: string;
    sourceCopy?: string;
  } | null;
  /**
   * Bundle de reaproveitamento "meio-termo" da Biblioteca de Mídia: a IA achou um
   * asset que talvez sirva mas não tem certeza — em vez de decidir sozinha, o
   * pipeline pausa e mostra o(s) candidato(s) pro usuário aprovar ou pedir pra
   * gerar do zero. `enrichedSkeleton` já traz as imagens NÃO-ambíguas resolvidas
   * (mesmo shape que SlideSkeletonItem, com imageUrl/svgMarkup quando aplicável).
   */
  pendingImageCandidates?: {
    format: 'presentation' | 'carousel';
    aspectRatio?: string;
    postId: string;
    enrichedSkeleton: Array<{
      title: string; goal: string; layout_type: string; order: number;
      copy?: string; imageHint?: string; imageUrl?: string; svgMarkup?: string;
    }>;
    candidates: Array<{ slideIndex: number; hint: string; assetUrl: string; assetName: string }>;
    brief: string;
    sourceCopy?: string;
  } | null;
  /**
   * Resultado do último review automático, guardado pelo pipeline para o
   * `review:decline` virar um [EDIT] cirúrgico (só os slides com deviation) em vez
   * de regenerar o deck inteiro. Limpo pelo brain no approve/decline.
   * Estrutural (não importa o tipo do reviewer) para não acoplar o Redis aos agents.
   */
  pendingReview?: {
    score: number;
    feedback: string;
    deviations: Array<{
      type?: string;
      severity?: string;
      slideIndex: number;
      description?: string;
      fix?: string;
    }>;
  } | null;
  messages: ChatMessage[];
  currentDesign: unknown[];
  workerStatus: WorkerStatus;
  createdAt: number;
  updatedAt: number;
}

export interface BrandMemory {
  brandSlug: string;
  brandVoice?: string;
  pastPresentations: Array<{ id: string; title: string; templateIds: string[]; createdAt: number }>;
  preferences: Record<string, unknown>;
  updatedAt: number;
}

export interface UserMemory {
  userId: string;
  recentBrands: string[];
  preferences: Record<string, unknown>;
  updatedAt: number;
}

// ── Session ───────────────────────────────────────────────────────────────────

/** Campos escalares da sessão (tudo menos `messages` e `currentDesign`). */
type SessionMeta = Omit<FabricaSession, 'messages' | 'currentDesign'>;

/** Serializa os escalares para o HASH. `undefined` não vai (Redis não tem nulo). */
function metaToHash(meta: Partial<SessionMeta>): Record<string, string> {
  const hash: Record<string, string> = {};
  for (const [campo, valor] of Object.entries(meta)) {
    if (valor === undefined) continue;
    // Objetos (activeQuestion) e escalares viram JSON: a volta é um JSON.parse só.
    hash[campo] = JSON.stringify(valor);
  }
  return hash;
}

function hashToMeta(hash: Record<string, string>): SessionMeta {
  const meta: Record<string, unknown> = {};
  for (const [campo, valor] of Object.entries(hash)) {
    try {
      meta[campo] = JSON.parse(valor);
    } catch {
      meta[campo] = valor; // não deveria acontecer; melhor devolver cru do que quebrar
    }
  }
  return meta as SessionMeta;
}

export async function createSession(
  sessionId: string,
  brandSlug: string,
  userId?: string,
  reviewMode: ReviewMode = 'manual',
  folderId?: string | null,
): Promise<FabricaSession> {
  const now = Date.now();
  const session: FabricaSession = {
    id: sessionId,
    userId,
    brandSlug,
    folderId: folderId ?? null,
    phase: 'listening',
    reviewMode,
    activeQuestion: null,
    pendingReview: null,
    pendingPlan: null,
    pendingStyleProof: null,
    pendingImageCandidates: null,
    messages: [],
    currentDesign: [],
    workerStatus: 'idle',
    createdAt: now,
    updatedAt: now,
  };

  const { messages: _m, currentDesign: _d, ...meta } = session;

  await redis
    .multi()
    .del(sessionMsgsKey(sessionId), sessionDesignKey(sessionId)) // sessão nova nasce limpa
    .hset(sessionMetaKey(sessionId), metaToHash(meta))
    .expire(sessionMetaKey(sessionId), SESSION_TTL)
    .setex(recentKey(sessionId), RECENT_TTL, '1')
    .exec();

  return session;
}

export async function getSession(sessionId: string): Promise<FabricaSession | null> {
  // UMA ida ao Redis: lê as três partes e já renova os TTLs no mesmo pacote. O Redis
  // costuma ser remoto (~120ms de ida e volta), então round-trip é o custo dominante —
  // ler e depois renovar em chamadas separadas dobrava a latência de cada leitura.
  const resultados = await redis
    .multi()
    .hgetall(sessionMetaKey(sessionId))
    .lrange(sessionMsgsKey(sessionId), 0, -1)
    .get(sessionDesignKey(sessionId))
    .expire(sessionMetaKey(sessionId), SESSION_TTL)
    .expire(sessionMsgsKey(sessionId), SESSION_TTL)
    .expire(sessionDesignKey(sessionId), SESSION_TTL)
    .setex(recentKey(sessionId), RECENT_TTL, '1')
    .exec();

  if (!resultados) return null;

  const hash = (resultados[0]?.[1] ?? {}) as Record<string, string>;
  if (Object.keys(hash).length === 0) return null; // sessão não existe (ou expirou)

  const mensagensCruas = (resultados[1]?.[1] ?? []) as string[];
  const designCru = resultados[2]?.[1] as string | null;

  return {
    ...hashToMeta(hash),
    messages: mensagensCruas.map((raw) => JSON.parse(raw) as ChatMessage),
    currentDesign: designCru ? (JSON.parse(designCru) as unknown[]) : [],
  };
}

// ── Lock por-sessão (serializa read-modify-write) ─────────────────────────────
// O brain (handler WS) e o pipeline (worker) mutam a MESMA sessão em paralelo.
// Sem serialização, dois get→merge→setex concorrentes se sobrescrevem (lost
// update: uma mensagem ou o currentDesign somem). Duas camadas:
//  1. cadeia in-process por sessionId (barato, evita contenção no mesmo processo);
//  2. lock distribuído no Redis (cobre worker em processo separado).
// O lock Redis é FAIL-OPEN: se o Redis não coopera, seguimos sem ele em vez de
// travar o app; TTL curto evita deadlock se um processo morrer segurando o lock.
const sessionChains = new Map<string, Promise<unknown>>();

const LOCK_TTL_MS = 5000;
const LOCK_WAIT_MS = 3000;
const RELEASE_LUA = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function acquireRedisLock(key: string, token: string): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < LOCK_WAIT_MS) {
    const ok = await redis.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
    if (ok === 'OK') return true;
    await sleep(15 + Math.floor(Math.random() * 25));
  }
  return false;
}

async function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionChains.get(sessionId) ?? Promise.resolve();
  const run = prev.then(async () => {
    const lockKey = `lock:fabrica:session:${sessionId}`;
    const token = randomUUID();
    let locked = false;
    try { locked = await acquireRedisLock(lockKey, token); } catch { locked = false; }
    try {
      return await fn();
    } finally {
      if (locked) {
        try { await redis.eval(RELEASE_LUA, 1, lockKey, token); } catch { /* TTL expira sozinho */ }
      }
    }
  });
  // Guarda para uma rejeição não envenenar quem estiver na fila atrás.
  const guarded = run.then(() => undefined, () => undefined);
  sessionChains.set(sessionId, guarded);
  try {
    return await run;
  } finally {
    // Solta a entrada quando ninguém mais está enfileirado (evita crescimento).
    if (sessionChains.get(sessionId) === guarded) sessionChains.delete(sessionId);
  }
}

/**
 * Aplica só o que veio no patch, na key certa.
 *
 * Continua sob o lock, mas por um motivo diferente do de antes: as escritas em si
 * já não são mais read-modify-write (HSET troca campo, SET troca o design), então o
 * lost update daquele desenho sumiu. O lock permanece porque um patch de sessão
 * INTEIRA (o brain, ao recuperar uma sessão do Post) reescreve as três keys, e isso
 * não pode entrelaçar com um append de mensagem no meio.
 */
export async function updateSession(
  sessionId: string,
  patch: Partial<FabricaSession>,
): Promise<void> {
  await withSessionLock(sessionId, async () => {
    const existe = await redis.exists(sessionMetaKey(sessionId));
    if (!existe) return; // não ressuscita sessão expirada com um patch parcial

    const { messages, currentDesign, ...meta } = patch;
    const tx = redis.multi();

    tx.hset(sessionMetaKey(sessionId), metaToHash({ ...meta, updatedAt: Date.now() }));

    // O design só é reescrito quando o design muda — antes ele era re-serializado a
    // cada troca de fase, a cada mensagem, a cada tudo.
    if (currentDesign !== undefined) {
      tx.setex(sessionDesignKey(sessionId), SESSION_TTL, JSON.stringify(currentDesign));
    }

    // Patch com o histórico inteiro só acontece na recuperação de sessão a partir do
    // Post; aí sim a lista é trocada por completo.
    if (messages !== undefined) {
      tx.del(sessionMsgsKey(sessionId));
      if (messages.length > 0) {
        tx.rpush(sessionMsgsKey(sessionId), ...messages.map((m) => JSON.stringify(m)));
      }
    }

    tx.expire(sessionMetaKey(sessionId), SESSION_TTL);
    tx.expire(sessionMsgsKey(sessionId), SESSION_TTL);
    tx.expire(sessionDesignKey(sessionId), SESSION_TTL);
    tx.setex(recentKey(sessionId), RECENT_TTL, '1');

    await tx.exec();
  });
}

/**
 * Append da mensagem em UMA ida ao Redis, via Lua.
 *
 * Antes: lia a sessão inteira (design de MBs junto), dava push no array em memória e
 * reescrevia tudo — duas vezes, por causa do "recent". Uma frase no chat custava
 * megabytes. Agora é um RPUSH O(1) que não toca no histórico nem no design.
 *
 * O Lua serve para checar a existência da sessão e escrever no MESMO round-trip: um
 * `EXISTS` antes dobraria a latência (o Redis é remoto) e ainda deixaria uma janela em
 * que a sessão expira entre a checagem e a escrita — o RPUSH recriaria a lista órfã,
 * sem meta e sem TTL, e ela viveria para sempre.
 */
const APPEND_MESSAGE_LUA = `
if redis.call('exists', KEYS[1]) == 0 then return 0 end
redis.call('rpush', KEYS[2], ARGV[1])
redis.call('hset', KEYS[1], 'updatedAt', ARGV[2])
redis.call('expire', KEYS[1], ARGV[3])
redis.call('expire', KEYS[2], ARGV[3])
redis.call('setex', KEYS[3], ARGV[4], '1')
return 1
`;

export async function appendMessage(sessionId: string, msg: ChatMessage): Promise<void> {
  await redis.eval(
    APPEND_MESSAGE_LUA,
    3,
    sessionMetaKey(sessionId),
    sessionMsgsKey(sessionId),
    recentKey(sessionId),
    JSON.stringify(msg),
    JSON.stringify(Date.now()), // o meta guarda JSON; number cru quebraria o parse na volta
    String(SESSION_TTL),
    String(RECENT_TTL),
  );
}

/**
 * "Esteve ativa nas últimas 2h?" O `recent` era uma CÓPIA integral da sessão (o dobro
 * de escrita a cada update, design junto). Agora é só uma bandeira com TTL; os dados
 * vêm da própria sessão.
 */
export async function getRecentSession(sessionId: string): Promise<FabricaSession | null> {
  const recente = await redis.exists(recentKey(sessionId));
  if (!recente) return null;
  return getSession(sessionId);
}

// ── Brand Memory ──────────────────────────────────────────────────────────────

export async function getBrandMemory(brandSlug: string): Promise<BrandMemory> {
  const raw = await redis.get(memBrandKey(brandSlug));
  if (raw) return JSON.parse(raw) as BrandMemory;
  return { brandSlug, pastPresentations: [], preferences: {}, updatedAt: Date.now() };
}

export async function updateBrandMemory(
  brandSlug: string,
  patch: Partial<BrandMemory>,
): Promise<void> {
  const mem = await getBrandMemory(brandSlug);
  await redis.set(memBrandKey(brandSlug), JSON.stringify({ ...mem, ...patch, updatedAt: Date.now() }));
}

// ── User Memory ───────────────────────────────────────────────────────────────

export async function getUserMemory(userId: string): Promise<UserMemory> {
  const raw = await redis.get(memUserKey(userId));
  if (raw) return JSON.parse(raw) as UserMemory;
  return { userId, recentBrands: [], preferences: {}, updatedAt: Date.now() };
}

export async function updateUserMemory(
  userId: string,
  patch: Partial<UserMemory>,
): Promise<void> {
  const mem = await getUserMemory(userId);
  await redis.set(memUserKey(userId), JSON.stringify({ ...mem, ...patch, updatedAt: Date.now() }));
}

export async function touchRecentBrand(userId: string, brandSlug: string): Promise<void> {
  const mem = await getUserMemory(userId);
  const brands = [brandSlug, ...mem.recentBrands.filter((b) => b !== brandSlug)].slice(0, 10);
  await updateUserMemory(userId, { recentBrands: brands });
}
