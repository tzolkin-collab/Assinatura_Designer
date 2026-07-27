import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/r2', () => ({
  uploadFileToR2: vi.fn(async () => 'https://r2.example.com/brands/brand-1/generated/unsplash-abc.jpg'),
}));

import { searchUnsplashPhoto, isUnsplashConfigured } from '../lib/unsplash';
import { uploadFileToR2 } from '../lib/r2';
import { config } from '../config.js';

const fakeSearchResponse = (overrides: Partial<Record<string, unknown>> = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({
    results: [
      {
        id: 'abc',
        urls: { regular: 'https://images.unsplash.com/abc.jpg' },
        links: { html: 'https://unsplash.com/photos/abc', download_location: 'https://api.unsplash.com/photos/abc/download' },
        user: { name: 'Fotógrafo X', links: { html: 'https://unsplash.com/@fotografox' } },
      },
    ],
    ...overrides,
  }),
});

const fakeImageResponse = () => ({
  ok: true,
  arrayBuffer: async () => new TextEncoder().encode('fake-jpeg-bytes').buffer,
});

describe('unsplash', () => {
  let originalKey: string;

  beforeEach(() => {
    vi.clearAllMocks();
    originalKey = config.unsplashAccessKey;
  });

  it('isUnsplashConfigured: false sem chave, true com chave', () => {
    (config as any).unsplashAccessKey = '';
    expect(isUnsplashConfigured()).toBe(false);
    (config as any).unsplashAccessKey = 'chave-fake';
    expect(isUnsplashConfigured()).toBe(true);
    (config as any).unsplashAccessKey = originalKey;
  });

  it('sem chave configurada: devolve null sem chamar fetch nenhum (fallback desligado)', async () => {
    (config as any).unsplashAccessKey = '';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await searchUnsplashPhoto('escritório moderno', 1080, 1080, 'brand-1');

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    (config as any).unsplashAccessKey = originalKey;
    vi.unstubAllGlobals();
  });

  it('com chave: busca, baixa, sobe pro R2 e devolve crédito do fotógrafo', async () => {
    (config as any).unsplashAccessKey = 'chave-fake';
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/search/photos')) return fakeSearchResponse();
      if (url.includes('images.unsplash.com')) return fakeImageResponse();
      if (url.includes('/download')) return { ok: true, json: async () => ({}) };
      throw new Error(`URL inesperada: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchUnsplashPhoto('escritório moderno', 1080, 1080, 'brand-1');

    expect(result).toEqual({
      url: 'https://r2.example.com/brands/brand-1/generated/unsplash-abc.jpg',
      photographerName: 'Fotógrafo X',
      photographerProfileUrl: 'https://unsplash.com/@fotografox',
      photoPageUrl: 'https://unsplash.com/photos/abc',
    });
    expect(uploadFileToR2).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/search/photos'))).toBe(true);

    (config as any).unsplashAccessKey = originalKey;
    vi.unstubAllGlobals();
  });

  it('busca sem resultado nenhum: devolve null sem tentar baixar nada', async () => {
    (config as any).unsplashAccessKey = 'chave-fake';
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchUnsplashPhoto('algo muito específico', 1080, 1920, 'brand-1');

    expect(result).toBeNull();
    expect(uploadFileToR2).not.toHaveBeenCalled();

    (config as any).unsplashAccessKey = originalKey;
    vi.unstubAllGlobals();
  });

  it('API do Unsplash fora do ar: nunca lança, devolve null', async () => {
    (config as any).unsplashAccessKey = 'chave-fake';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rede fora'); }));

    await expect(searchUnsplashPhoto('qualquer coisa', 1080, 1080, 'brand-1')).resolves.toBeNull();

    (config as any).unsplashAccessKey = originalKey;
    vi.unstubAllGlobals();
  });
});
