import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/r2.js', () => ({
  r2KeyFromUrl: (u: string) => (u.startsWith('https://cdn.test/') ? u.slice('https://cdn.test/'.length) : null),
  uploadFileToR2: vi.fn(async () => 'https://cdn.test/logos/derivada.png'),
}));
vi.mock('../lib/logoBackground.js', () => ({
  analyzeLogo: vi.fn(async () => ({
    bgHex: '#410B1C',
    ink: '#8E232D',
    alreadyTransparent: false,
    twoColor: true,
    transparentPng: Buffer.from('x'),
  })),
}));

import { enrichLogoFiles } from '../lib/logoEnrich';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('enrichLogoFiles', () => {
  it('mede o logo novo e grava fundo, tinta e versão transparente', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })));
    const [f] = await enrichLogoFiles([{ url: 'https://cdn.test/a.png', label: 'A' }]);
    expect(f).toMatchObject({ bgHex: '#410B1C', ink: '#8E232D', transparentUrl: 'https://cdn.test/logos/derivada.png', label: 'A' });
  });

  it('logo já medido (mesma URL) reaproveita e não baixa de novo', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const [f] = await enrichLogoFiles(
      [{ url: 'https://cdn.test/a.png' }],
      [{ url: 'https://cdn.test/a.png', bgHex: '#112233', ink: '#FFFFFF', transparentUrl: 'https://cdn.test/t.png' }],
    );
    expect(f).toMatchObject({ bgHex: '#112233', transparentUrl: 'https://cdn.test/t.png' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('campos medidos enviados pelo cliente são descartados', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    const [f] = await enrichLogoFiles([{ url: 'https://cdn.test/a.png', bgHex: '#000000', transparentUrl: 'https://evil.test/x.png' }]);
    expect(f!.bgHex).toBeUndefined();
    expect(f!.transparentUrl).toBeUndefined();
  });

  it('URL fora do nosso bucket nunca é baixada', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const [f] = await enrichLogoFiles([{ url: 'https://outro.test/a.png' }]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(f!.bgHex).toBeUndefined();
  });

  it('falha ao medir não derruba: o logo segue sem os campos', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('rede');
    }));
    const [f] = await enrichLogoFiles([{ url: 'https://cdn.test/a.png' }]);
    expect(f).toMatchObject({ url: 'https://cdn.test/a.png' });
    expect(f!.bgHex).toBeUndefined();
  });
});
