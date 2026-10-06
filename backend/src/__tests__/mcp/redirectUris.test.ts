// Allowlist de redirect_uri: match exato, sem prefixo nem curinga solto.
import { describe, expect, it } from 'vitest';
import { compileRedirectPolicy } from '../../mcp/auth/redirectUris';

const chatgpt = ['https://chatgpt.com/connector_platform_oauth_redirect', 'https://chatgpt.com/connector/oauth/{id}'];

describe('compileRedirectPolicy', () => {
  const policy = compileRedirectPolicy(chatgpt, false);

  it('aceita exatamente os redirects do ChatGPT', () => {
    expect(policy.isAllowed('https://chatgpt.com/connector_platform_oauth_redirect')).toBe(true);
    expect(policy.isAllowed('https://chatgpt.com/connector/oauth/abc123')).toBe(true);
    expect(policy.isAllowed('https://chatgpt.com/connector/oauth/Ab_c-9')).toBe(true);
  });

  it.each([
    'https://chatgpt.com/connector_platform_oauth_redirect/',
    'https://chatgpt.com/connector_platform_oauth_redirect/x',
    'https://chatgpt.com/connector_platform_oauth_redirectX',
    'https://chatgpt.com/connector_platform_oauth_redirect?a=b',
    'https://chatgpt.com/connector_platform_oauth_redirect#frag',
    'https://chatgpt.com:8443/connector_platform_oauth_redirect',
    'https://chatgpt.com:443/connector_platform_oauth_redirect',
    'http://chatgpt.com/connector_platform_oauth_redirect',
    'https://CHATGPT.com/connector_platform_oauth_redirect',
    'https://chatgpt.com.evil.net/connector_platform_oauth_redirect',
    'https://evil.net/chatgpt.com/connector_platform_oauth_redirect',
    'https://user@chatgpt.com/connector_platform_oauth_redirect',
    'https://chatgpt.com@evil.net/connector_platform_oauth_redirect',
    'https://chatgpt.com/connector/oauth/',
    'https://chatgpt.com/connector/oauth/a/b',
    'https://chatgpt.com/connector/oauth/a%2Fb',
    'https://chatgpt.com/connector/oauth/../oauth/abc',
    'https://chatgpt.com/connector/oauth/{id}',
    'https://chatgpt.com/connector/oauth/a b',
    'javascript:alert(1)',
    '//chatgpt.com/connector_platform_oauth_redirect',
    '',
    'nao-e-url',
  ])('recusa %j', (uri) => {
    expect(policy.isAllowed(uri)).toBe(false);
  });

  it('recusa callback_id acima de 128 caracteres', () => {
    expect(policy.isAllowed(`https://chatgpt.com/connector/oauth/${'a'.repeat(129)}`)).toBe(false);
    expect(policy.isAllowed(`https://chatgpt.com/connector/oauth/${'a'.repeat(128)}`)).toBe(true);
  });

  it('recusa URIs gigantes', () => {
    expect(policy.isAllowed(`https://chatgpt.com/connector/oauth/${'a'.repeat(600)}`)).toBe(false);
  });

  it('loopback só com a flag, e só http em localhost/127.0.0.1/[::1]', () => {
    const sem = compileRedirectPolicy(chatgpt, false);
    const com = compileRedirectPolicy(chatgpt, true);
    for (const uri of ['http://localhost:6274/oauth/callback', 'http://127.0.0.1:6274/cb', 'http://[::1]:6274/cb']) {
      expect(sem.isAllowed(uri)).toBe(false);
      expect(com.isAllowed(uri)).toBe(true);
    }
    // A flag não abre mais nada:
    expect(com.isAllowed('http://evil.example/cb')).toBe(false);
    expect(com.isAllowed('http://localhost.evil.net/cb')).toBe(false);
    expect(com.isAllowed('http://localhost:6274/cb?x=1')).toBe(false);
    expect(com.isAllowed('http://0.0.0.0:6274/cb')).toBe(false);
  });

  it('o padrão da allowlist precisa ser https sem query/fragmento/credenciais', () => {
    expect(() => compileRedirectPolicy(['http://x.example/cb'], false)).toThrow(/https/);
    expect(() => compileRedirectPolicy(['https://x.example/cb?a=1'], false)).toThrow();
    expect(() => compileRedirectPolicy(['https://u:p@x.example/cb'], false)).toThrow();
    expect(() => compileRedirectPolicy(['nao-url'], false)).toThrow();
  });

  it('{id} só vale como segmento inteiro (não vira curinga no meio do texto)', () => {
    const p = compileRedirectPolicy(['https://x.example/a/{id}/done'], false);
    expect(p.isAllowed('https://x.example/a/xyz/done')).toBe(true);
    expect(p.isAllowed('https://x.example/a/xyz/other')).toBe(false);
    expect(p.isAllowed('https://x.example/a/xyz')).toBe(false);
    const q = compileRedirectPolicy(['https://x.example/a/pre{id}'], false);
    expect(q.isAllowed('https://x.example/a/preXYZ')).toBe(false); // literal "pre{id}", não prefixo
  });
});
