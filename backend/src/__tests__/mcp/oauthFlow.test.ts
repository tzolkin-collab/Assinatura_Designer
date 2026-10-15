// Fluxo OAuth 2.1 do conector MCP de ponta a ponta (supertest, sem infra real):
// metadados, DCR, /authorize, consentimento, /token, PKCE, reuso, refresh e revogação.
import '../client'; // mocka prisma e redis do processo de teste (precisa vir antes do resto)
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  CHATGPT_REDIRECT,
  FRONTEND,
  ISSUER,
  RESOURCE,
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
  type Harness,
} from './harness';

let h: Harness;

beforeEach(() => {
  h = buildHarness();
  h.addMember('user-1', 'brand-a', 'EDITOR');
  h.addMember('user-1', 'brand-b', 'EDITOR');
  h.addMember('viewer-1', 'brand-a', 'VIEWER');
});

describe('metadados', () => {
  it('servidor de autorização: issuer exato, S256, iss (RFC 9207) e só clientes públicos', async () => {
    const res = await request(h.app).get('/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
    expect(res.body.issuer).toBe(ISSUER); // sem barra final: o ChatGPT compara por string
    expect(res.body.code_challenge_methods_supported).toEqual(['S256']);
    expect(res.body.authorization_response_iss_parameter_supported).toBe(true);
    expect(res.body.token_endpoint_auth_methods_supported).toEqual(['none']);
    expect(res.body.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
    expect(res.body.response_types_supported).toEqual(['code']);
    expect(res.body.authorization_endpoint).toBe(`${ISSUER}/authorize`);
    expect(res.body.token_endpoint).toBe(`${ISSUER}/token`);
    expect(res.body.registration_endpoint).toBe(`${ISSUER}/register`);
    expect(res.body.revocation_endpoint).toBe(`${ISSUER}/revoke`);
    expect(res.body.scopes_supported).toEqual(['designer.read', 'designer.write', 'designer.edit_all']);
    // CIMD não é implementado: não pode ser anunciado.
    expect(res.body.client_id_metadata_document_supported).toBeUndefined();
  });

  it.each(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'])(
    'protected resource %s aponta para o recurso e para o issuer',
    async (path) => {
      const res = await request(h.app).get(path);
      expect(res.status).toBe(200);
      expect(res.body.resource).toBe(RESOURCE);
      expect(res.body.authorization_servers).toEqual([ISSUER]);
      expect(res.body.scopes_supported).toEqual(['designer.read', 'designer.write', 'designer.edit_all']);
    },
  );

  it('os metadados vêm de PUBLIC_BASE_URL, nunca do header Host da requisição', async () => {
    const res = await request(h.app)
      .get('/.well-known/oauth-authorization-server')
      .set('Host', 'atacante.example.net')
      .set('X-Forwarded-Host', 'atacante.example.net');
    expect(res.body.issuer).toBe(ISSUER);
    expect(JSON.stringify(res.body)).not.toContain('atacante');
  });
});

describe('registro dinâmico de clientes (DCR)', () => {
  it('registra cliente público válido e não devolve segredo', async () => {
    const res = await registerClient(h.app);
    expect(res.status).toBe(201);
    expect(res.body.client_id).toBeTruthy();
    expect(res.body.client_secret).toBeUndefined();
    expect(res.body.token_endpoint_auth_method).toBe('none');
    expect(res.body.redirect_uris).toEqual([CHATGPT_REDIRECT]);
  });

  it('aceita o redirect legado /connector/oauth/<callback_id>', async () => {
    const res = await registerClient(h.app, { redirect_uris: ['https://chatgpt.com/connector/oauth/abc_123-XYZ'] });
    expect(res.status).toBe(201);
  });

  it.each([
    ['host de terceiros', 'https://evil.example.net/connector_platform_oauth_redirect'],
    ['host parecido com sufixo', 'https://chatgpt.com.evil.net/connector_platform_oauth_redirect'],
    ['host parecido com prefixo', 'https://evilchatgpt.com/connector_platform_oauth_redirect'],
    ['path extra', 'https://chatgpt.com/connector_platform_oauth_redirect/extra'],
    ['query', 'https://chatgpt.com/connector_platform_oauth_redirect?x=1'],
    ['http', 'http://chatgpt.com/connector_platform_oauth_redirect'],
    ['callback_id com dois segmentos', 'https://chatgpt.com/connector/oauth/a/b'],
    ['localhost sem a flag', 'http://localhost:6274/oauth/callback'],
  ])('rejeita redirect_uri: %s', async (_nome, uri) => {
    const res = await registerClient(h.app, { redirect_uris: [uri] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_redirect_uri');
  });

  it('não registra se UMA das redirect_uris está fora da allowlist', async () => {
    const res = await registerClient(h.app, { redirect_uris: [CHATGPT_REDIRECT, 'https://evil.example.net/cb'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_redirect_uri');
  });

  it('recusa clientes com segredo (só públicos com PKCE)', async () => {
    const res = await registerClient(h.app, { token_endpoint_auth_method: 'client_secret_post' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_client_metadata');
  });

  it('sem token_endpoint_auth_method o cliente vira público (e não ganha segredo)', async () => {
    const res = await request(h.app)
      .post('/register')
      .send({ redirect_uris: [CHATGPT_REDIRECT], client_name: 'X' });
    expect(res.status).toBe(201);
    expect(res.body.client_secret).toBeUndefined();
    expect(res.body.token_endpoint_auth_method).toBe('none');
  });

  it('recusa grant_type que o servidor não implementa', async () => {
    const res = await registerClient(h.app, { grant_types: ['client_credentials'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_client_metadata');
  });

  it('aplica o teto de clientes registrados', async () => {
    const small = buildHarness({ env: { MCP_MAX_CLIENTS: '2' } });
    expect((await registerClient(small.app)).status).toBe(201);
    expect((await registerClient(small.app)).status).toBe(201);
    const third = await registerClient(small.app);
    expect(third.status).toBe(400);
    expect(third.body.error).toBe('temporarily_unavailable');
  });

  it('loopback só é aceito com MCP_ALLOW_LOCALHOST_REDIRECT=true (Inspector em dev)', async () => {
    const dev = buildHarness({ env: { MCP_ALLOW_LOCALHOST_REDIRECT: 'true' } });
    const ok = await registerClient(dev.app, { redirect_uris: ['http://localhost:6274/oauth/callback'] });
    expect(ok.status).toBe(201);
    // ...mas a flag NÃO abre host remoto nem http fora do loopback.
    const bad = await registerClient(dev.app, { redirect_uris: ['http://evil.example.net/cb'] });
    expect(bad.status).toBe(400);
  });

  it('aceita MCP_ALLOWED_REDIRECT_URIS customizado (substitui o padrão)', async () => {
    const custom = buildHarness({ env: { MCP_ALLOWED_REDIRECT_URIS: 'https://claude.example.test/oauth/{id}' } });
    expect((await registerClient(custom.app, { redirect_uris: ['https://claude.example.test/oauth/xyz'] })).status).toBe(201);
    expect((await registerClient(custom.app, { redirect_uris: [CHATGPT_REDIRECT] })).status).toBe(400);
  });
});

describe('/authorize', () => {
  async function newClient() {
    const reg = await registerClient(h.app);
    return reg.body.client_id as string;
  }

  it('só estaciona o pedido e manda o navegador para a tela de consentimento — sem emitir código', async () => {
    const clientId = await newClient();
    const { challenge } = pkcePair();
    const res = await authorize(h.app, authorizeQuery(clientId, challenge));
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.origin).toBe(FRONTEND);
    expect(location.pathname).toBe('/mcp/consent');
    expect(location.searchParams.get('request')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Nada de `code` na URL e nada de código no armazenamento.
    expect(location.searchParams.has('code')).toBe(false);
    expect(h.redis.keys().filter((k) => k.startsWith('mcp:code:'))).toEqual([]);
  });

  it('rejeita PKCE "plain" com erro no redirect (incluindo state e iss)', async () => {
    const clientId = await newClient();
    const { challenge } = pkcePair();
    const res = await authorize(h.app, authorizeQuery(clientId, challenge, { code_challenge_method: 'plain' }));
    expect(res.status).toBe(302);
    const url = new URL(res.headers.location);
    expect(url.origin + url.pathname).toBe(CHATGPT_REDIRECT);
    expect(url.searchParams.get('error')).toBe('invalid_request');
    expect(url.searchParams.get('state')).toBe('estado-123');
    expect(url.searchParams.get('iss')).toBe(ISSUER);
    expect(url.searchParams.has('code')).toBe(false);
  });

  it('rejeita pedido sem code_challenge_method', async () => {
    const clientId = await newClient();
    const { challenge } = pkcePair();
    const query: Record<string, string> = authorizeQuery(clientId, challenge);
    delete query.code_challenge_method;
    const res = await authorize(h.app, query);
    expect(new URL(res.headers.location).searchParams.get('error')).toBe('invalid_request');
  });

  it('rejeita pedido sem code_challenge', async () => {
    const clientId = await newClient();
    const query: Record<string, string> = authorizeQuery(clientId, 'x');
    delete query.code_challenge;
    const res = await authorize(h.app, query);
    expect(new URL(res.headers.location).searchParams.get('error')).toBe('invalid_request');
  });

  it('rejeita code_challenge frouxo (formato S256 é exatamente 43 caracteres)', async () => {
    const clientId = await newClient();
    const res = await authorize(h.app, authorizeQuery(clientId, 'curto'));
    const url = new URL(res.headers.location);
    expect(url.searchParams.get('error')).toBe('invalid_request');
    expect(url.searchParams.get('iss')).toBe(ISSUER);
  });

  it('rejeita resource que não é o nosso (invalid_target)', async () => {
    const clientId = await newClient();
    const { challenge } = pkcePair();
    const res = await authorize(h.app, authorizeQuery(clientId, challenge, { resource: 'https://outro.example.net/mcp' }));
    const url = new URL(res.headers.location);
    expect(url.origin + url.pathname).toBe(CHATGPT_REDIRECT);
    expect(url.searchParams.get('error')).toBe('invalid_target');
    expect(url.searchParams.get('iss')).toBe(ISSUER);
  });

  it('aceita o resource com UMA barra final (erro humano comum ao digitar a URL do conector)', async () => {
    const clientId = await newClient();
    const { challenge } = pkcePair();
    const res = await authorize(h.app, authorizeQuery(clientId, challenge, { resource: `${RESOURCE}/` }));
    expect(new URL(res.headers.location).origin).toBe(FRONTEND);
  });

  it('rejeita escopo desconhecido', async () => {
    const clientId = await newClient();
    const { challenge } = pkcePair();
    const res = await authorize(h.app, authorizeQuery(clientId, challenge, { scope: 'designer.read admin.root' }));
    expect(new URL(res.headers.location).searchParams.get('error')).toBe('invalid_scope');
  });

  it('redirect_uri NÃO registrada → 400 direto, sem redirecionar para ela', async () => {
    const clientId = await newClient();
    const { challenge } = pkcePair();
    const res = await authorize(h.app, authorizeQuery(clientId, challenge, { redirect_uri: 'https://evil.example.net/cb' }));
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  it('client_id desconhecido → 400 direto', async () => {
    const { challenge } = pkcePair();
    const res = await authorize(h.app, authorizeQuery('nao-existe', challenge));
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  it('sem scope pedido, o pedido cobre todos os escopos suportados (o usuário só pode reduzir)', async () => {
    const clientId = await newClient();
    const { challenge } = pkcePair();
    const query: Record<string, string> = authorizeQuery(clientId, challenge);
    delete query.scope;
    const res = await authorize(h.app, query);
    const requestId = requestIdFromLocation(res.headers.location);
    const view = await request(h.app).get(`/api/mcp/consent/${requestId}`).set(h.asUser('user-1'));
    expect(view.body.data.scopes).toEqual(['designer.read', 'designer.write', 'designer.edit_all']);
  });
});

describe('consentimento', () => {
  async function pending(scope = 'designer.read') {
    const reg = await registerClient(h.app, { client_name: 'ChatGPT' });
    const clientId = reg.body.client_id as string;
    const { verifier, challenge } = pkcePair();
    const res = await authorize(h.app, authorizeQuery(clientId, challenge, { scope }));
    return { clientId, verifier, challenge, requestId: requestIdFromLocation(res.headers.location) };
  }

  it('GET sem login → 401', async () => {
    const { requestId } = await pending();
    const res = await request(h.app).get(`/api/mcp/consent/${requestId}`);
    expect(res.status).toBe(401);
  });

  it('POST sem login → 401 e NENHUM código é emitido', async () => {
    const { requestId } = await pending();
    const res = await request(h.app).post(`/api/mcp/consent/${requestId}`).send({ decision: 'approve', brandSlugs: ['marca-a'] });
    expect(res.status).toBe(401);
    expect(h.redis.keys().filter((k) => k.startsWith('mcp:code:'))).toEqual([]);
  });

  it('GET mostra quem pede, o que pede e as marcas do usuário com papel', async () => {
    const { requestId } = await pending('designer.read designer.write');
    const res = await request(h.app).get(`/api/mcp/consent/${requestId}`).set(h.asUser('viewer-1'));
    expect(res.status).toBe(200);
    expect(res.body.data.client.name).toBe('ChatGPT');
    expect(res.body.data.client.redirectHost).toBe('chatgpt.com');
    expect(res.body.data.scopes).toEqual(['designer.read', 'designer.write']);
    // viewer-1 só é membro da marca A, como VIEWER: não pode liberar escrita nela.
    expect(res.body.data.brands).toEqual([
      { slug: 'marca-a', name: 'Marca A', role: 'VIEWER', canRead: true, canWrite: false, selectable: false },
    ]);
  });

  it('GET de pedido inexistente ou expirado → 404', async () => {
    const res = await request(h.app).get(`/api/mcp/consent/${'x'.repeat(43)}`).set(h.asUser('user-1'));
    expect(res.status).toBe(404);
    const { requestId } = await pending();
    h.clock.advance(11 * 60 * 1000);
    const expired = await request(h.app).get(`/api/mcp/consent/${requestId}`).set(h.asUser('user-1'));
    expect(expired.status).toBe(404);
  });

  it('approve por usuário SEM papel suficiente na marca (VIEWER pedindo escrita) → 403 e o pedido continua vivo', async () => {
    const { requestId } = await pending('designer.read designer.write');
    const denied = await decide(h, requestId, 'viewer-1', { decision: 'approve', brandSlugs: ['marca-a'] });
    expect(denied.status).toBe(403);
    expect(h.redis.keys().filter((k) => k.startsWith('mcp:code:'))).toEqual([]);

    // Pode tentar de novo reduzindo para leitura: o 403 não queimou o pedido.
    const retry = await decide(h, requestId, 'viewer-1', { decision: 'approve', brandSlugs: ['marca-a'], scopes: ['designer.read'] });
    expect(retry.status).toBe(200);
  });

  it('VIEWER pode liberar marca só para leitura', async () => {
    const { requestId } = await pending('designer.read');
    const res = await decide(h, requestId, 'viewer-1', { decision: 'approve', brandSlugs: ['marca-a'] });
    expect(res.status).toBe(200);
  });

  it('approve de marca da qual o usuário NÃO é membro → 403 (e marca inexistente responde igual)', async () => {
    const { requestId } = await pending();
    const alheia = await decide(h, requestId, 'viewer-1', { decision: 'approve', brandSlugs: ['marca-b'] });
    expect(alheia.status).toBe(403);
    const inexistente = await decide(h, requestId, 'viewer-1', { decision: 'approve', brandSlugs: ['nao-existe'] });
    expect(inexistente.status).toBe(403);
    expect(inexistente.body.error.message).toBe(alheia.body.error.message);
  });

  it('approve sem marcas → 400', async () => {
    const { requestId } = await pending();
    const res = await decide(h, requestId, 'user-1', { decision: 'approve', brandSlugs: [] });
    expect(res.status).toBe(400);
  });

  it('approve devolve redirectUrl com code, state e iss', async () => {
    const { requestId } = await pending();
    const res = await decide(h, requestId, 'user-1', { decision: 'approve', brandSlugs: ['marca-a'] });
    expect(res.status).toBe(200);
    const url = new URL(res.body.data.redirectUrl);
    expect(url.origin + url.pathname).toBe(CHATGPT_REDIRECT);
    expect(url.searchParams.get('code')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('state')).toBe('estado-123');
    expect(url.searchParams.get('iss')).toBe(ISSUER);
  });

  it('deny devolve redirectUrl com access_denied, state e iss — e nenhum código', async () => {
    const { requestId } = await pending();
    const res = await decide(h, requestId, 'user-1', { decision: 'deny' });
    expect(res.status).toBe(200);
    const url = new URL(res.body.data.redirectUrl);
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('state')).toBe('estado-123');
    expect(url.searchParams.get('iss')).toBe(ISSUER);
    expect(url.searchParams.has('code')).toBe(false);
    expect(h.redis.keys().filter((k) => k.startsWith('mcp:code:'))).toEqual([]);
  });

  it('o pedido é de uso único em QUALQUER decisão', async () => {
    const a = await pending();
    expect((await decide(h, a.requestId, 'user-1', { decision: 'approve', brandSlugs: ['marca-a'] })).status).toBe(200);
    expect((await decide(h, a.requestId, 'user-1', { decision: 'approve', brandSlugs: ['marca-a'] })).status).toBe(404);
    expect((await decide(h, a.requestId, 'user-1', { decision: 'deny' })).status).toBe(404);

    const b = await pending();
    expect((await decide(h, b.requestId, 'user-1', { decision: 'deny' })).status).toBe(200);
    expect((await decide(h, b.requestId, 'user-1', { decision: 'approve', brandSlugs: ['marca-a'] })).status).toBe(404);
  });

  it('duas aprovações simultâneas do mesmo pedido: só uma emite código', async () => {
    const { requestId } = await pending();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => decide(h, requestId, 'user-1', { decision: 'approve', brandSlugs: ['marca-a'] })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 404)).toHaveLength(5);
    expect(h.redis.keys().filter((k) => k.startsWith('mcp:code:') && !k.startsWith('mcp:code-used:'))).toHaveLength(1);
  });

  it('o usuário pode REDUZIR escopos, nunca ampliar', async () => {
    const { requestId } = await pending('designer.read');
    const ampliar = await decide(h, requestId, 'user-1', { decision: 'approve', brandSlugs: ['marca-a'], scopes: ['designer.write'] });
    expect(ampliar.status).toBe(400);

    const w = await pending('designer.read designer.write');
    const reduzir = await decide(h, w.requestId, 'user-1', { decision: 'approve', brandSlugs: ['marca-a'], scopes: ['designer.read'] });
    expect(reduzir.status).toBe(200);
  });

  it('pedido de escrita emite token com leitura também (write implica read)', async () => {
    const flow = await connect(h, { scope: 'designer.write' });
    expect(flow.token.body.scope).toBe('designer.read designer.write');
  });

  it('pedido de outro usuário não vaza marcas: a lista é a do usuário logado', async () => {
    const { requestId } = await pending();
    const res = await request(h.app).get(`/api/mcp/consent/${requestId}`).set(h.asUser('viewer-1'));
    expect(res.body.data.brands.map((b: { slug: string }) => b.slug)).toEqual(['marca-a']);
  });
});

describe('/token', () => {
  it('troca o código com o verifier correto por access + refresh', async () => {
    const flow = await connect(h);
    expect(flow.token.status).toBe(200);
    expect(flow.token.body.token_type).toBe('Bearer');
    expect(flow.token.body.expires_in).toBe(3600);
    expect(flow.token.body.scope).toBe('designer.read');
    expect(flow.accessToken).toMatch(/^dsg_at_[A-Za-z0-9_-]{43}$/);
    expect(flow.refreshToken).toMatch(/^dsg_rt_[A-Za-z0-9_-]{43}$/);
    expect(flow.token.headers['cache-control']).toMatch(/no-store/);
  });

  async function codeFlow() {
    const reg = await registerClient(h.app);
    const clientId = reg.body.client_id as string;
    const pkce = pkcePair();
    const auth = await authorize(h.app, authorizeQuery(clientId, pkce.challenge));
    const requestId = requestIdFromLocation(auth.headers.location);
    const ok = await decide(h, requestId, 'user-1', { decision: 'approve', brandSlugs: ['marca-a'] });
    const code = new URL(ok.body.data.redirectUrl).searchParams.get('code')!;
    const base = { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: pkce.verifier, redirect_uri: CHATGPT_REDIRECT, resource: RESOURCE };
    return { clientId, code, base, pkce };
  }

  it('verifier ERRADO (bem formado) → invalid_grant', async () => {
    const { base } = await codeFlow();
    const res = await exchange(h.app, { ...base, code_verifier: pkcePair().verifier });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('o PKCE protege mesmo com o código vazado: sem o verifier original não há token', async () => {
    const { base, pkce } = await codeFlow();
    const stolen = await exchange(h.app, { ...base, code_verifier: pkcePair().verifier });
    expect(stolen.body.error).toBe('invalid_grant');
    // Tentativa errada NÃO queima o código: o dono legítimo ainda troca.
    const legit = await exchange(h.app, { ...base, code_verifier: pkce.verifier });
    expect(legit.status).toBe(200);
  });

  it('verifier malformado (curto demais) → invalid_request', async () => {
    const { base } = await codeFlow();
    const res = await exchange(h.app, { ...base, code_verifier: 'curto' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('sem verifier → invalid_request (PKCE não é opcional)', async () => {
    const { base } = await codeFlow();
    const noVerifier: Record<string, string> = { ...base };
    delete noVerifier.code_verifier;
    const res = await exchange(h.app, noVerifier);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('código reusado → invalid_grant e os tokens emitidos com ele são revogados', async () => {
    const { base } = await codeFlow();
    const first = await exchange(h.app, base);
    expect(first.status).toBe(200);
    // O access token funciona...
    expect((await mcpPost(h.app, first.body.access_token, callTool('list_brands'))).status).toBe(200);

    const replay = await exchange(h.app, base);
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe('invalid_grant');

    // ...e depois do reuso, o que foi emitido com aquele código morre (OAuth 2.1 §4.1.3).
    expect((await mcpPost(h.app, first.body.access_token, callTool('list_brands'))).status).toBe(401);
    const refresh = await exchange(h.app, { grant_type: 'refresh_token', client_id: base.client_id, refresh_token: first.body.refresh_token });
    expect(refresh.body.error).toBe('invalid_grant');
  });

  it('duas trocas simultâneas do mesmo código: só uma passa', async () => {
    const { base } = await codeFlow();
    const results = await Promise.all(Array.from({ length: 5 }, () => exchange(h.app, base)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it('redirect_uri diferente da do /authorize → invalid_grant', async () => {
    const { base } = await codeFlow();
    const res = await exchange(h.app, { ...base, redirect_uri: 'https://chatgpt.com/connector/oauth/outro' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('sem redirect_uri → invalid_grant', async () => {
    const { base } = await codeFlow();
    const sem: Record<string, string> = { ...base };
    delete sem.redirect_uri;
    const res = await exchange(h.app, sem);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('resource diferente do nosso → invalid_target', async () => {
    const { base } = await codeFlow();
    const res = await exchange(h.app, { ...base, resource: 'https://outro.example.net/mcp' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_target');
  });

  it('código emitido para um cliente não serve a outro cliente', async () => {
    const { base } = await codeFlow();
    const outro = await registerClient(h.app, { client_name: 'Outro' });
    const res = await exchange(h.app, { ...base, client_id: outro.body.client_id });
    expect(res.body.error).toBe('invalid_grant');
  });

  it('código expira em 5 minutos', async () => {
    const { base } = await codeFlow();
    h.clock.advance(5 * 60 * 1000 + 1000);
    const res = await exchange(h.app, base);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('código inventado → invalid_grant', async () => {
    const { base } = await codeFlow();
    const res = await exchange(h.app, { ...base, code: 'x'.repeat(43) });
    expect(res.body.error).toBe('invalid_grant');
  });

  it('só authorization_code e refresh_token (client_credentials é recusado)', async () => {
    const { clientId } = await codeFlow();
    const res = await exchange(h.app, { grant_type: 'client_credentials', client_id: clientId });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_grant_type');
  });

  it('cliente inexistente → invalid_client', async () => {
    const { base } = await codeFlow();
    const res = await exchange(h.app, { ...base, client_id: 'nao-existe' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_client');
  });
});

describe('refresh token', () => {
  it('rotaciona: troca o refresh por um par novo, e o novo também funciona', async () => {
    const flow = await connect(h);
    const r1 = await exchange(h.app, { grant_type: 'refresh_token', client_id: flow.clientId, refresh_token: flow.refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.body.refresh_token).not.toBe(flow.refreshToken);
    expect(r1.body.access_token).not.toBe(flow.accessToken);
    expect((await mcpPost(h.app, r1.body.access_token, callTool('list_brands'))).status).toBe(200);

    const r2 = await exchange(h.app, { grant_type: 'refresh_token', client_id: flow.clientId, refresh_token: r1.body.refresh_token });
    expect(r2.status).toBe(200);
  });

  it('REUSO do refresh antigo → invalid_grant e a família inteira é revogada', async () => {
    const flow = await connect(h);
    const r1 = await exchange(h.app, { grant_type: 'refresh_token', client_id: flow.clientId, refresh_token: flow.refreshToken });
    expect(r1.status).toBe(200);

    // Alguém reapresenta o refresh antigo (já consumido): cópia vazada.
    const replay = await exchange(h.app, { grant_type: 'refresh_token', client_id: flow.clientId, refresh_token: flow.refreshToken });
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe('invalid_grant');

    // O que era legítimo também cai: access novo e refresh novo.
    expect((await mcpPost(h.app, r1.body.access_token, callTool('list_brands'))).status).toBe(401);
    const afterRevoke = await exchange(h.app, { grant_type: 'refresh_token', client_id: flow.clientId, refresh_token: r1.body.refresh_token });
    expect(afterRevoke.body.error).toBe('invalid_grant');
    // E o access do par original também (mesma família).
    expect((await mcpPost(h.app, flow.accessToken, callTool('list_brands'))).status).toBe(401);
  });

  it('refresh apresentado por OUTRO cliente → invalid_grant e a família cai', async () => {
    const flow = await connect(h);
    const outro = await registerClient(h.app, { client_name: 'Outro' });
    const res = await exchange(h.app, { grant_type: 'refresh_token', client_id: outro.body.client_id, refresh_token: flow.refreshToken });
    expect(res.body.error).toBe('invalid_grant');
    expect((await mcpPost(h.app, flow.accessToken, callTool('list_brands'))).status).toBe(401);
  });

  it('escopo acima do concedido → invalid_scope SEM queimar o refresh', async () => {
    const flow = await connect(h); // só leitura
    const res = await exchange(h.app, { grant_type: 'refresh_token', client_id: flow.clientId, refresh_token: flow.refreshToken, scope: 'designer.write' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_scope');
    const ok = await exchange(h.app, { grant_type: 'refresh_token', client_id: flow.clientId, refresh_token: flow.refreshToken });
    expect(ok.status).toBe(200);
  });

  it('resource errado no refresh → invalid_target SEM queimar o refresh', async () => {
    const flow = await connect(h);
    const res = await exchange(h.app, { grant_type: 'refresh_token', client_id: flow.clientId, refresh_token: flow.refreshToken, resource: 'https://outro.example.net/mcp' });
    expect(res.body.error).toBe('invalid_target');
    const ok = await exchange(h.app, { grant_type: 'refresh_token', client_id: flow.clientId, refresh_token: flow.refreshToken });
    expect(ok.status).toBe(200);
  });

  it('refresh expira em 30 dias (e cada rotação renova o prazo)', async () => {
    const flow = await connect(h);
    h.clock.advance(20 * 24 * 3600 * 1000);
    const r1 = await exchange(h.app, { grant_type: 'refresh_token', client_id: flow.clientId, refresh_token: flow.refreshToken });
    expect(r1.status).toBe(200);
    h.clock.advance(20 * 24 * 3600 * 1000); // 40 dias desde o início, 20 desde a rotação
    const r2 = await exchange(h.app, { grant_type: 'refresh_token', client_id: flow.clientId, refresh_token: r1.body.refresh_token });
    expect(r2.status).toBe(200);
    h.clock.advance(31 * 24 * 3600 * 1000);
    const r3 = await exchange(h.app, { grant_type: 'refresh_token', client_id: flow.clientId, refresh_token: r2.body.refresh_token });
    expect(r3.body.error).toBe('invalid_grant');
  });
});

describe('revogação', () => {
  it('/revoke com o access token derruba a conexão inteira (access e refresh)', async () => {
    const flow = await connect(h);
    const res = await request(h.app).post('/revoke').type('form').send({ client_id: flow.clientId, token: flow.accessToken });
    expect(res.status).toBe(200);
    expect((await mcpPost(h.app, flow.accessToken, callTool('list_brands'))).status).toBe(401);
    const refresh = await exchange(h.app, { grant_type: 'refresh_token', client_id: flow.clientId, refresh_token: flow.refreshToken });
    expect(refresh.body.error).toBe('invalid_grant');
  });

  it('/revoke com o refresh token também derruba o access', async () => {
    const flow = await connect(h);
    await request(h.app).post('/revoke').type('form').send({ client_id: flow.clientId, token: flow.refreshToken });
    expect((await mcpPost(h.app, flow.accessToken, callTool('list_brands'))).status).toBe(401);
  });

  it('um cliente NÃO revoga token de outro cliente (e a resposta não revela nada)', async () => {
    const flow = await connect(h);
    const outro = await registerClient(h.app, { client_name: 'Outro' });
    const res = await request(h.app).post('/revoke').type('form').send({ client_id: outro.body.client_id, token: flow.accessToken });
    expect(res.status).toBe(200);
    expect((await mcpPost(h.app, flow.accessToken, callTool('list_brands'))).status).toBe(200);
  });

  it('revogar token desconhecido responde 200 (RFC 7009)', async () => {
    const flow = await connect(h);
    const res = await request(h.app).post('/revoke').type('form').send({ client_id: flow.clientId, token: 'dsg_at_naoexiste' });
    expect(res.status).toBe(200);
  });
});

describe('conexões do usuário (GET/DELETE /api/mcp/connections)', () => {
  it('exige login', async () => {
    expect((await request(h.app).get('/api/mcp/connections')).status).toBe(401);
    expect((await request(h.app).delete('/api/mcp/connections/x')).status).toBe(401);
  });

  it('lista só as conexões do próprio usuário, com marcas atuais', async () => {
    const flow = await connect(h, { brandSlugs: ['marca-a', 'marca-b'], clientName: 'ChatGPT' });
    const mine = await request(h.app).get('/api/mcp/connections').set(h.asUser('user-1'));
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({ clientName: 'ChatGPT', scopes: ['designer.read'] });
    expect(mine.body.data[0].brands.map((b: { slug: string }) => b.slug).sort()).toEqual(['marca-a', 'marca-b']);

    const other = await request(h.app).get('/api/mcp/connections').set(h.asUser('viewer-1'));
    expect(other.body.data).toEqual([]);
    void flow;
  });

  it('não lista nome de marca da qual o usuário já saiu', async () => {
    await connect(h, { brandSlugs: ['marca-a', 'marca-b'] });
    h.removeMember('user-1', 'brand-b');
    const mine = await request(h.app).get('/api/mcp/connections').set(h.asUser('user-1'));
    expect(mine.body.data[0].brands.map((b: { slug: string }) => b.slug)).toEqual(['marca-a']);
  });

  it('DELETE revoga a conexão (access e refresh caem na hora)', async () => {
    const flow = await connect(h);
    const list = await request(h.app).get('/api/mcp/connections').set(h.asUser('user-1'));
    const id = list.body.data[0].id as string;
    const del = await request(h.app).delete(`/api/mcp/connections/${id}`).set(h.asUser('user-1'));
    expect(del.status).toBe(200);
    expect((await mcpPost(h.app, flow.accessToken, callTool('list_brands'))).status).toBe(401);
    const refresh = await exchange(h.app, { grant_type: 'refresh_token', client_id: flow.clientId, refresh_token: flow.refreshToken });
    expect(refresh.body.error).toBe('invalid_grant');
    expect((await request(h.app).get('/api/mcp/connections').set(h.asUser('user-1'))).body.data).toEqual([]);
  });

  it('outro usuário não revoga a conexão alheia (404) e ela segue funcionando', async () => {
    const flow = await connect(h);
    const list = await request(h.app).get('/api/mcp/connections').set(h.asUser('user-1'));
    const id = list.body.data[0].id as string;
    const del = await request(h.app).delete(`/api/mcp/connections/${id}`).set(h.asUser('viewer-1'));
    expect(del.status).toBe(404);
    expect((await mcpPost(h.app, flow.accessToken, callTool('list_brands'))).status).toBe(200);
  });
});
