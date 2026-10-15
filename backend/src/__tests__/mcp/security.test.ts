// Segurança do conector MCP: segredo nunca em claro (store e logs), rate limit, texto não
// confiável escapado e módulo realmente desligado por padrão.
import '../client'; // mocka prisma e redis do processo de teste (precisa vir antes do resto)
import cors from 'cors';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { sha256Hex } from '../../mcp/auth/crypto';
import { loadMcpConfig } from '../../mcp/config';
import { mountMcp } from '../../mcp';
import {
  CHATGPT_REDIRECT,
  authorize,
  authorizeQuery,
  buildHarness,
  callTool,
  connect,
  decide,
  exchange,
  mcpPost,
  pkcePair,
  registerClient,
  requestIdFromLocation,
  rpc,
  type Harness,
} from './harness';

let h: Harness;

beforeEach(() => {
  h = buildHarness();
  h.addMember('user-1', 'brand-a', 'EDITOR');
  h.addMember('user-1', 'brand-b', 'EDITOR');
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Captura TUDO que o processo escreve em console (é por onde o logger estruturado sai). */
function captureConsole() {
  const lines: string[] = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  }
  return lines;
}

describe('segredos nunca em claro', () => {
  it('access/refresh token, código e id do pedido NÃO aparecem no Redis nem nos logs — só os hashes', async () => {
    const logs = captureConsole();

    // Fluxo inteiro: registro → authorize → consentimento → token → chamada → refresh → revogação.
    const reg = await registerClient(h.app);
    const clientId = reg.body.client_id as string;
    const pkce = pkcePair();
    const auth = await authorize(h.app, authorizeQuery(clientId, pkce.challenge));
    const requestId = requestIdFromLocation(auth.headers.location);
    const approve = await decide(h, requestId, 'user-1', { decision: 'approve', brandSlugs: ['marca-a'] });
    const code = new URL(approve.body.data.redirectUrl).searchParams.get('code')!;
    const token = await exchange(h.app, {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: pkce.verifier,
      redirect_uri: CHATGPT_REDIRECT,
      resource: 'https://api.example.test/mcp',
    });
    const accessToken = token.body.access_token as string;
    const refreshToken = token.body.refresh_token as string;
    await mcpPost(h.app, accessToken, callTool('list_brands'));
    await mcpPost(h.app, accessToken, callTool('get_brand_kit', { brandSlug: 'marca-b' }));
    const refreshed = await exchange(h.app, { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken });
    await exchange(h.app, { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken }); // reuso (loga aviso)
    await exchange(h.app, {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: pkce.verifier,
      redirect_uri: CHATGPT_REDIRECT,
    }); // código reusado (loga aviso)
    await request(h.app).post('/revoke').type('form').send({ client_id: clientId, token: refreshed.body.access_token });
    await new Promise((r) => setTimeout(r, 30));

    const jwt = h.sign('user-1');
    const secrets = [
      accessToken,
      refreshToken,
      refreshed.body.access_token as string,
      refreshed.body.refresh_token as string,
      code,
      requestId,
      pkce.verifier,
      jwt,
    ];

    const dump = h.redis.dump();
    const allLogs = logs.join('\n');
    for (const secret of secrets) {
      expect(secret.length).toBeGreaterThan(20);
      expect(dump).not.toContain(secret);
      expect(allLogs).not.toContain(secret);
    }

    // Controle positivo: o que está guardado é o HASH (senão o teste acima provaria nada).
    for (const secret of [accessToken, refreshToken, code]) {
      expect(dump).toContain(sha256Hex(secret));
    }
    // (O id do pedido já foi CONSUMIDO — apagado — por isso não há hash dele para achar.)
    // E os logs de fato existem (o teste não está passando por não ter capturado nada).
    expect(allLogs).toContain('mcp.tool_call');
    expect(allLogs).toMatch(/code_reuse|refresh_reuse/);
  });

  it('nenhum header Authorization/Bearer aparece em log', async () => {
    const logs = captureConsole();
    const flow = await connect(h);
    await mcpPost(h.app, flow.accessToken, callTool('list_brands'));
    await mcpPost(h.app, 'dsg_at_invalido', callTool('list_brands'));
    await mcpPost(h.app, undefined, callTool('list_brands'));
    const joined = logs.join('\n');
    expect(joined).not.toMatch(/Bearer\s+\S+/);
    expect(joined).not.toMatch(/authorization/i);
  });

  it('toda chave de Redis do módulo tem o prefixo mcp:', async () => {
    await connect(h);
    expect(h.redis.keys().length).toBeGreaterThan(0);
    expect(h.redis.keys().every((k) => k.startsWith('mcp:'))).toBe(true);
  });

  it('tokens têm 256 bits de entropia (43 caracteres base64url depois do prefixo) e nunca se repetem', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const flow = await connect(h);
      for (const t of [flow.accessToken, flow.refreshToken, flow.code, flow.requestId]) {
        expect(t.replace(/^dsg_(at|rt)_/, '')).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(seen.has(t)).toBe(false);
        seen.add(t);
      }
    }
  });

  it('o access token NÃO é aceito como refresh token (nem o contrário)', async () => {
    const flow = await connect(h);
    const asRefresh = await exchange(h.app, { grant_type: 'refresh_token', client_id: flow.clientId, refresh_token: flow.accessToken });
    expect(asRefresh.body.error).toBe('invalid_grant');
    expect((await mcpPost(h.app, flow.refreshToken, rpc('tools/list'))).status).toBe(401);
  });
});

describe('rate limit', () => {
  it('/register: a requisição acima do teto leva 429 em formato OAuth, com Retry-After', async () => {
    const limited = buildHarness({ limits: { register: { windowSec: 3600, max: 2 } } });
    expect((await registerClient(limited.app)).status).toBe(201);
    expect((await registerClient(limited.app)).status).toBe(201);
    const third = await registerClient(limited.app);
    expect(third.status).toBe(429);
    expect(third.body.error).toBe('too_many_requests');
    expect(third.headers['retry-after']).toBeDefined();
  });

  it('/token: a requisição acima do teto leva 429', async () => {
    const limited = buildHarness({ limits: { token: { windowSec: 900, max: 2 } } });
    const body = { grant_type: 'refresh_token', client_id: 'x', refresh_token: 'y' };
    expect((await exchange(limited.app, body)).status).toBe(400);
    expect((await exchange(limited.app, body)).status).toBe(400);
    const third = await exchange(limited.app, body);
    expect(third.status).toBe(429);
    expect(third.body.error).toBe('too_many_requests');
  });

  it('/authorize e /revoke também têm teto', async () => {
    const limited = buildHarness({ limits: { authorize: { windowSec: 900, max: 1 }, revoke: { windowSec: 900, max: 1 } } });
    const q = authorizeQuery('x', 'y'.repeat(43));
    expect((await authorize(limited.app, q)).status).toBe(400);
    expect((await authorize(limited.app, q)).status).toBe(429);
    const revoke = () => request(limited.app).post('/revoke').type('form').send({ client_id: 'x', token: 't' });
    await revoke();
    expect((await revoke()).status).toBe(429);
  });

  it('/mcp: o teto é POR USUÁRIO — estourar o de um não afeta o de outro', async () => {
    const limited = buildHarness({ limits: { mcpUser: { windowSec: 60, max: 2 } } });
    limited.addMember('user-1', 'brand-a', 'EDITOR');
    limited.addMember('user-2', 'brand-a', 'EDITOR');
    const a = await connect(limited, { userId: 'user-1' });
    const b = await connect(limited, { userId: 'user-2' });

    expect((await mcpPost(limited.app, a.accessToken, rpc('tools/list'))).status).toBe(200);
    expect((await mcpPost(limited.app, a.accessToken, rpc('tools/list'))).status).toBe(200);
    const blocked = await mcpPost(limited.app, a.accessToken, rpc('tools/list'));
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    // O outro usuário continua passando.
    expect((await mcpPost(limited.app, b.accessToken, rpc('tools/list'))).status).toBe(200);
  });

  it('/mcp: o teto por IP vale antes da autenticação', async () => {
    const limited = buildHarness({ limits: { mcpIp: { windowSec: 60, max: 2 } } });
    expect((await mcpPost(limited.app, undefined, rpc('tools/list'))).status).toBe(401);
    expect((await mcpPost(limited.app, undefined, rpc('tools/list'))).status).toBe(401);
    expect((await mcpPost(limited.app, undefined, rpc('tools/list'))).status).toBe(429);
  });

  it('consentimento tem teto por usuário', async () => {
    const limited = buildHarness({ limits: { consent: { windowSec: 600, max: 2 } } });
    limited.addMember('user-1', 'brand-a', 'EDITOR');
    const get = () => request(limited.app).get(`/api/mcp/consent/${'x'.repeat(43)}`).set(limited.asUser('user-1'));
    expect((await get()).status).toBe(404);
    expect((await get()).status).toBe(404);
    expect((await get()).status).toBe(429);
  });
});

describe('client_name é texto NÃO confiável (DCR é público)', () => {
  async function consentViewFor(clientName: string) {
    const reg = await registerClient(h.app, { client_name: clientName });
    const pkce = pkcePair();
    const auth = await authorize(h.app, authorizeQuery(reg.body.client_id, pkce.challenge));
    const requestId = requestIdFromLocation(auth.headers.location);
    return request(h.app).get(`/api/mcp/consent/${requestId}`).set(h.asUser('user-1'));
  }

  it('<script> é escapado na resposta do GET de consentimento', async () => {
    const res = await consentViewFor('<script>alert(1)</script>');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.data.client.name).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(res.text).not.toMatch(/<script/i);
  });

  it('aspas e atributos também (quebra de atributo HTML)', async () => {
    const res = await consentViewFor(`"><img src=x onerror=alert(1)> & 'x'`);
    expect(res.body.data.client.name).toBe('&quot;&gt;&lt;img src=x onerror=alert(1)&gt; &amp; &#39;x&#39;');
    expect(res.text).not.toContain('<img');
  });

  it('caracteres de controle e de inversão de texto (bidi) são removidos já no registro', async () => {
    const reg = await registerClient(h.app, { client_name: 'Chat\u0000GPT‮ (oficial)​' });
    expect(reg.status).toBe(201);
    expect(reg.body.client_name).toBe('ChatGPT (oficial)');
  });

  it('nome gigante é cortado em 100 caracteres', async () => {
    const reg = await registerClient(h.app, { client_name: 'A'.repeat(5000) });
    expect(reg.body.client_name).toHaveLength(100);
  });

  it('sem nome vira um rótulo neutro (a tela nunca fica sem identificar o pedido)', async () => {
    const reg = await registerClient(h.app, { client_name: '   ' });
    expect(reg.body.client_name).toBe('Cliente sem nome');
  });

  it('o nome escapado também sai na lista de conexões', async () => {
    await connect(h, { clientName: '<b onmouseover=x>' });
    const list = await request(h.app).get('/api/mcp/connections').set(h.asUser('user-1'));
    expect(list.body.data[0].clientName).toBe('&lt;b onmouseover=x&gt;');
  });

  it('o host mostrado ao usuário vem da redirect_uri REGISTRADA, nunca do que o cliente diz', async () => {
    const res = await consentViewFor('Sou o banco, confie em mim (bank.example.com)');
    expect(res.body.data.client.redirectHost).toBe('chatgpt.com');
  });
});

describe('cabeçalhos de resposta', () => {
  it('consentimento e token nunca vão para cache', async () => {
    const flow = await connect(h);
    expect(flow.token.headers['cache-control']).toMatch(/no-store/);
    const view = await request(h.app).get(`/api/mcp/connections`).set(h.asUser('user-1'));
    expect(view.headers['cache-control']).toMatch(/no-store/);
  });

  it('WWW-Authenticate é ASCII puro em todos os 401 (header com caractere fora do Latin-1 derruba o servidor)', async () => {
    const flow = await connect(h);
    h.clock.advance(2 * 3600 * 1000);
    const cases = [
      await mcpPost(h.app, undefined, rpc('tools/list')),
      await mcpPost(h.app, 'dsg_at_x', rpc('tools/list')),
      await mcpPost(h.app, flow.accessToken, rpc('tools/list')), // expirado
    ];
    for (const res of cases) {
      expect(res.status).toBe(401);
      // eslint-disable-next-line no-control-regex
      expect(res.headers['www-authenticate']).toMatch(/^[\x20-\x7e]+$/);
    }
  });
});

describe('módulo desligado por padrão', () => {
  it('MCP_ENABLED=true com configuração inválida NÃO monta e loga o motivo', async () => {
    const logs = captureConsole();
    const bare = express();
    const result = mountMcp(bare, {
      apiCors: cors(),
      config: loadMcpConfig({ MCP_ENABLED: 'true' }, { isProduction: true }), // sem PUBLIC_BASE_URL
    });
    expect(result.mounted).toBe(false);
    expect(logs.join('\n')).toMatch(/NÃO montado.*PUBLIC_BASE_URL/s);
    expect((await request(bare).get('/.well-known/oauth-authorization-server')).status).toBe(404);
    expect((await request(bare).post('/mcp').send({})).status).toBe(404);
  });

  it('MCP_ENABLED desligado: mountMcp não registra rota nem loga erro', async () => {
    const logs = captureConsole();
    const bare = express();
    const result = mountMcp(bare, { apiCors: cors(), config: loadMcpConfig({}, { isProduction: true }) });
    expect(result.mounted).toBe(false);
    expect(logs.filter((l) => /erro|error|NÃO montado/i.test(l))).toEqual([]);
    expect((await request(bare).get('/.well-known/oauth-authorization-server')).status).toBe(404);
  });
});
