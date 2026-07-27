import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchInstagramProfileReview, fetchInstagramProfileReviews, isApifyConfigured } from '../lib/apifyInstagram';
import { config } from '../config.js';

function mockActorByResultsType(handlers: Record<string, unknown>) {
  return vi.fn(async (_url: string, options?: RequestInit) => {
    const body = JSON.parse((options?.body as string) ?? '{}');
    const items = handlers[body.resultsType] ?? [];
    return { ok: true, json: async () => items };
  });
}

describe('apifyInstagram', () => {
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

    const result = await fetchInstagramProfileReview('https://www.instagram.com/marca/');

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    (config as any).apifyApiToken = originalToken;
    vi.unstubAllGlobals();
  });

  it('com token: junta perfil (details) + posts com imagem, monta o review completo', async () => {
    (config as any).apifyApiToken = 'token-fake';
    const fetchMock = mockActorByResultsType({
      details: [{
        username: 'marca', fullName: 'Marca X', biography: 'Bio oficial', followersCount: 5000, followsCount: 120, verified: true,
      }],
      posts: [
        { ownerUsername: 'marca', caption: 'sem displayUrl' },
        { ownerUsername: 'marca', caption: 'post 1', displayUrl: 'https://cdn.instagram.com/foto1.jpg', likesCount: 100, commentsCount: 5, hashtags: ['marca'] },
        { ownerUsername: 'marca', caption: 'post 2', displayUrl: 'https://cdn.instagram.com/foto2.jpg', likesCount: 200, commentsCount: 8 },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchInstagramProfileReview('https://www.instagram.com/marca/', 12);

    expect(result).toEqual({
      username: 'marca',
      fullName: 'Marca X',
      biography: 'Bio oficial',
      followersCount: 5000,
      followsCount: 120,
      verified: true,
      posts: [
        { imageUrl: 'https://cdn.instagram.com/foto1.jpg', caption: 'post 1', likesCount: 100, commentsCount: 5, hashtags: ['marca'] },
        { imageUrl: 'https://cdn.instagram.com/foto2.jpg', caption: 'post 2', likesCount: 200, commentsCount: 8, hashtags: undefined },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect(call[0]).toContain('apify~instagram-scraper');
      expect(call[0]).toContain('token-fake');
    }
    const postsCall = fetchMock.mock.calls.find((c) => JSON.parse((c[1] as RequestInit).body as string).resultsType === 'posts')!;
    expect(JSON.parse((postsCall[1] as RequestInit).body as string)).toEqual({
      directUrls: ['https://www.instagram.com/marca/'], resultsType: 'posts', resultsLimit: 12,
    });

    (config as any).apifyApiToken = originalToken;
    vi.unstubAllGlobals();
  });

  it('nenhum post tem imagem e sem detalhes de perfil: devolve null', async () => {
    (config as any).apifyApiToken = 'token-fake';
    vi.stubGlobal('fetch', mockActorByResultsType({ details: [], posts: [{ ownerUsername: 'marca' }] }));

    const result = await fetchInstagramProfileReview('https://www.instagram.com/marca/');

    expect(result).toBeNull();
    (config as any).apifyApiToken = originalToken;
    vi.unstubAllGlobals();
  });

  it('REGRESSÃO: handle inventado (Apify devolve item de erro "not_found" com a MESMA forma de um perfil válido) — devolve null em vez de um review vazio disfarçado de real', async () => {
    (config as any).apifyApiToken = 'token-fake';
    vi.stubGlobal('fetch', mockActorByResultsType({
      details: [{ url: 'https://www.instagram.com/inventado/', username: 'inventado', error: 'not_found', errorDescription: 'Post does not exist' }],
      posts: [{ url: 'https://www.instagram.com/inventado/', username: 'inventado', error: 'not_found', errorDescription: 'Post does not exist' }],
    }));

    const result = await fetchInstagramProfileReview('https://www.instagram.com/inventado/');

    expect(result).toBeNull();
    (config as any).apifyApiToken = originalToken;
    vi.unstubAllGlobals();
  });

  it('sem posts com imagem mas COM detalhes de perfil: ainda devolve o review (bio/seguidores), posts vazio', async () => {
    (config as any).apifyApiToken = 'token-fake';
    vi.stubGlobal('fetch', mockActorByResultsType({
      details: [{ username: 'marca', biography: 'Só bio' }],
      posts: [],
    }));

    const result = await fetchInstagramProfileReview('https://www.instagram.com/marca/');

    expect(result).toEqual({
      username: 'marca', fullName: undefined, biography: 'Só bio',
      followersCount: undefined, followsCount: undefined, verified: undefined, posts: [],
    });
    (config as any).apifyApiToken = originalToken;
    vi.unstubAllGlobals();
  });

  it('Apify fora do ar (status != ok): devolve null sem lançar', async () => {
    (config as any).apifyApiToken = 'token-fake';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));

    const result = await fetchInstagramProfileReview('https://www.instagram.com/marca/');

    expect(result).toBeNull();
    (config as any).apifyApiToken = originalToken;
    vi.unstubAllGlobals();
  });

  it('rede fora: nunca lança, devolve null', async () => {
    (config as any).apifyApiToken = 'token-fake';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rede fora'); }));

    await expect(fetchInstagramProfileReview('https://www.instagram.com/marca/')).resolves.toBeNull();
    (config as any).apifyApiToken = originalToken;
    vi.unstubAllGlobals();
  });

  describe('fetchInstagramProfileReviews (lote)', () => {
    it('busca N perfis com só 2 execuções do ator NO TOTAL (não 2×N) e correlaciona cada resultado pela URL certa', async () => {
      (config as any).apifyApiToken = 'token-fake';
      const fetchMock = mockActorByResultsType({
        details: [
          { username: 'rivala', fullName: 'Rival A', followersCount: 1000 },
          { username: 'rivalb', fullName: 'Rival B', followersCount: 2000 },
        ],
        posts: [
          { ownerUsername: 'rivala', displayUrl: 'https://cdn.instagram.com/rivala-1.jpg', caption: 'post A' },
          { ownerUsername: 'rivalb', displayUrl: 'https://cdn.instagram.com/rivalb-1.jpg', caption: 'post B' },
        ],
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await fetchInstagramProfileReviews([
        'https://www.instagram.com/rivala/',
        'https://www.instagram.com/rivalb/',
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(2); // 1 'details' + 1 'posts' pro LOTE inteiro, não 4
      const detailsCall = fetchMock.mock.calls.find((c) => JSON.parse((c[1] as RequestInit).body as string).resultsType === 'details')!;
      expect(JSON.parse((detailsCall[1] as RequestInit).body as string).directUrls).toEqual([
        'https://www.instagram.com/rivala/', 'https://www.instagram.com/rivalb/',
      ]);

      expect(result.get('https://www.instagram.com/rivala/')).toEqual({
        username: 'rivala', fullName: 'Rival A', biography: undefined, followersCount: 1000, followsCount: undefined, verified: undefined,
        posts: [{ imageUrl: 'https://cdn.instagram.com/rivala-1.jpg', caption: 'post A', likesCount: undefined, commentsCount: undefined, hashtags: undefined }],
      });
      expect(result.get('https://www.instagram.com/rivalb/')).toEqual({
        username: 'rivalb', fullName: 'Rival B', biography: undefined, followersCount: 2000, followsCount: undefined, verified: undefined,
        posts: [{ imageUrl: 'https://cdn.instagram.com/rivalb-1.jpg', caption: 'post B', likesCount: undefined, commentsCount: undefined, hashtags: undefined }],
      });
      (config as any).apifyApiToken = originalToken;
      vi.unstubAllGlobals();
    });

    it('1 perfil do lote não existe (handle inventado) — os outros do MESMO lote continuam válidos', async () => {
      (config as any).apifyApiToken = 'token-fake';
      vi.stubGlobal('fetch', mockActorByResultsType({
        details: [
          { url: 'https://www.instagram.com/inventado/', username: 'inventado', error: 'not_found' },
          { username: 'rivalb', biography: 'Bio real' },
        ],
        posts: [
          { ownerUsername: 'rivalb', displayUrl: 'https://cdn.instagram.com/rivalb-1.jpg' },
        ],
      }));

      const result = await fetchInstagramProfileReviews([
        'https://www.instagram.com/inventado/',
        'https://www.instagram.com/rivalb/',
      ]);

      expect(result.get('https://www.instagram.com/inventado/')).toBeNull();
      expect(result.get('https://www.instagram.com/rivalb/')?.biography).toBe('Bio real');
      (config as any).apifyApiToken = originalToken;
      vi.unstubAllGlobals();
    });

    it('sem token: devolve todas as URLs como null, sem chamar fetch', async () => {
      (config as any).apifyApiToken = '';
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const result = await fetchInstagramProfileReviews(['https://www.instagram.com/a/', 'https://www.instagram.com/b/']);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.get('https://www.instagram.com/a/')).toBeNull();
      expect(result.get('https://www.instagram.com/b/')).toBeNull();
      (config as any).apifyApiToken = originalToken;
      vi.unstubAllGlobals();
    });
  });
});
