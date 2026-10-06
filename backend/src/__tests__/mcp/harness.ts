// Harness dos testes do conector MCP.
//
// IMPORTANTE: os arquivos de teste importam `../client` ANTES deste (ele mocka prisma e
// redis no processo de teste, ver client.ts). Aqui nada fala com infraestrutura real:
//  - Redis  → `MemoryRedis` sob o `RedisMcpStore` REAL (testa a lógica do store, não um mock dela);
//  - Prisma → um "banco" em memória atrás de `prismaMock.brandMember.findMany`/`brand.findUnique`,
//             que aplica os filtros `where` de verdade (userId, brandId in, role in, brand.slug in);
//  - Tempo  → relógio controlável, compartilhado por store e provider (expiração sem esperar).
import { createHash, randomBytes } from 'node:crypto';
import { vi } from 'vitest';
import cors from 'cors';
import express, { type Express } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { prismaMock } from '../client';
import { config as appConfig } from '../../config';
import { errorHandler } from '../../middleware/errorHandler';
import { loadMcpConfig, type McpConfig } from '../../mcp/config';
import { mountMcp } from '../../mcp';
import { DEFAULT_LIMITS, type McpLimits } from '../../mcp/limits';
import { MemoryRedis } from '../../mcp/memoryRedis';
import { RedisMcpStore } from '../../mcp/store';

export const ISSUER = 'https://api.example.test';
export const RESOURCE = `${ISSUER}/mcp`;
export const FRONTEND = 'https://app.example.test';
export const CHATGPT_REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';

export interface TestBrand {
  id: string;
  slug: string;
  name: string;
  config?: {
    colors: string[];
    primaryFonts: string[];
    guidelines: string;
    agentPrompt: string;
    logoUrl: string | null;
    presentationConfig?: Record<string, unknown> | null;
  };
}

export interface TestMembership {
  userId: string;
  brandId: string;
  role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
}

// Começa no relógio REAL: o `requireBearerAuth` do SDK confere `expiresAt` com `Date.now()`
// (não aceita relógio injetado). Os avanços (`advance`) mexem no tempo do store e do
// provider — que checam a expiração antes do SDK, então o teste de "token expirado" vale.
export function createClock(start = Date.now()) {
  let current = start;
  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    },
  };
}

/** Limites altos o bastante para os testes de fluxo nunca esbarrarem em 429 por acidente. */
function relaxedLimits(): McpLimits {
  const big = (policy: { windowSec: number }) => ({ windowSec: policy.windowSec, max: 100_000 });
  return {
    // Prefixo aleatório: o mock de Redis do client.ts guarda contadores no processo todo.
    keyPrefix: `t${randomBytes(4).toString('hex')}`,
    authorize: big(DEFAULT_LIMITS.authorize),
    token: big(DEFAULT_LIMITS.token),
    register: big(DEFAULT_LIMITS.register),
    revoke: big(DEFAULT_LIMITS.revoke),
    mcpIp: big(DEFAULT_LIMITS.mcpIp),
    mcpUser: big(DEFAULT_LIMITS.mcpUser),
    consent: big(DEFAULT_LIMITS.consent),
  };
}

export interface HarnessOptions {
  env?: Record<string, string>;
  limits?: Partial<McpLimits>;
  tools?: Parameters<typeof mountMcp>[1]['tools'];
}

export const DEFAULT_BRANDS: TestBrand[] = [
  {
    id: 'brand-a',
    slug: 'marca-a',
    name: 'Marca A',
    config: {
      colors: ['#112233', '#ffffff'],
      primaryFonts: ['Inter', 'Lora'],
      guidelines: 'Tom direto e acolhedor.',
      agentPrompt: 'SEGREDO-INTERNO-DO-PROMPT',
      logoUrl: 'https://cdn.example.test/a.svg',
      presentationConfig: { visualVibe: 'minimalista', boldness: 'balanced', allowSvgLayouts: false },
    },
  },
  {
    id: 'brand-b',
    slug: 'marca-b',
    name: 'Marca B',
    config: {
      colors: ['#ff0000'],
      primaryFonts: ['Roboto'],
      guidelines: 'Marca B é CONFIDENCIAL-DA-MARCA-B.',
      agentPrompt: '',
      logoUrl: null,
    },
  },
];

export function buildHarness(options: HarnessOptions = {}) {
  const clock = createClock();
  const redis = new MemoryRedis(clock.now);
  const store = new RedisMcpStore(redis, clock.now);

  // ── "Banco" em memória ──
  const db = {
    brands: structuredClone(DEFAULT_BRANDS) as TestBrand[],
    memberships: [] as TestMembership[],
  };

  const brandOf = (id: string) => db.brands.find((b) => b.id === id)!;

  prismaMock.brandMember.findMany.mockImplementation((async (args: {
    where: {
      userId?: string;
      brandId?: { in: string[] };
      role?: { in: string[] };
      brand?: { slug?: { in: string[] } };
    };
  }) => {
    const w = args.where;
    return db.memberships
      .filter((m) => (w.userId === undefined ? true : m.userId === w.userId))
      .filter((m) => (w.brandId?.in ? w.brandId.in.includes(m.brandId) : true))
      .filter((m) => (w.role?.in ? w.role.in.includes(m.role) : true))
      .filter((m) => (w.brand?.slug?.in ? w.brand.slug.in.includes(brandOf(m.brandId).slug) : true))
      .map((m) => {
        const b = brandOf(m.brandId);
        return { role: m.role, brand: { id: b.id, slug: b.slug, name: b.name } };
      });
  }) as never);

  // get_brand_kit usa resolveBrandContext → prisma.brand.findUnique({ where: { slug }, include })
  prismaMock.brand.findUnique.mockImplementation((async (args: { where: { slug: string } }) => {
    const b = db.brands.find((x) => x.slug === args.where.slug);
    if (!b) return null;
    return {
      id: b.id,
      slug: b.slug,
      name: b.name,
      config: b.config ?? null,
      refs: [],
      assets: [],
    };
  }) as never);

  const loaded = loadMcpConfig(
    {
      MCP_ENABLED: 'true',
      PUBLIC_BASE_URL: ISSUER,
      FRONTEND_URL: FRONTEND,
      ...options.env,
    },
    { isProduction: true },
  );
  if (!loaded.enabled) throw new Error(`harness: config MCP inválida: ${loaded.reason}`);
  const mcpConfig: McpConfig = loaded.config;

  const app: Express = express();
  app.set('trust proxy', 1);
  mountMcp(app, {
    apiCors: cors(),
    config: loaded,
    store,
    limits: { ...relaxedLimits(), ...options.limits },
    now: clock.now,
    tools: options.tools,
  });
  app.use(errorHandler);

  const sign = (userId: string) => jwt.sign({ userId, role: 'DESIGNER' }, appConfig.jwtSecret, { expiresIn: '1h' });
  const asUser = (userId: string) => ({ Authorization: `Bearer ${sign(userId)}` });

  return {
    app,
    clock,
    redis,
    store,
    db,
    config: mcpConfig,
    sign,
    asUser,
    addMember(userId: string, brandId: string, role: TestMembership['role'] = 'EDITOR') {
      db.memberships.push({ userId, brandId, role });
    },
    removeMember(userId: string, brandId: string) {
      db.memberships = db.memberships.filter((m) => !(m.userId === userId && m.brandId === brandId));
    },
    setRole(userId: string, brandId: string, role: TestMembership['role']) {
      const m = db.memberships.find((x) => x.userId === userId && x.brandId === brandId);
      if (!m) throw new Error('membership inexistente');
      m.role = role;
    },
  };
}

export type Harness = ReturnType<typeof buildHarness>;

/** Captura TUDO que o processo escreve em console (é por onde o logger estruturado sai). */
export function captureConsole() {
  const lines: string[] = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  }
  return lines;
}

// ── PKCE e fluxo OAuth ──

export function pkcePair() {
  const verifier = randomBytes(48).toString('base64url'); // 64 caracteres
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export async function registerClient(app: Express, body: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/register')
    .send({
      client_name: 'ChatGPT',
      redirect_uris: [CHATGPT_REDIRECT],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      ...body,
    });
  return res;
}

export function authorizeQuery(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  return {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CHATGPT_REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'estado-123',
    scope: 'designer.read',
    resource: RESOURCE,
    ...extra,
  };
}

export async function authorize(app: Express, query: Record<string, string>) {
  return request(app).get('/authorize').query(query);
}

/** Extrai o id do pedido do redirect para a tela de consentimento do frontend. */
export function requestIdFromLocation(location: string): string {
  const url = new URL(location);
  const id = url.searchParams.get('request');
  if (!id) throw new Error(`sem ?request= em ${location}`);
  return id;
}

export async function decide(
  h: Harness,
  requestId: string,
  userId: string,
  body: Record<string, unknown>,
) {
  return request(h.app).post(`/api/mcp/consent/${requestId}`).set(h.asUser(userId)).send(body);
}

export async function exchange(app: Express, params: Record<string, string>) {
  return request(app).post('/token').type('form').send(params);
}

/** Fluxo completo até ter tokens. Devolve tudo que os testes precisam para variar. */
export async function connect(
  h: Harness,
  opts: {
    userId?: string;
    brandSlugs?: string[];
    scope?: string;
    scopes?: string[];
    clientName?: string;
  } = {},
) {
  const userId = opts.userId ?? 'user-1';
  const reg = await registerClient(h.app, opts.clientName ? { client_name: opts.clientName } : {});
  const clientId = reg.body.client_id as string;
  const { verifier, challenge } = pkcePair();

  const auth = await authorize(h.app, authorizeQuery(clientId, challenge, { scope: opts.scope ?? 'designer.read' }));
  const requestId = requestIdFromLocation(auth.headers.location);

  const approve = await decide(h, requestId, userId, {
    decision: 'approve',
    brandSlugs: opts.brandSlugs ?? ['marca-a'],
    ...(opts.scopes ? { scopes: opts.scopes } : {}),
  });
  const redirect = new URL(approve.body.data.redirectUrl);
  const code = redirect.searchParams.get('code')!;

  const token = await exchange(h.app, {
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: CHATGPT_REDIRECT,
    resource: RESOURCE,
  });

  return { clientId, verifier, challenge, requestId, approve, code, token, accessToken: token.body.access_token as string, refreshToken: token.body.refresh_token as string, userId };
}

// ── /mcp ──

export function mcpPost(app: Express, accessToken: string | undefined, body: unknown, headers: Record<string, string> = {}) {
  const req = request(app)
    .post('/mcp')
    .set('Accept', 'application/json, text/event-stream')
    .set('Content-Type', 'application/json');
  if (accessToken) req.set('Authorization', `Bearer ${accessToken}`);
  for (const [k, v] of Object.entries(headers)) req.set(k, v);
  return req.send(body as object);
}

let rpcId = 0;
export const rpc = (method: string, params?: unknown) => ({ jsonrpc: '2.0', id: ++rpcId, method, params });
export const callTool = (name: string, args: Record<string, unknown> = {}) => rpc('tools/call', { name, arguments: args });
