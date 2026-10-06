import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { McpScope } from './config.js';
import { CALL_LOG_MAX_ENTRIES, TTL } from './auth/constants.js';

/**
 * Armazenamento do OAuth do conector MCP.
 *
 * `McpOAuthStore` é a fronteira: o provedor OAuth (auth/provider.ts) e o consentimento
 * só falam com ela, nunca com Redis. Hoje há uma implementação (`RedisMcpStore`, abaixo);
 * trocar por Postgres depois significa escrever outra classe que implemente esta
 * interface — sem tocar em provider, consentimento, verifier nem ferramentas.
 *
 * Contrato que QUALQUER implementação precisa cumprir (é o que os testes de contrato
 * em __tests__/mcp/store.test.ts verificam):
 *  - toda chave de credencial chega aqui JÁ HASHEADA (SHA-256) — o store nunca vê o
 *    segredo em claro e não deve tentar reconstruí-lo;
 *  - `consume*` é ATÔMICO e de uso único: sob chamadas concorrentes, no máximo uma
 *    recebe o registro (GETDEL no Redis; `DELETE ... RETURNING` no Postgres);
 *  - `consumeAuthCode`/`consumeRefreshToken` lembram que o segredo foi consumido
 *    (tombstone) para responder `reused` com a família — é daí que sai a revogação
 *    em cascata quando alguém reapresenta um código/refresh já usado;
 *  - expiração é responsabilidade do store (TTL): registro expirado = `undefined`/`null`.
 *
 * Requisito de infra: Redis >= 6.2 (comando GETDEL).
 */

/** Pedido de autorização validado em /authorize, aguardando o usuário na tela de consentimento. */
export interface PendingAuthRequest {
  clientId: string;
  /** A redirect_uri que o cliente pediu (já conferida com as registradas). */
  redirectUri: string;
  /** S256 sempre; o método não é guardado porque não existe outro aceito. */
  codeChallenge: string;
  state?: string;
  resource: string;
  scopes: McpScope[];
  createdAt: number;
}

/** Código de autorização emitido DEPOIS do POST autenticado do usuário no consentimento. */
export interface AuthCodeRecord {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scopes: McpScope[];
  userId: string;
  brandIds: string[];
  createdAt: number;
}

/**
 * "Família" = uma concessão do usuário a um cliente (a conexão do ChatGPT). Todos os
 * access/refresh tokens emitidos a partir dela pertencem à família; revogar a família
 * invalida todos de uma vez (reuso de refresh, revogação pelo usuário, reuso de código).
 */
export interface GrantFamily {
  id: string;
  userId: string;
  clientId: string;
  /** Cópia (já limpa) do nome do cliente: o registro DCR pode expirar antes da conexão. */
  clientName: string;
  scopes: McpScope[];
  /** Marcas aprovadas no consentimento. A cada chamada cruzamos com a associação ATUAL. */
  brandIds: string[];
  resource: string;
  createdAt: number;
}

export interface AccessTokenRecord {
  familyId: string;
  scopes: McpScope[];
  /** ms desde a epoch. */
  expiresAt: number;
}

export interface RefreshTokenRecord {
  familyId: string;
  clientId: string;
}

export type ConsumeResult<T> =
  | { status: 'ok'; record: T }
  /** O segredo já foi consumido antes: reuso. `familyId` é a família a revogar. */
  | { status: 'reused'; familyId: string }
  | { status: 'missing' };

export interface McpOAuthStore {
  // ── Clientes (DCR) ──
  saveClient(client: OAuthClientInformationFull, maxClients: number): Promise<'ok' | 'limit'>;
  getClient(clientId: string): Promise<OAuthClientInformationFull | undefined>;
  /** Renova a validade do cliente (cada emissão de token). */
  touchClient(clientId: string): Promise<void>;

  // ── Pedidos de autorização (aguardando consentimento) ──
  savePendingRequest(idHash: string, request: PendingAuthRequest): Promise<void>;
  getPendingRequest(idHash: string): Promise<PendingAuthRequest | undefined>;
  /** Atômico e de uso único: só quem decide de fato recebe o pedido. */
  consumePendingRequest(idHash: string): Promise<PendingAuthRequest | undefined>;

  // ── Códigos de autorização ──
  saveAuthCode(codeHash: string, record: AuthCodeRecord): Promise<void>;
  getAuthCode(codeHash: string): Promise<AuthCodeRecord | undefined>;
  /** `familyId` é o id da família que SERÁ criada com este código — vai na tombstone. */
  consumeAuthCode(codeHash: string, familyId: string): Promise<ConsumeResult<AuthCodeRecord>>;
  /** Família associada a um código já consumido (para revogar quando ele é reapresentado). */
  findConsumedCodeFamily(codeHash: string): Promise<string | undefined>;

  // ── Famílias ──
  createFamily(family: GrantFamily): Promise<void>;
  getFamily(familyId: string): Promise<GrantFamily | undefined>;
  extendFamily(familyId: string): Promise<void>;
  /** Apaga a família: todo token dela passa a ser inválido (o verifier exige a família viva). */
  revokeFamily(familyId: string): Promise<void>;
  listFamiliesByUser(userId: string): Promise<GrantFamily[]>;

  // ── Tokens (sempre pelo hash) ──
  saveAccessToken(tokenHash: string, record: AccessTokenRecord): Promise<void>;
  getAccessToken(tokenHash: string): Promise<AccessTokenRecord | undefined>;
  saveRefreshToken(tokenHash: string, record: RefreshTokenRecord): Promise<void>;
  getRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | undefined>;
  consumeRefreshToken(tokenHash: string): Promise<ConsumeResult<RefreshTokenRecord>>;
}

/** Um evento por `tools/call`. Enxuto de propósito: SEM argumentos nem conteúdo retornado. */
export interface McpCallEvent {
  ts: string;
  userId: string;
  clientId: string;
  tool: string;
  brandSlug?: string;
  ok: boolean;
  /** Código curto do erro (ex.: `brand_unavailable`), nunca a mensagem nem o stack. */
  errorCode?: string;
  durationMs: number;
}

/** Base dos "Registros" (a API de leitura vem na próxima etapa). */
export interface McpCallLog {
  /** `scopeKey` = id da marca (ferramentas de marca) ou `user:<id>` (as que não têm marca). */
  appendCall(scopeKey: string, event: McpCallEvent): Promise<void>;
  listCalls(scopeKey: string, limit?: number): Promise<McpCallEvent[]>;
}

/**
 * Subconjunto de comandos do ioredis que o store usa. Existe como interface própria
 * para o store ser testável com uma emulação em memória (`memoryRedis.ts`) — não há
 * Redis em teste — e para deixar explícito o quão pouco do Redis dependemos
 * (nada de Lua nem de scripting: só comandos simples e atômicos por si).
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  set(key: string, value: string, mode: 'EX', seconds: number, flag: 'NX'): Promise<'OK' | null>;
  getdel(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  zadd(key: string, score: number, member: string): Promise<number | string>;
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number>;
  zcard(key: string): Promise<number>;
  lpush(key: string, ...values: string[]): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
}

const P = 'mcp:';
const key = {
  client: (id: string) => `${P}client:${id}`,
  clientIndex: `${P}clients`,
  request: (h: string) => `${P}req:${h}`,
  code: (h: string) => `${P}code:${h}`,
  codeUsed: (h: string) => `${P}code-used:${h}`,
  family: (id: string) => `${P}fam:${id}`,
  userFamilies: (userId: string) => `${P}ufam:${userId}`,
  access: (h: string) => `${P}at:${h}`,
  refresh: (h: string) => `${P}rt:${h}`,
  refreshUsed: (h: string) => `${P}rt-used:${h}`,
  calls: (scopeKey: string) => `${P}calls:${scopeKey}`,
};

function parse<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Registro corrompido vale como inexistente: o fluxo cai em "inválido", nunca em exceção.
    return undefined;
  }
}

/** Limite defensivo: client_id vem de um parâmetro de URL controlado por quem chama. */
const MAX_CLIENT_ID_LENGTH = 200;

export class RedisMcpStore implements McpOAuthStore, McpCallLog {
  constructor(
    private readonly redis: RedisLike,
    private readonly now: () => number = Date.now,
  ) {}

  // ── Clientes ──

  async saveClient(client: OAuthClientInformationFull, maxClients: number): Promise<'ok' | 'limit'> {
    // Índice com score = validade (ms): purgar o vencido antes de contar mantém o teto
    // honesto sem depender de Lua. A checagem não é atômica com o ZADD — sob corrida
    // o teto pode estourar por alguns; é um teto de higiene, não de segurança.
    await this.redis.zremrangebyscore(key.clientIndex, '-inf', this.now());
    if ((await this.redis.zcard(key.clientIndex)) >= maxClients) return 'limit';
    await this.redis.zadd(key.clientIndex, this.now() + TTL.client * 1000, client.client_id);
    await this.redis.set(key.client(client.client_id), JSON.stringify(client), 'EX', TTL.client);
    return 'ok';
  }

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    if (!clientId || clientId.length > MAX_CLIENT_ID_LENGTH) return undefined;
    return parse<OAuthClientInformationFull>(await this.redis.get(key.client(clientId)));
  }

  async touchClient(clientId: string): Promise<void> {
    if (!clientId || clientId.length > MAX_CLIENT_ID_LENGTH) return;
    if ((await this.redis.expire(key.client(clientId), TTL.client)) === 1) {
      await this.redis.zadd(key.clientIndex, this.now() + TTL.client * 1000, clientId);
    }
  }

  // ── Pedidos de autorização ──

  async savePendingRequest(idHash: string, request: PendingAuthRequest): Promise<void> {
    await this.redis.set(key.request(idHash), JSON.stringify(request), 'EX', TTL.authRequest);
  }

  async getPendingRequest(idHash: string): Promise<PendingAuthRequest | undefined> {
    return parse<PendingAuthRequest>(await this.redis.get(key.request(idHash)));
  }

  async consumePendingRequest(idHash: string): Promise<PendingAuthRequest | undefined> {
    return parse<PendingAuthRequest>(await this.redis.getdel(key.request(idHash)));
  }

  // ── Códigos ──

  async saveAuthCode(codeHash: string, record: AuthCodeRecord): Promise<void> {
    await this.redis.set(key.code(codeHash), JSON.stringify(record), 'EX', TTL.authCode);
  }

  async getAuthCode(codeHash: string): Promise<AuthCodeRecord | undefined> {
    return parse<AuthCodeRecord>(await this.redis.get(key.code(codeHash)));
  }

  async consumeAuthCode(codeHash: string, familyId: string): Promise<ConsumeResult<AuthCodeRecord>> {
    // Ordem deliberada: PRIMEIRO a tombstone (SET NX), DEPOIS o GETDEL. Se fosse o
    // contrário, um segundo uso que chegasse entre o GETDEL e a escrita da tombstone
    // veria "código inexistente" em vez de "reuso" e a revogação em cascata se perderia.
    const created = await this.redis.set(key.codeUsed(codeHash), familyId, 'EX', TTL.codeTombstone, 'NX');
    const raw = await this.redis.getdel(key.code(codeHash));
    const record = parse<AuthCodeRecord>(raw);
    if (record) return { status: 'ok', record };

    if (created === 'OK') {
      // Código que nunca existiu (ou já expirou): não deixar tombstone de lixo.
      await this.redis.del(key.codeUsed(codeHash));
      return { status: 'missing' };
    }
    const usedBy = await this.redis.get(key.codeUsed(codeHash));
    return usedBy ? { status: 'reused', familyId: usedBy } : { status: 'missing' };
  }

  async findConsumedCodeFamily(codeHash: string): Promise<string | undefined> {
    return (await this.redis.get(key.codeUsed(codeHash))) ?? undefined;
  }

  // ── Famílias ──

  async createFamily(family: GrantFamily): Promise<void> {
    await this.redis.set(key.family(family.id), JSON.stringify(family), 'EX', TTL.refreshToken);
    await this.redis.sadd(key.userFamilies(family.userId), family.id);
    await this.redis.expire(key.userFamilies(family.userId), TTL.refreshToken);
  }

  async getFamily(familyId: string): Promise<GrantFamily | undefined> {
    return parse<GrantFamily>(await this.redis.get(key.family(familyId)));
  }

  async extendFamily(familyId: string): Promise<void> {
    const family = await this.getFamily(familyId);
    if (!family) return;
    await this.redis.expire(key.family(familyId), TTL.refreshToken);
    await this.redis.expire(key.userFamilies(family.userId), TTL.refreshToken);
  }

  async revokeFamily(familyId: string): Promise<void> {
    const family = await this.getFamily(familyId);
    await this.redis.del(key.family(familyId));
    if (family) await this.redis.srem(key.userFamilies(family.userId), familyId);
  }

  async listFamiliesByUser(userId: string): Promise<GrantFamily[]> {
    const ids = await this.redis.smembers(key.userFamilies(userId));
    const families: GrantFamily[] = [];
    for (const id of ids) {
      const family = await this.getFamily(id);
      if (family && family.userId === userId) families.push(family);
      else await this.redis.srem(key.userFamilies(userId), id); // família expirada: limpa o índice
    }
    return families.sort((a, b) => b.createdAt - a.createdAt);
  }

  // ── Tokens ──

  async saveAccessToken(tokenHash: string, record: AccessTokenRecord): Promise<void> {
    await this.redis.set(key.access(tokenHash), JSON.stringify(record), 'EX', TTL.accessToken);
  }

  async getAccessToken(tokenHash: string): Promise<AccessTokenRecord | undefined> {
    return parse<AccessTokenRecord>(await this.redis.get(key.access(tokenHash)));
  }

  async saveRefreshToken(tokenHash: string, record: RefreshTokenRecord): Promise<void> {
    await this.redis.set(key.refresh(tokenHash), JSON.stringify(record), 'EX', TTL.refreshToken);
  }

  async getRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | undefined> {
    return parse<RefreshTokenRecord>(await this.redis.get(key.refresh(tokenHash)));
  }

  async consumeRefreshToken(tokenHash: string): Promise<ConsumeResult<RefreshTokenRecord>> {
    // Aqui a família só é conhecida lendo o registro, então GETDEL vem primeiro e a
    // tombstone logo depois. A janela entre os dois comandos é de microssegundos e o
    // pior caso é um reuso simultâneo ser tratado como "inválido" (sem revogar a
    // família) — o segundo uso falha do mesmo jeito, só a cascata deixa de disparar.
    const record = parse<RefreshTokenRecord>(await this.redis.getdel(key.refresh(tokenHash)));
    if (record) {
      await this.redis.set(key.refreshUsed(tokenHash), record.familyId, 'EX', TTL.refreshToken);
      return { status: 'ok', record };
    }
    const usedBy = await this.redis.get(key.refreshUsed(tokenHash));
    return usedBy ? { status: 'reused', familyId: usedBy } : { status: 'missing' };
  }

  // ── Registro de chamadas ──

  async appendCall(scopeKey: string, event: McpCallEvent): Promise<void> {
    const k = key.calls(scopeKey);
    await this.redis.lpush(k, JSON.stringify(event));
    await this.redis.ltrim(k, 0, CALL_LOG_MAX_ENTRIES - 1);
    await this.redis.expire(k, TTL.callLog);
  }

  async listCalls(scopeKey: string, limit = 100): Promise<McpCallEvent[]> {
    const raw = await this.redis.lrange(key.calls(scopeKey), 0, Math.max(0, limit - 1));
    return raw.map((r) => parse<McpCallEvent>(r)).filter((e): e is McpCallEvent => !!e);
  }
}
