import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from './client';

vi.mock('../lib/validate', () => ({
  isPublicHttpUrlResolved: vi.fn(async () => true),
}));

vi.mock('../lib/r2', () => ({
  s3: { send: vi.fn(async () => ({})) },
}));

vi.mock('../lib/geminiRetry', () => ({
  generateWithRetry: vi.fn(),
  humanizeGeminiError: vi.fn((err) => err),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {},
  Type: { OBJECT: 'OBJECT', STRING: 'STRING', ARRAY: 'ARRAY', NUMBER: 'NUMBER' },
}));

vi.mock('../lib/apifyInstagram', () => ({
  fetchInstagramProfileReview: vi.fn(async () => null),
}));

vi.mock('../lib/apifyWebsiteCrawler', () => ({
  fetchWebsiteReview: vi.fn(async () => null),
}));

import { analyzeReferenceBackground, analyzeReferenceWithUploadedImage, analyzeReferenceFromCollectedMaterial } from '../lib/referenceSync';
import { generateWithRetry } from '../lib/geminiRetry';
import { fetchInstagramProfileReview } from '../lib/apifyInstagram';
import { fetchWebsiteReview } from '../lib/apifyWebsiteCrawler';

const brandRecord = {
  id: 'brand-1',
  name: 'Marca X',
  config: { guidelines: 'Tom direto e premium', colors: ['#111111'] },
};

const analiseFake = (overrides: Partial<Record<string, unknown>> = {}) => JSON.stringify({
  archetype: 'O Criador',
  toneOfVoice: 'Direto',
  density: 'Alta',
  palette: ['#112233'],
  markers: [{ id: 'm1', x: 10, y: 10, label: 'ok' }],
  insightsText: '# Ótimo\n texto',
  ...overrides,
});

describe('analyzeReferenceBackground', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.brand.findUnique.mockResolvedValue(brandRecord as any);
    prismaMock.reference.update.mockResolvedValue({} as any);
  });

  it('sem Apify pro site: cai no screenshot único via Microlink como inlineData (comportamento antigo preservado)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('api.microlink.io')) {
        return { ok: true, json: async () => ({ status: 'success', data: { screenshot: { url: 'https://cdn.microlink.io/shot.png' } } }) } as any;
      }
      if (url.includes('cdn.microlink.io')) {
        return { ok: true, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => new TextEncoder().encode('fake-png').buffer } as any;
      }
      // scrape do site
      return { ok: true, text: async () => '<html><body>Site de verdade</body></html>' } as any;
    }));
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({ text: analiseFake() });

    await analyzeReferenceBackground('ref-1', 'marca-x', 'Concorrente', 'https://concorrente.com', 'WEBSITE');

    const call = (generateWithRetry as ReturnType<typeof vi.fn>).mock.calls[0];
    const parts = call[1].contents.parts as Array<{ text?: string; inlineData?: { mimeType: string } }>;
    expect(parts.filter((p) => p.inlineData?.mimeType === 'image/png')).toHaveLength(1);
    // O prompt precisa instruir a IA a confiar na imagem, não inventar hex
    expect(parts[0]!.text).toContain('imagens REAIS estão anexadas');
    expect(parts[0]!.text).not.toContain('array vazio em vez de inventar hex');
  });

  it('Apify rastreou várias páginas do site: manda uma imagem por página (múltiplos inlineData), texto agregado de todas', async () => {
    (fetchWebsiteReview as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { url: 'https://concorrente.com/', title: 'Home', text: 'Conteúdo da home', screenshotUrl: 'https://cdn.apify.example/home.jpg' },
      { url: 'https://concorrente.com/sobre', title: 'Sobre', text: 'Conteúdo sobre', screenshotUrl: 'https://cdn.apify.example/sobre.jpg' },
    ]);
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes('cdn.apify.example')) {
        return { ok: true, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => new TextEncoder().encode('fake-jpeg').buffer } as any;
      }
      throw new Error(`URL inesperada: ${url}`);
    });
    vi.stubGlobal('fetch', fetchSpy);
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({ text: analiseFake() });

    await analyzeReferenceBackground('ref-1', 'marca-x', 'Concorrente', 'https://concorrente.com', 'WEBSITE');

    expect(fetchSpy.mock.calls.some((c) => (c[0] as string).includes('microlink'))).toBe(false); // não precisou do fallback

    const call = (generateWithRetry as ReturnType<typeof vi.fn>).mock.calls[0];
    const parts = call[1].contents.parts as Array<{ text?: string; inlineData?: { mimeType: string } }>;
    expect(parts.filter((p) => p.inlineData?.mimeType === 'image/jpeg')).toHaveLength(2);
    expect(parts[0]!.text).toContain('Conteúdo da home');
    expect(parts[0]!.text).toContain('Conteúdo sobre');
  });

  it('grava galleryImageUrls com TODAS as imagens coletadas, não só a capa', async () => {
    (fetchWebsiteReview as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { url: 'https://concorrente.com/', title: 'Home', text: 'Conteúdo da home', screenshotUrl: 'https://cdn.apify.example/home.jpg' },
      { url: 'https://concorrente.com/sobre', title: 'Sobre', text: 'Conteúdo sobre', screenshotUrl: 'https://cdn.apify.example/sobre.jpg' },
    ]);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('cdn.apify.example')) {
        return { ok: true, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => new TextEncoder().encode('fake-jpeg').buffer } as any;
      }
      throw new Error(`URL inesperada: ${url}`);
    }));
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({ text: analiseFake() });

    await analyzeReferenceBackground('ref-1', 'marca-x', 'Concorrente', 'https://concorrente.com', 'WEBSITE');

    const updateCall = (prismaMock.reference.update as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(updateCall.data.galleryImageUrls).toHaveLength(2);
    expect(updateCall.data.imageUrl).toBe(updateCall.data.galleryImageUrls[0]);
  });

  it('sem screenshot nenhum (Apify e Microlink falham): NÃO manda inlineData e instrui a não inventar paleta', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('microlink.io')) return { ok: true, json: async () => ({ status: 'fail' }) } as any;
      return { ok: true, text: async () => '<html><body>Site</body></html>' } as any;
    }));
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({ text: analiseFake() });

    await analyzeReferenceBackground('ref-1', 'marca-x', 'Concorrente', 'https://concorrente.com', 'WEBSITE');

    const call = (generateWithRetry as ReturnType<typeof vi.fn>).mock.calls[0];
    const parts = call[1].contents.parts as Array<{ text?: string; inlineData?: unknown }>;
    expect(parts.some((p) => p.inlineData)).toBe(false);
    expect(parts[0]!.text).toContain('array vazio em vez de inventar hex');
  });

  it('sucesso grava status ANALYZED com os campos extraídos', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ status: 'fail' }), text: async () => 'texto' } as any)));
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({ text: analiseFake({ archetype: 'O Sábio' }) });

    await analyzeReferenceBackground('ref-1', 'marca-x', 'Concorrente', 'https://concorrente.com', 'WEBSITE');

    expect(prismaMock.reference.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ref-1' },
      data: expect.objectContaining({ status: 'ANALYZED', archetype: 'O Sábio' }),
    }));
  });

  it('Instagram sem review da Apify usa Google Search grounding em vez de scraping (Instagram bloqueia scrape)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ status: 'fail' }) } as any)));
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({ text: analiseFake() });

    await analyzeReferenceBackground('ref-1', 'marca-x', 'Perfil IG', 'https://instagram.com/perfil', 'INSTAGRAM');

    const call = (generateWithRetry as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].config.tools).toEqual([{ googleSearch: {} }]);
  });

  it('REGRESSÃO: com tools (Google Search), NUNCA manda responseMimeType/responseSchema junto — a API do Gemini rejeita essa combinação com 400 "Tool use with a response mime type... is unsupported". Isto quebrava TODA análise de Instagram sem imagem (nunca detectado pelos mocks, só ao vivo)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ status: 'fail' }) } as any)));
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({ text: analiseFake() });

    await analyzeReferenceBackground('ref-1', 'marca-x', 'Perfil IG', 'https://instagram.com/perfil', 'INSTAGRAM');

    const call = (generateWithRetry as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].config.tools).toBeDefined();
    expect(call[1].config.responseMimeType).toBeUndefined();
    expect(call[1].config.responseSchema).toBeUndefined();
  });

  it('sem tools (screenshot real disponível), continua mandando responseMimeType/responseSchema normalmente', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('microlink.io')) {
        return { ok: true, json: async () => ({ status: 'success', data: { screenshot: { url: 'https://cdn.microlink.io/shot.png' } } }) } as any;
      }
      if (url.includes('cdn.microlink.io')) {
        return { ok: true, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => new TextEncoder().encode('fake-png').buffer } as any;
      }
      return { ok: true, text: async () => '<html></html>' } as any;
    }));
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({ text: analiseFake() });

    await analyzeReferenceBackground('ref-1', 'marca-x', 'Concorrente', 'https://concorrente.com', 'WEBSITE');

    const call = (generateWithRetry as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].config.tools).toBeUndefined();
    expect(call[1].config.responseMimeType).toBe('application/json');
    expect(call[1].config.responseSchema).toBeDefined();
  });

  it('Instagram com review real da Apify: manda o perfil (bio/seguidores) + várias imagens de posts de verdade (inlineData), sem Google Search', async () => {
    (fetchInstagramProfileReview as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      username: 'perfilconcorrente',
      fullName: 'Concorrente Oficial',
      biography: 'A melhor marca do nicho',
      followersCount: 12000,
      followsCount: 300,
      verified: true,
      posts: [
        { imageUrl: 'https://cdn.apify.example/foto-real-1.jpg', caption: 'Nosso lançamento de hoje!', likesCount: 500, commentsCount: 20, hashtags: ['lancamento'] },
        { imageUrl: 'https://cdn.apify.example/foto-real-2.jpg', caption: 'Bastidores', likesCount: 300, commentsCount: 10 },
      ],
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('cdn.apify.example')) {
        return { ok: true, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => new TextEncoder().encode('fake-jpeg').buffer } as any;
      }
      throw new Error(`URL inesperada: ${url}`);
    }));
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({ text: analiseFake() });

    await analyzeReferenceBackground('ref-1', 'marca-x', 'Perfil IG', 'https://instagram.com/perfilconcorrente', 'INSTAGRAM');

    const call = (generateWithRetry as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].config.tools).toBeUndefined(); // imagem real dispensa a busca
    const parts = call[1].contents.parts as Array<{ text?: string; inlineData?: { mimeType: string } }>;
    expect(parts.filter((p) => p.inlineData?.mimeType === 'image/jpeg')).toHaveLength(2);
    expect(parts[0]!.text).toContain('Concorrente Oficial');
    expect(parts[0]!.text).toContain('A melhor marca do nicho');
    expect(parts[0]!.text).toContain('12000');
    expect(parts[0]!.text).toContain('Nosso lançamento de hoje!');
  });

  it('falha na análise grava status FAILED, não deixa a referência presa em PENDING', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ status: 'fail' }) } as any)));
    (generateWithRetry as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Gemini indisponível'));

    await analyzeReferenceBackground('ref-1', 'marca-x', 'Concorrente', 'https://concorrente.com', 'WEBSITE');

    expect(prismaMock.reference.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ref-1' },
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
  });
});

describe('analyzeReferenceFromCollectedMaterial', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.brand.findUnique.mockResolvedValue(brandRecord as any);
    prismaMock.reference.update.mockResolvedValue({} as any);
  });

  it('usa o material JÁ coletado (etapa de confirmação do benchmark) sem chamar a Apify de novo', async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes('cdn.apify.example')) {
        return { ok: true, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => new TextEncoder().encode('fake-jpeg').buffer } as any;
      }
      throw new Error(`URL inesperada: ${url}`);
    });
    vi.stubGlobal('fetch', fetchSpy);
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({ text: analiseFake() });

    await analyzeReferenceFromCollectedMaterial(
      'ref-1', 'marca-x', 'Perfil IG', 'https://instagram.com/perfilconcorrente', 'INSTAGRAM',
      {
        instagram: {
          username: 'perfilconcorrente', fullName: 'Concorrente Oficial', biography: 'Bio real',
          followersCount: 9000, followsCount: 100, verified: false,
          posts: [{ imageUrl: 'https://cdn.apify.example/post1.jpg', caption: 'Post real', likesCount: 50, commentsCount: 2 }],
        },
      },
    );

    expect(fetchInstagramProfileReview).not.toHaveBeenCalled();
    expect(fetchWebsiteReview).not.toHaveBeenCalled();

    const call = (generateWithRetry as ReturnType<typeof vi.fn>).mock.calls[0];
    const parts = call[1].contents.parts as Array<{ text?: string; inlineData?: { mimeType: string } }>;
    expect(parts.some((p) => p.inlineData?.mimeType === 'image/jpeg')).toBe(true);
    expect(parts[0]!.text).toContain('Concorrente Oficial');

    expect(prismaMock.reference.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ref-1' },
      data: expect.objectContaining({ status: 'ANALYZED' }),
    }));
  });

  it('candidato com site E Instagram (fluxo de benchmark): site vira contexto extra no MESMO texto, sourceType continua INSTAGRAM (1 aba só)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('cdn.apify.example')) {
        return { ok: true, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => new TextEncoder().encode('fake-jpeg').buffer } as any;
      }
      throw new Error(`URL inesperada: ${url}`);
    }));
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({ text: analiseFake() });

    await analyzeReferenceFromCollectedMaterial(
      'ref-1', 'marca-x', 'Concorrente Completo', 'https://instagram.com/concorrente', 'INSTAGRAM',
      {
        instagram: {
          username: 'concorrente', fullName: 'Concorrente Completo',
          posts: [{ imageUrl: 'https://cdn.apify.example/post.jpg', caption: 'Post do IG' }],
        },
        website: [{ url: 'https://concorrente.com/sobre', title: 'Sobre', text: 'Texto institucional do site' }],
      },
    );

    const call = (generateWithRetry as ReturnType<typeof vi.fn>).mock.calls[0];
    const parts = call[1].contents.parts as Array<{ text?: string }>;
    expect(parts[0]!.text).toContain('Site oficial (contexto adicional)');
    expect(parts[0]!.text).toContain('Texto institucional do site');
  });

  it('material coletado vazio (nenhum post/página encontrado): ainda cai nos MESMOS fallbacks (Microlink/Google Search), sem re-chamar Apify', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('microlink.io')) return { ok: true, json: async () => ({ status: 'fail' }) } as any;
      return { ok: true, text: async () => '<html></html>' } as any;
    }));
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({ text: analiseFake() });

    await analyzeReferenceFromCollectedMaterial(
      'ref-1', 'marca-x', 'Concorrente', 'https://concorrente.com', 'WEBSITE', { website: [] },
    );

    expect(fetchWebsiteReview).not.toHaveBeenCalled();
    const call = (generateWithRetry as ReturnType<typeof vi.fn>).mock.calls[0];
    const parts = call[1].contents.parts as Array<{ text?: string; inlineData?: unknown }>;
    expect(parts.some((p) => p.inlineData)).toBe(false);
  });
});

describe('analyzeReferenceWithUploadedImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.brand.findUnique.mockResolvedValue(brandRecord as any);
    prismaMock.reference.update.mockResolvedValue({} as any);
  });

  it('usa a imagem enviada como inlineData de verdade, sem Google Search, sem chamar Microlink/Apify', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, text: async () => 'não deveria ser chamado' } as any));
    vi.stubGlobal('fetch', fetchSpy);
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({ text: analiseFake() });

    await analyzeReferenceWithUploadedImage(
      'ref-1', 'marca-x', 'Perfil IG', 'https://instagram.com/perfilconcorrente', 'INSTAGRAM',
      Buffer.from('imagem-fake').toString('base64'), 'image/png',
    );

    expect(fetchInstagramProfileReview).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled(); // nem Microlink, nem scrape de HTML

    const call = (generateWithRetry as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].config.tools).toBeUndefined();
    const parts = call[1].contents.parts as Array<{ inlineData?: { mimeType: string; data: string } }>;
    expect(parts.some((p) => p.inlineData?.mimeType === 'image/png')).toBe(true);

    expect(prismaMock.reference.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ref-1' },
      data: expect.objectContaining({ status: 'ANALYZED' }),
    }));
  });
});
