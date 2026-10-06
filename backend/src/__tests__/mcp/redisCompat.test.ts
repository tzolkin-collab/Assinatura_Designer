// Compatibilidade com Redis < 6.2 e erros de infra que não podem vazar para o cliente.
//
// Dois riscos reais de deploy: (1) um Redis antigo (sem GETDEL) — o consumo atômico de uso
// único tem de funcionar por MULTI/EXEC, que existe em qualquer versão; (2) quando o Redis
// falha por qualquer motivo, a resposta HTTP não pode carregar a mensagem do Redis
// (versão, comando, chave) — só o log.
import '../client'; // mocka prisma e redis do processo de teste (precisa vir antes do resto)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { MemoryRedis } from '../../mcp/memoryRedis';
import { RedisMcpStore, type AuthCodeRecord } from '../../mcp/store';
import {
  authorize,
  authorizeQuery,
  buildHarness,
  callTool,
  captureConsole,
  connect,
  decide,
  exchange,
  mcpPost,
  pkcePair,
  registerClient,
  requestIdFromLocation,
  type Harness,
} from './harness';

const REDIS_ERROR = "ERR unknown command 'getdel', with args beginning with: 'mcp:req:abc123'";

afterEach(() => {
  vi.restoreAllMocks();
});

describe('o store não usa GETDEL (Redis < 6.2)', () => {
  // Um Redis antigo responde "unknown command 'getdel'". Aqui o comando existe mas explode
  // — se o store voltar a usá-lo, todo consumo de uso único falha e estes testes quebram.
  function storeWithoutGetdel() {
    let t = Date.now();
    const redis = new MemoryRedis(() => t);
    (redis as unknown as { getdel: () => Promise<never> }).getdel = async () => {
      throw new Error(REDIS_ERROR);
    };
    return { store: new RedisMcpStore(redis, () => t), redis, advance: (ms: number) => void (t += ms) };
  }

  const code: AuthCodeRecord = {
    clientId: 'c1',
    redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    codeChallenge: 'x'.repeat(43),
    resource: 'https://api.example.test/mcp',
    scopes: ['designer.read'],
    userId: 'u1',
    brandIds: ['b1'],
    createdAt: 0,
  };

  it('pedido de consentimento: uso único', async () => {
    const { store } = storeWithoutGetdel();
    const pending = {
      clientId: 'c1',
      redirectUri: code.redirectUri,
      codeChallenge: code.codeChallenge,
      resource: code.resource,
      scopes: ['designer.read'] as ['designer.read'],
      createdAt: 0,
    };
    await store.savePendingRequest('p1', pending);
    expect(await store.consumePendingRequest('p1')).toEqual(pending);
    expect(await store.consumePendingRequest('p1')).toBeUndefined();
  });

  it('código de autorização: uso único e, sob concorrência, exatamente um recebe o registro', async () => {
    const { store } = storeWithoutGetdel();
    await store.saveAuthCode('h1', code);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => store.consumeAuthCode('h1', `fam-${i}`)));
    expect(results.filter((r) => r.status === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'reused')).toHaveLength(19);
  });

  it('refresh token: rotação com detecção de reuso', async () => {
    const { store } = storeWithoutGetdel();
    await store.saveRefreshToken('r1', { familyId: 'fam-1', clientId: 'c1' });
    expect((await store.consumeRefreshToken('r1')).status).toBe('ok');
    expect(await store.consumeRefreshToken('r1')).toMatchObject({ status: 'reused', familyId: 'fam-1' });
  });

  it('um erro do Redis no consumo PROPAGA (nunca vira "consumiu" nem "não existe")', async () => {
    const { store, redis } = storeWithoutGetdel();
    redis.multi = () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['get', 'del', 'lpush', 'ltrim', 'expire', 'sadd']) chain[m] = () => chain;
      chain.exec = async () => [[new Error('LOADING Redis is loading the dataset in memory'), null], [null, 0]];
      return chain as never;
    };
    await store.savePendingRequest('p1', {
      clientId: 'c1',
      redirectUri: code.redirectUri,
      codeChallenge: code.codeChallenge,
      resource: code.resource,
      scopes: ['designer.read'],
      createdAt: 0,
    });
    await expect(store.consumePendingRequest('p1')).rejects.toThrow(/LOADING/);
  });
});

describe('erro de infraestrutura não vaza para o cliente', () => {
  let h: Harness;

  beforeEach(() => {
    h = buildHarness();
    h.addMember('user-1', 'brand-a', 'EDITOR');
  });

  async function pendingRequest() {
    const reg = await registerClient(h.app);
    const pkce = pkcePair();
    const auth = await authorize(h.app, authorizeQuery(reg.body.client_id, pkce.challenge));
    return requestIdFromLocation(auth.headers.location);
  }

  it('aprovar o consentimento com o Redis falhando → 500 genérico; o detalhe só no log', async () => {
    const logs = captureConsole();
    const requestId = await pendingRequest();
    h.store.consumePendingRequest = async () => {
      throw new Error(REDIS_ERROR);
    };

    const res = await decide(h, requestId, 'user-1', { decision: 'approve', brandSlugs: ['marca-a'] });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('MCP_INTERNAL_ERROR');
    expect(res.text).not.toMatch(/getdel|unknown command|mcp:req|ERR /i);
    expect(logs.join('\n')).toContain("unknown command 'getdel'"); // o operador vê o motivo real
  });

  it('GET do consentimento e GET /connections com o store falhando → 500 genérico', async () => {
    const requestId = await pendingRequest();
    h.store.getPendingRequest = async () => {
      throw new Error(REDIS_ERROR);
    };
    h.store.listFamiliesByUser = async () => {
      throw new Error(REDIS_ERROR);
    };
    for (const res of [
      await request(h.app).get(`/api/mcp/consent/${requestId}`).set(h.asUser('user-1')),
      await request(h.app).get('/api/mcp/connections').set(h.asUser('user-1')),
    ]) {
      expect(res.status).toBe(500);
      expect(res.text).not.toMatch(/getdel|unknown command|mcp:req/i);
    }
  });

  it('erros 4xx NOSSOS continuam com a mensagem original (o usuário precisa entendê-los)', async () => {
    const res = await request(h.app).get(`/api/mcp/consent/${'x'.repeat(43)}`).set(h.asUser('user-1'));
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/Pedido de autorização inexistente/);
    const bad = await decide(h, await pendingRequest(), 'user-1', { decision: 'approve', brandSlugs: [] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/ao menos uma marca/i);
  });

  it('/token e /mcp também não ecoam o erro do Redis', async () => {
    const flow = await connect(h);
    h.store.getAccessToken = async () => {
      throw new Error(REDIS_ERROR);
    };
    h.store.consumeRefreshToken = async () => {
      throw new Error(REDIS_ERROR);
    };
    const mcp = await mcpPost(h.app, flow.accessToken, callTool('list_brands'));
    expect(mcp.status).toBe(500);
    expect(mcp.text).not.toMatch(/getdel|unknown command|mcp:req/i);

    const token = await exchange(h.app, { grant_type: 'refresh_token', client_id: flow.clientId, refresh_token: flow.refreshToken });
    expect(token.status).toBe(500);
    expect(token.text).not.toMatch(/getdel|unknown command|mcp:req/i);
  });
});
