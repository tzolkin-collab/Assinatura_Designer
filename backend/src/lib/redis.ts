import Redis from 'ioredis';
import { config } from '../config.js';
import type { DesignPage } from './designTypes.js';
import type { FabricaQuestion, ReviewMode, SessionPhase, WorkerStatus } from './fabricaSession.js';

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

redis.on('error', (err) => console.error('[Redis]', err.message));
redis.on('reconnecting', () => console.log('[Redis] Reconectando...'));
redis.on('connect', () => console.log('[Redis] Conectado'));

// ── TTLs ──────────────────────────────────────────────────────────────────────
const SESSION_TTL = 60 * 60 * 24;      // 24h
const RECENT_TTL  = 60 * 60 * 2;       // 2h  (hot cache para reabertura rápida)

// ── Keys ──────────────────────────────────────────────────────────────────────
const sessionKey  = (id: string) => `fabrica:session:${id}`;
const memBrandKey = (slug: string) => `fabrica:memory:brand:${slug}`;
const memUserKey  = (uid: string)  => `fabrica:memory:user:${uid}`;
const recentKey   = (id: string)   => `fabrica:recent:${id}`;

// ── Types ─────────────────────────────────────────────────────────────────────

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatAttachment {
  name: string;
  mimeType: string;
  dataBase64: string;
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
  phase: SessionPhase;
  reviewMode: ReviewMode;
  activeQuestion?: FabricaQuestion | null;
  messages: ChatMessage[];
  currentDesign: DesignPage[];
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

export async function createSession(
  sessionId: string,
  brandSlug: string,
  userId?: string,
  reviewMode: ReviewMode = 'manual',
): Promise<FabricaSession> {
  const now = Date.now();
  const session: FabricaSession = {
    id: sessionId,
    userId,
    brandSlug,
    phase: 'listening',
    reviewMode,
    activeQuestion: null,
    messages: [],
    currentDesign: [],
    workerStatus: 'idle',
    createdAt: now,
    updatedAt: now,
  };
  await redis.setex(sessionKey(sessionId), SESSION_TTL, JSON.stringify(session));
  return session;
}

export async function getSession(sessionId: string): Promise<FabricaSession | null> {
  const raw = await redis.get(sessionKey(sessionId));
  if (!raw) return null;
  await redis.expire(sessionKey(sessionId), SESSION_TTL);
  return JSON.parse(raw) as FabricaSession;
}

export async function updateSession(
  sessionId: string,
  patch: Partial<FabricaSession>,
): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) return;
  const updated = { ...session, ...patch, updatedAt: Date.now() };
  await redis.setex(sessionKey(sessionId), SESSION_TTL, JSON.stringify(updated));
  // Atualiza hot cache (últimas 2h para reabertura rápida de aba)
  await redis.setex(recentKey(sessionId), RECENT_TTL, JSON.stringify(updated));
}

export async function appendMessage(sessionId: string, msg: ChatMessage): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) return;
  session.messages.push(msg);
  await updateSession(sessionId, { messages: session.messages });
}

export async function getRecentSession(sessionId: string): Promise<FabricaSession | null> {
  const raw = await redis.get(recentKey(sessionId));
  if (!raw) return null;
  return JSON.parse(raw) as FabricaSession;
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
