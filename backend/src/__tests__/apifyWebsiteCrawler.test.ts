import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchWebsiteReview, isApifyConfigured } from '../lib/apifyWebsiteCrawler';
import { config } from '../config.js';

describe('apifyWebsiteCrawler', () => {
  let originalToken: string;

  beforeEach(() => {
    vi.clearAllMocks();
    originalToken = config.apifyApiToken;
  });

  it('isApifyConfigured: false sem token, true com token', () => {
    (config as any).apifyApiToken = '';
    expect(isApifyConfigured()).toBe(false);
    (config as any).apifyApiToken = 'token-fake';
    expect(isApifyConfigured()).toBe(true);
    (config as any).apifyApiToken = originalToken;
  });

  it('sem token configurado: devolve null sem chamar fetch nenhum', async () => {
    (config as any).apifyApiToken = '';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchWebsiteReview('https://concorrente.com');

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    (config as any).apifyApiToken = originalToken;
    vi.unstubAllGlobals();
  });

  it('com token: monta as páginas com texto+screenshot, pede maxCrawlPages e saveScreenshots corretos', async () => {
    (config as any).apifyApiToken = 'token-fake';
    const fetchMock = vi.fn(async (_url: string, _options?: RequestInit) => ({
      ok: true,
      json: async () => ([
        { url: 'https://concorrente.com/', metadata: { title: 'Home', description: 'desc' }, text: 'Conteúdo da home', screenshotUrl: 'https://cdn.apify.com/home.jpg' },
        { url: 'https://concorrente.com/sobre', metadata: { title: 'Sobre' }, text: 'Conteúdo sobre', screenshotUrl: 'https://cdn.apify.com/sobre.jpg' },
        { url: 'https://concorrente.com/sem-texto' }, // sem `text`: descartada
      ]),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchWebsiteReview('https://concorrente.com', 5);

    expect(result).toEqual([
      { url: 'https://concorrente.com/', title: 'Home', description: 'desc', text: 'Conteúdo da home', screenshotUrl: 'https://cdn.apify.com/home.jpg' },
      { url: 'https://concorrente.com/sobre', title: 'Sobre', description: undefined, text: 'Conteúdo sobre', screenshotUrl: 'https://cdn.apify.com/sobre.jpg' },
    ]);

    expect(fetchMock.mock.calls[0]![0]).toContain('apify~website-content-crawler');
    expect(fetchMock.mock.calls[0]![0]).toContain('token-fake');
    const [, options] = fetchMock.mock.calls[0]! as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body).toEqual({ startUrls: [{ url: 'https://concorrente.com' }], maxCrawlPages: 5, saveScreenshots: true });

    (config as any).apifyApiToken = originalToken;
    vi.unstubAllGlobals();
  });

  it('nenhuma página com texto: devolve null', async () => {
    (config as any).apifyApiToken = 'token-fake';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ([{ url: 'https://concorrente.com/' }]) })));

    const result = await fetchWebsiteReview('https://concorrente.com');

    expect(result).toBeNull();
    (config as any).apifyApiToken = originalToken;
    vi.unstubAllGlobals();
  });

  it('Apify fora do ar (status != ok): devolve null sem lançar', async () => {
    (config as any).apifyApiToken = 'token-fake';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));

    const result = await fetchWebsiteReview('https://concorrente.com');

    expect(result).toBeNull();
    (config as any).apifyApiToken = originalToken;
    vi.unstubAllGlobals();
  });

  it('rede fora: nunca lança, devolve null', async () => {
    (config as any).apifyApiToken = 'token-fake';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rede fora'); }));

    await expect(fetchWebsiteReview('https://concorrente.com')).resolves.toBeNull();
    (config as any).apifyApiToken = originalToken;
    vi.unstubAllGlobals();
  });
});
