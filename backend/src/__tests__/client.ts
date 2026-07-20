import { prisma } from '../lib/prisma';
import { beforeEach, vi } from 'vitest';

// Sem isto, os testes falam com o Redis REAL do .env: o rate limiter de verdade
// contava as requisições dos testes e, depois de algumas rodadas, começava a
// devolver 429 — teste dependendo de (e sujando) infraestrutura de produção.
// Contador em memória, zerado a cada processo de teste.
vi.mock('../lib/redis', () => {
  const contadores = new Map<string, number>();
  return {
    redis: {
      incr: vi.fn(async (key: string) => {
        const n = (contadores.get(key) ?? 0) + 1;
        contadores.set(key, n);
        return n;
      }),
      expire: vi.fn(async () => 1),
      get: vi.fn(async () => null),
      set: vi.fn(async () => 'OK'),
      del: vi.fn(async () => 1),
      quit: vi.fn(async () => 'OK'),
      incrby: vi.fn(async () => 1),
      // Contabilidade por modelo lê índices (SET) e hashes; sem registro, tudo vazio.
      smembers: vi.fn(async () => []),
      hgetall: vi.fn(async () => ({})),
      // Contadores/hashes do teto de IA usam multi(): o mock encadeia e não fala com Redis.
      multi: vi.fn(() => {
        const chain = {
          incrby: vi.fn(() => chain),
          hincrby: vi.fn(() => chain),
          sadd: vi.fn(() => chain),
          expire: vi.fn(() => chain),
          hgetall: vi.fn(() => chain),
          exec: vi.fn(async () => []),
        };
        return chain;
      }),
    },
    createSession: vi.fn(),
    getSession: vi.fn(async () => null),
    updateSession: vi.fn(),
    appendMessage: vi.fn(),
    getRecentSession: vi.fn(async () => null),
    getBrandMemory: vi.fn(async () => ({})),
    updateBrandMemory: vi.fn(),
    getUserMemory: vi.fn(async () => ({})),
    updateUserMemory: vi.fn(),
    touchRecentBrand: vi.fn(),
  };
});

vi.mock('../lib/prisma', () => {
  const prismaMock: Record<string, unknown> = {
    brand: { findUnique: vi.fn() },
    invite: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    brandMember: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    notification: { create: vi.fn() },
    asset: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    folder: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    brandConfig: { findUnique: vi.fn(), upsert: vi.fn() },
    post: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    postVersion: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    slide: { findMany: vi.fn(), update: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  };

  // O aceite de convite roda numa transação. Executamos o callback com o próprio mock,
  // então as asserções sobre user.create/brandMember.create seguem valendo dentro dela.
  prismaMock.$transaction = vi.fn((fn: (tx: unknown) => unknown) =>
    typeof fn === 'function' ? fn(prismaMock) : Promise.resolve(fn),
  );

  return {
    __esModule: true,
    prisma: prismaMock,
    default: prismaMock,
  };
});

export const prismaMock = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

beforeEach(() => {
  vi.clearAllMocks();
});
