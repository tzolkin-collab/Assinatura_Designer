// Agente-agnóstico: presets de cliente (ChatGPT, Claude), lista explícita e modo aberto para agentes
// ainda sem redirect conhecido (ex.: Gemini Spark). O que NÃO pode mudar: segredo, PKCE e consentimento.
import '../client'; // mocka prisma e redis do processo de teste (precisa vir antes do resto)
import { describe, expect, it } from 'vitest';
import { loadMcpConfig } from '../../mcp/config';
import { CLIENT_PRESETS, resolveClientPresets } from '../../mcp/clients';
import { buildHarness, registerClient } from './harness';

const BASE = { MCP_ENABLED: 'true', PUBLIC_BASE_URL: 'https://api.example.test', FRONTEND_URL: 'https://app.example.test' };

function policyOf(env: Record<string, string> = {}) {
  const loaded = loadMcpConfig({ ...BASE, ...env }, { isProduction: true });
  if (!loaded.enabled) throw new Error(`config desligada: ${loaded.reason}`);
  return loaded.config;
}

const CHATGPT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const CLAUDE_COM = 'https://claude.com/api/mcp/auth_callback';

describe('presets de cliente', () => {
  it('por padrão aceitam ChatGPT e Claude (claude.ai e claude.com), e nada além', () => {
    const c = policyOf();
    expect(c.clientPresets).toEqual(['chatgpt', 'claude']);
    expect(c.redirectPolicy.isAllowed(CHATGPT)).toBe(true);
    expect(c.redirectPolicy.isAllowed('https://chatgpt.com/connector/oauth/abc_123')).toBe(true);
    expect(c.redirectPolicy.isAllowed(CLAUDE)).toBe(true);
    expect(c.redirectPolicy.isAllowed(CLAUDE_COM)).toBe(true);
    expect(c.redirectPolicy.isAllowed('https://agente.example.test/cb')).toBe(false);
    expect(c.redirectPolicy.isAllowed('https://claude.ai.evil.test/api/mcp/auth_callback')).toBe(false);
    expect(c.allowAnyHttpsRedirect).toBe(false);
  });

  it('MCP_CLIENT_PRESETS escolhe quais agentes valem', () => {
    const c = policyOf({ MCP_CLIENT_PRESETS: 'claude' });
    expect(c.redirectPolicy.isAllowed(CLAUDE)).toBe(true);
    expect(c.redirectPolicy.isAllowed(CHATGPT)).toBe(false);
  });

  it('preset desconhecido é erro de configuração (falha fechada)', () => {
    const loaded = loadMcpConfig({ ...BASE, MCP_CLIENT_PRESETS: 'chatgpt,spark' }, { isProduction: true });
    expect(loaded.enabled).toBe(false);
    expect(!loaded.enabled && loaded.misconfigured).toBe(true);
    expect(!loaded.enabled && loaded.reason).toMatch(/spark/);
  });

  it('MCP_ALLOWED_REDIRECT_URIS (lista explícita) SUBSTITUI os presets', () => {
    const c = policyOf({ MCP_ALLOWED_REDIRECT_URIS: 'https://agente.example.test/cb' });
    expect(c.redirectPolicy.isAllowed('https://agente.example.test/cb')).toBe(true);
    expect(c.redirectPolicy.isAllowed(CHATGPT)).toBe(false);
    expect(c.clientPresets).toEqual([]);
  });

  it('resolveClientPresets ignora repetição e caixa, e devolve o que não conhece', () => {
    const r = resolveClientPresets(['ChatGPT', 'claude', 'chatgpt', 'gemini']);
    expect(r.names).toEqual(['chatgpt', 'claude']);
    expect(r.unknown).toEqual(['gemini']);
    expect(r.patterns).toEqual([...CLIENT_PRESETS.chatgpt.redirects, ...CLIENT_PRESETS.claude.redirects]);
  });
});

describe('modo aberto (agentes sem redirect conhecido)', () => {
  const open = () => policyOf({ MCP_ALLOW_ANY_HTTPS_REDIRECT: 'true' });

  it('aceita um redirect https de qualquer domínio', () => {
    const c = open();
    expect(c.allowAnyHttpsRedirect).toBe(true);
    expect(c.redirectPolicy.isAllowed('https://spark.agente.example.test/oauth/callback')).toBe(true);
  });

  it('continua recusando http, loopback, IP, query, fragmento, userinfo e forma não canônica', () => {
    const p = open().redirectPolicy;
    expect(p.isAllowed('http://agente.example.test/cb')).toBe(false);
    expect(p.isAllowed('https://localhost/cb')).toBe(false);
    expect(p.isAllowed('https://127.0.0.1/cb')).toBe(false);
    expect(p.isAllowed('https://[::1]/cb')).toBe(false);
    expect(p.isAllowed('https://agente.example.test/cb?x=1')).toBe(false);
    expect(p.isAllowed('https://agente.example.test/cb#frag')).toBe(false);
    expect(p.isAllowed('https://user:pw@agente.example.test/cb')).toBe(false);
    expect(p.isAllowed('https://AGENTE.example.test/cb')).toBe(false); // host em maiúsculas: forma não canônica
    expect(p.isAllowed('https://semponto/cb')).toBe(false);
  });

  it('o registro (DCR) de um agente novo só funciona no modo aberto, e segue só público com PKCE', async () => {
    const fechado = buildHarness();
    const r1 = await registerClient(fechado.app, { redirect_uris: ['https://spark.agente.example.test/cb'] });
    expect(r1.status).toBe(400);

    const aberto = buildHarness({ env: { MCP_ALLOW_ANY_HTTPS_REDIRECT: 'true' } });
    const r2 = await registerClient(aberto.app, { redirect_uris: ['https://spark.agente.example.test/cb'] });
    expect(r2.status).toBe(201);
    expect(r2.body.client_secret).toBeUndefined();
    expect(r2.body.token_endpoint_auth_method).toBe('none');

    const comSegredo = await registerClient(aberto.app, {
      redirect_uris: ['https://spark.agente.example.test/cb'],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    expect(comSegredo.status).toBe(400);
  });
});

describe('registro dos agentes conhecidos', () => {
  it('Claude registra com o callback oficial', async () => {
    const h = buildHarness();
    const r = await registerClient(h.app, { redirect_uris: [CLAUDE], client_name: 'Claude' });
    expect(r.status).toBe(201);
  });

  it('Claude com host parecido é recusado', async () => {
    const h = buildHarness();
    const r = await registerClient(h.app, { redirect_uris: ['https://claude.ai.attacker.test/api/mcp/auth_callback'] });
    expect(r.status).toBe(400);
  });
});
