// Configuração do módulo MCP: desligado por padrão, falha fechada quando mal configurado,
// e issuer/resource SEMPRE derivados de PUBLIC_BASE_URL.
import { describe, expect, it } from 'vitest';
import { DEFAULT_ALLOWED_REDIRECT_URIS, loadMcpConfig, normalizeScopes } from '../../mcp/config';

const base = { MCP_ENABLED: 'true', PUBLIC_BASE_URL: 'https://api.exemplo.com' };
const prod = { isProduction: true };

describe('loadMcpConfig', () => {
  it('vem DESLIGADO por padrão (a feature pode ir ao ar sem ligar)', () => {
    const r = loadMcpConfig({ PUBLIC_BASE_URL: 'https://api.exemplo.com' }, prod);
    expect(r.enabled).toBe(false);
    if (!r.enabled) expect(r.misconfigured).toBe(false);
  });

  it.each(['false', '1', 'TRUE', 'yes', ''])('MCP_ENABLED=%j não liga o módulo', (value) => {
    expect(loadMcpConfig({ ...base, MCP_ENABLED: value }, prod).enabled).toBe(false);
  });

  it('em produção, sem PUBLIC_BASE_URL o módulo NÃO monta e explica por quê', () => {
    const r = loadMcpConfig({ MCP_ENABLED: 'true' }, prod);
    expect(r.enabled).toBe(false);
    if (!r.enabled) {
      expect(r.misconfigured).toBe(true);
      expect(r.reason).toMatch(/PUBLIC_BASE_URL/);
    }
  });

  it('fora de produção cai em localhost (dev), derivado da porta — nunca de um header', () => {
    const r = loadMcpConfig({ MCP_ENABLED: 'true' }, { isProduction: false, port: 4321 });
    expect(r.enabled).toBe(true);
    if (r.enabled) expect(r.config.issuer).toBe('http://localhost:4321');
  });

  it('deriva issuer (sem barra final) e resource de PUBLIC_BASE_URL', () => {
    const r = loadMcpConfig({ ...base, PUBLIC_BASE_URL: 'https://api.exemplo.com/' }, prod);
    expect(r.enabled).toBe(true);
    if (r.enabled) {
      expect(r.config.issuer).toBe('https://api.exemplo.com');
      expect(r.config.resourceUrl.href).toBe('https://api.exemplo.com/mcp');
      expect(r.config.resourceMetadataUrl).toBe('https://api.exemplo.com/.well-known/oauth-protected-resource/mcp');
    }
  });

  it.each([
    ['com path', 'https://api.exemplo.com/v1'],
    ['com query', 'https://api.exemplo.com/?a=1'],
    ['http fora do loopback', 'http://api.exemplo.com'],
    ['com credenciais', 'https://u:p@api.exemplo.com'],
    ['inválida', 'isto nao e url'],
  ])('rejeita PUBLIC_BASE_URL %s', (_nome, url) => {
    const r = loadMcpConfig({ ...base, PUBLIC_BASE_URL: url }, prod);
    expect(r.enabled).toBe(false);
    if (!r.enabled) expect(r.misconfigured).toBe(true);
  });

  it('aceita http só em loopback (dev)', () => {
    expect(loadMcpConfig({ ...base, PUBLIC_BASE_URL: 'http://localhost:4000' }, prod).enabled).toBe(true);
  });

  it('FRONTEND_URL cai no primeiro CORS_ORIGIN quando não definido', () => {
    const r = loadMcpConfig(base, { ...prod, corsOrigin: 'https://app.exemplo.com, https://outro.exemplo.com' });
    if (!r.enabled) throw new Error('esperava habilitado');
    expect(r.config.frontendUrl.origin).toBe('https://app.exemplo.com');
    expect(r.config.allowedOrigins).toContain('https://app.exemplo.com');
    expect(r.config.allowedOrigins).toContain('https://api.exemplo.com');
  });

  it('FRONTEND_URL explícito vence o CORS_ORIGIN', () => {
    const r = loadMcpConfig({ ...base, FRONTEND_URL: 'https://painel.exemplo.com/qualquer/path' }, { ...prod, corsOrigin: 'https://x.com' });
    if (!r.enabled) throw new Error('esperava habilitado');
    expect(r.config.frontendUrl.href).toBe('https://painel.exemplo.com/');
  });

  it('o padrão de redirects são os dois do ChatGPT', () => {
    expect(DEFAULT_ALLOWED_REDIRECT_URIS).toEqual([
      'https://chatgpt.com/connector_platform_oauth_redirect',
      'https://chatgpt.com/connector/oauth/{id}',
    ]);
    const r = loadMcpConfig(base, prod);
    if (!r.enabled) throw new Error('esperava habilitado');
    expect(r.config.redirectPolicy.isAllowed('https://chatgpt.com/connector_platform_oauth_redirect')).toBe(true);
    expect(r.config.redirectPolicy.isAllowed('https://chatgpt.com/connector/oauth/abc')).toBe(true);
    expect(r.config.redirectPolicy.isAllowed('https://evil.example/cb')).toBe(false);
  });

  it('MCP_ALLOWED_REDIRECT_URIS inválido derruba a montagem (em vez de abrir demais)', () => {
    const r = loadMcpConfig({ ...base, MCP_ALLOWED_REDIRECT_URIS: 'http://inseguro.example/cb' }, prod);
    expect(r.enabled).toBe(false);
    if (!r.enabled) expect(r.misconfigured).toBe(true);
  });

  it('MCP_ALLOWED_ORIGINS acrescenta origens ao Origin permitido', () => {
    const r = loadMcpConfig({ ...base, MCP_ALLOWED_ORIGINS: 'https://inspector.exemplo.com' }, prod);
    if (!r.enabled) throw new Error('esperava habilitado');
    expect(r.config.allowedOrigins).toContain('https://inspector.exemplo.com');
  });
});

describe('normalizeScopes', () => {
  it('escrita implica leitura', () => {
    expect(normalizeScopes(['designer.write'])).toEqual(['designer.read', 'designer.write']);
  });
  it('mantém só leitura e remove duplicatas', () => {
    expect(normalizeScopes(['designer.read', 'designer.read'])).toEqual(['designer.read']);
  });
});
