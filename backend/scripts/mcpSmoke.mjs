/**
 * Fumaça do conector MCP contra o build (dist/) — Node puro, SEM infraestrutura.
 *
 * Prova que o módulo compilado carrega e responde de verdade sobre HTTP:
 *   - /.well-known/oauth-protected-resource e /.well-known/oauth-authorization-server;
 *   - POST /mcp sem token => 401 com WWW-Authenticate apontando o metadata;
 *   - DCR + /authorize (redireciona para o consentimento do frontend, sem emitir código);
 *   - consentimento sem login => 401;
 *   - módulo DESLIGADO (padrão) => nenhuma rota existe.
 *
 * O que é substituído e por quê (nada fala com Redis, Postgres, R2 ou Gemini):
 *   - o armazenamento do OAuth é o RedisMcpStore sobre MemoryRedis (emulação em memória);
 *   - o rate limit do app usa o `redis` de lib/redis.js; trocamos só os 3 métodos que ele
 *     chama por contadores em memória (a conexão do ioredis é lazy: nunca abre socket).
 *
 * Uso:   pnpm run build && node scripts/mcpSmoke.mjs
 */
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const express = require('express');
const cors = require('cors');

const dist = (path) => new URL(`../dist/${path}`, import.meta.url).href;

// ── Rate limit sem Redis: contadores em memória no lugar dos 3 comandos que o middleware usa ──
const { redis } = await import(dist('lib/redis.js'));
const counters = new Map();
redis.incr = async (key) => {
  const n = (counters.get(key) ?? 0) + 1;
  counters.set(key, n);
  return n;
};
redis.expire = async () => 1;
redis.ttl = async () => 60;

const { mountMcp } = await import(dist('mcp/index.js'));
const { errorHandler } = await import(dist('middleware/errorHandler.js'));
const { loadMcpConfig } = await import(dist('mcp/config.js'));
const { MemoryRedis } = await import(dist('mcp/memoryRedis.js'));
const { RedisMcpStore } = await import(dist('mcp/store.js'));

const BASE = 'https://api.exemplo.test';
const FRONTEND = 'https://app.exemplo.test';
const checks = [];
const ok = (name) => {
  checks.push(name);
  console.log(`  ok  ${name}`);
};

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

// ── 1) módulo LIGADO ──
const loaded = loadMcpConfig(
  { MCP_ENABLED: 'true', PUBLIC_BASE_URL: BASE, FRONTEND_URL: FRONTEND },
  { isProduction: true },
);
assert.equal(loaded.enabled, true, `config inválida: ${loaded.reason}`);

const app = express();
const result = mountMcp(app, { apiCors: cors(), config: loaded, store: new RedisMcpStore(new MemoryRedis()) });
assert.equal(result.mounted, true);
app.use(errorHandler); // o handler de erros do app real (as rotas /api/mcp respondem através dele)
const { server, url } = await listen(app);

try {
  console.log('Módulo ligado (MCP_ENABLED=true):');

  const prm = await (await fetch(`${url}/.well-known/oauth-protected-resource`)).json();
  assert.equal(prm.resource, `${BASE}/mcp`);
  assert.deepEqual(prm.authorization_servers, [BASE]);
  ok('GET /.well-known/oauth-protected-resource devolve resource e authorization_servers');

  const prmPath = await (await fetch(`${url}/.well-known/oauth-protected-resource/mcp`)).json();
  assert.deepEqual(prmPath, prm);
  ok('GET /.well-known/oauth-protected-resource/mcp (RFC 9728) devolve o mesmo documento');

  const asm = await (await fetch(`${url}/.well-known/oauth-authorization-server`)).json();
  assert.equal(asm.issuer, BASE);
  assert.deepEqual(asm.code_challenge_methods_supported, ['S256']);
  assert.equal(asm.authorization_response_iss_parameter_supported, true);
  assert.deepEqual(asm.token_endpoint_auth_methods_supported, ['none']);
  assert.equal(asm.registration_endpoint, `${BASE}/register`);
  ok('GET /.well-known/oauth-authorization-server: S256, iss (RFC 9207), cliente público, DCR');

  const noToken = await fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(noToken.status, 401);
  const challenge = noToken.headers.get('www-authenticate') ?? '';
  assert.match(challenge, /^Bearer /);
  assert.ok(challenge.includes(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`), challenge);
  assert.ok(challenge.includes('scope="designer.read"'), challenge);
  ok(`POST /mcp sem token => 401 com WWW-Authenticate (${challenge.slice(0, 60)}…)`);

  const badOrigin = await fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example.net' },
    body: '{}',
  });
  assert.equal(badOrigin.status, 403);
  ok('POST /mcp com Origin desconhecido => 403');

  const reg = await fetch(`${url}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Fumaça',
      redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
      token_endpoint_auth_method: 'none',
    }),
  });
  assert.equal(reg.status, 201);
  const client = await reg.json();
  assert.equal(client.client_secret, undefined);
  ok('POST /register aceita o redirect do ChatGPT e não emite segredo');

  const evil = await fetch(`${url}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'x', redirect_uris: ['https://evil.example.net/cb'], token_endpoint_auth_method: 'none' }),
  });
  assert.equal(evil.status, 400);
  ok('POST /register recusa redirect_uri fora da allowlist');

  const challengeValue = createHash('sha256').update(randomBytes(48).toString('base64url')).digest('base64url');
  const authorizeUrl = new URL(`${url}/authorize`);
  Object.entries({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    code_challenge: challengeValue,
    code_challenge_method: 'S256',
    state: 'abc',
    resource: `${BASE}/mcp`,
    scope: 'designer.read',
  }).forEach(([k, v]) => authorizeUrl.searchParams.set(k, v));
  const authorize = await fetch(authorizeUrl, { redirect: 'manual' });
  assert.equal(authorize.status, 302);
  const location = new URL(authorize.headers.get('location'));
  assert.equal(location.origin, FRONTEND);
  assert.equal(location.pathname, '/mcp/consent');
  assert.ok(location.searchParams.get('request'));
  assert.equal(location.searchParams.get('code'), null);
  ok('GET /authorize redireciona ao consentimento do frontend, sem emitir código');

  const consent = await fetch(`${url}/api/mcp/consent/${location.searchParams.get('request')}`);
  assert.equal(consent.status, 401);
  ok('GET /api/mcp/consent/:id sem login => 401');

  const plain = await fetch(new URL(authorizeUrl.href.replace('S256', 'plain')), { redirect: 'manual' });
  assert.equal(plain.status, 302);
  assert.equal(new URL(plain.headers.get('location')).searchParams.get('error'), 'invalid_request');
  ok('GET /authorize com PKCE "plain" => erro invalid_request');
} finally {
  server.closeAllConnections();
  server.close();
}

// ── 2) módulo DESLIGADO (o padrão) ──
console.log('Módulo desligado (padrão):');
const off = express();
const offResult = mountMcp(off, { apiCors: cors(), config: loadMcpConfig({}, { isProduction: true }) });
assert.equal(offResult.mounted, false);
const { server: offServer, url: offUrl } = await listen(off);
try {
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server', '/authorize']) {
    assert.equal((await fetch(`${offUrl}${path}`)).status, 404, path);
  }
  assert.equal((await fetch(`${offUrl}/mcp`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status, 404);
  ok('nenhuma rota do conector existe sem MCP_ENABLED=true');
} finally {
  offServer.closeAllConnections();
  offServer.close();
}

// ── 3) produção sem PUBLIC_BASE_URL: falha fechada ──
const broken = express();
const brokenResult = mountMcp(broken, { apiCors: cors(), config: loadMcpConfig({ MCP_ENABLED: 'true' }, { isProduction: true }) });
assert.equal(brokenResult.mounted, false);
ok('MCP_ENABLED=true sem PUBLIC_BASE_URL em produção => não monta');

console.log(`\n${checks.length} verificações passaram contra dist/.`);
process.exit(0);
