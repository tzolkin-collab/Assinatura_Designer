import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { baixarLogoComSeguranca } from '../lib/logoTransparency';

function resposta(bytes: Uint8Array, headers: Record<string, string> = {}, status = 200) {
  return new Response(bytes, { status, headers });
}

describe('baixarLogoComSeguranca (B1: o servidor não pode ser usado como proxy interno)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost:4000/api/health',
    'http://127.0.0.1:6379/',
    'http://192.168.0.10/logo.png',
    'http://[::1]/logo.png',
    'ftp://exemplo.com/logo.png',
  ])('não faz requisição para %s', async (url) => {
    expect(await baixarLogoComSeguranca(url)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('baixa uma URL pública literal e não segue redirect', async () => {
    fetchMock.mockResolvedValue(resposta(new Uint8Array([1, 2, 3])));
    const buf = await baixarLogoComSeguranca('https://8.8.8.8/logo.png');
    expect(buf?.length).toBe(3);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
    expect(fetchMock.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  });

  it('recusa quando o Content-Length declarado passa do teto', async () => {
    fetchMock.mockResolvedValue(resposta(new Uint8Array(10), { 'content-length': '999999999' }));
    expect(await baixarLogoComSeguranca('https://8.8.8.8/grande.png', 1024)).toBeNull();
  });

  it('recusa quando o corpo passa do teto mesmo sem Content-Length honesto', async () => {
    fetchMock.mockResolvedValue(resposta(new Uint8Array(5000)));
    expect(await baixarLogoComSeguranca('https://8.8.8.8/mentira.png', 1024)).toBeNull();
  });

  it('devolve null para resposta de erro', async () => {
    fetchMock.mockResolvedValue(resposta(new Uint8Array(0), {}, 404));
    expect(await baixarLogoComSeguranca('https://8.8.8.8/nao-existe.png')).toBeNull();
  });
});

describe('isPublicHttpUrl — IPv6 literal (URL.hostname vem com colchetes)', () => {
  it.each([
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://[fe80::1]/',
    'http://[fd00::1]/',
  ])('recusa %s', async (u) => {
    const { isPublicHttpUrl } = await import('../lib/validate');
    expect(isPublicHttpUrl(u)).toBe(false);
  });

  it('aceita IPv6 público', async () => {
    const { isPublicHttpUrl } = await import('../lib/validate');
    expect(isPublicHttpUrl('http://[2606:4700:4700::1111]/')).toBe(true);
  });
});
