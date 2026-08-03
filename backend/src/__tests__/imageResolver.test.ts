import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from './client';

vi.mock('../lib/r2', () => ({
  uploadFileToR2: vi.fn(async () => 'https://r2.example.com/brands/brand-1/generated/gerado.png'),
}));

vi.mock('../lib/geminiRetry', () => ({
  generateWithRetry: vi.fn(),
  humanizeGeminiError: vi.fn((err) => err),
}));

const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

vi.mock('../lib/unsplash', () => ({
  searchUnsplashPhoto: vi.fn(async () => null),
}));

import { resolveSlideImages, resolveImageCandidateDecisions } from '../lib/imageResolver';
import { generateWithRetry } from '../lib/geminiRetry';
import { uploadFileToR2 } from '../lib/r2';
import { searchUnsplashPhoto } from '../lib/unsplash';

const skeletonBase = (overrides: Partial<{ imageHint: string }>[] = []) => [
  { title: 'Capa', goal: 'Abrir', layout_type: 'title-hero', order: 1, ...overrides[0] },
  { title: 'Produto', goal: 'Mostrar', layout_type: 'content-split', order: 2, ...overrides[1] },
  { title: 'Encerramento', goal: 'CTA', layout_type: 'closing', order: 3, ...overrides[2] },
];

const baseParams = {
  brandId: 'brand-1',
  brandName: 'Marca X',
  brandColors: ['#111111', '#ffffff'],
  width: 1080,
  height: 1080,
  postId: 'post-1',
};

const fakeImageResponse = () => ({
  ok: true,
  headers: { get: (h: string) => (h === 'content-type' ? 'image/png' : null) },
  arrayBuffer: async () => new TextEncoder().encode('fake-png-bytes').buffer,
});

describe('resolveSlideImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.asset.findMany.mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn(async () => fakeImageResponse()));
  });

  it('não chama nada quando nenhum slide tem imageHint', async () => {
    const { resolved: result } = await resolveSlideImages({ ...baseParams, skeleton: skeletonBase() });
    expect(result.size).toBe(0);
    expect(generateWithRetry).not.toHaveBeenCalled();
    expect(prismaMock.asset.findMany).not.toHaveBeenCalled();
  });

  it('reaproveita um asset existente quando o modelo decide "reuse" com URL válida', async () => {
    prismaMock.asset.findMany.mockResolvedValue([
      { url: 'https://cdn.example.com/logo.png', name: 'Logo oficial', tags: ['logo'] },
    ]);
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify([
        { slideIndex: 1, action: 'reuse', assetUrl: 'https://cdn.example.com/logo.png' },
      ]),
    });

    const skeleton = skeletonBase([{}, { imageHint: 'logo da marca em destaque' }]);
    const { resolved: result } = await resolveSlideImages({ ...baseParams, skeleton });

    expect(result.get(1)).toEqual({ imageUrl: 'https://cdn.example.com/logo.png' });
    expect(mockGenerateContent).not.toHaveBeenCalled();
    expect(prismaMock.asset.create).not.toHaveBeenCalled();
  });

  it('reuse com confidence "medium" NÃO decide sozinho — vira candidato pendente pro usuário aprovar', async () => {
    prismaMock.asset.findMany.mockResolvedValue([
      { url: 'https://cdn.example.com/talvez.png', name: 'foto-generica-escritorio.jpg', tags: [] },
    ]);
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify([
        { slideIndex: 1, action: 'reuse', assetUrl: 'https://cdn.example.com/talvez.png', confidence: 'medium' },
      ]),
    });

    const skeleton = skeletonBase([{}, { imageHint: 'pessoa sorrindo no escritório' }]);
    const { resolved, pendingCandidates } = await resolveSlideImages({ ...baseParams, skeleton });

    expect(resolved.has(1)).toBe(false);
    expect(pendingCandidates).toEqual([{
      slideIndex: 1,
      hint: 'pessoa sorrindo no escritório',
      assetUrl: 'https://cdn.example.com/talvez.png',
      assetName: 'foto-generica-escritorio.jpg',
    }]);
  });

  it('reuse com confidence "high" (ou sem confidence, default) aplica direto — sem pausar', async () => {
    prismaMock.asset.findMany.mockResolvedValue([
      { url: 'https://cdn.example.com/exato.png', name: 'logo-oficial.png', tags: [] },
    ]);
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify([
        { slideIndex: 1, action: 'reuse', assetUrl: 'https://cdn.example.com/exato.png', confidence: 'high' },
      ]),
    });

    const skeleton = skeletonBase([{}, { imageHint: 'logo da marca' }]);
    const { resolved, pendingCandidates } = await resolveSlideImages({ ...baseParams, skeleton });

    expect(resolved.get(1)).toEqual({ imageUrl: 'https://cdn.example.com/exato.png' });
    expect(pendingCandidates).toEqual([]);
  });

  it('baixa os assets existentes e manda como imagem (inlineData) na decisão de reuso, não só nome/tags', async () => {
    prismaMock.asset.findMany.mockResolvedValue([
      { url: 'https://cdn.example.com/produto.jpg', name: 'produto-final-v2.jpg', tags: [] },
    ]);
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify([{ slideIndex: 1, action: 'skip' }]),
    });

    const skeleton = skeletonBase([{}, { imageHint: 'foto do produto em uso' }]);
    await resolveSlideImages({ ...baseParams, skeleton });

    expect(fetch).toHaveBeenCalledWith('https://cdn.example.com/produto.jpg', expect.anything());
    const call = (generateWithRetry as ReturnType<typeof vi.fn>).mock.calls[0];
    const parts = call[1].contents[0].parts as Array<{ inlineData?: { mimeType: string; data: string } }>;
    expect(parts.some((p) => p.inlineData?.mimeType === 'image/png')).toBe(true);
  });

  it('ignora "reuse" quando a URL não está na lista oferecida (modelo alucinou)', async () => {
    prismaMock.asset.findMany.mockResolvedValue([
      { url: 'https://cdn.example.com/real.png', name: 'Real', tags: [] },
    ]);
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify([
        { slideIndex: 1, action: 'reuse', assetUrl: 'https://cdn.example.com/inventada.png' },
      ]),
    });

    const skeleton = skeletonBase([{}, { imageHint: 'algo' }]);
    const { resolved: result } = await resolveSlideImages({ ...baseParams, skeleton });

    expect(result.has(1)).toBe(false);
  });

  it('gera uma foto, sobe pro R2 e salva na biblioteca como ai-generated', async () => {
    // 1ª chamada: decisão do plano de imagens. 2ª+ (default): autoverificação de
    // coerência da foto gerada — "aprovado" pra não cair no fallback do Unsplash.
    (generateWithRetry as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        text: JSON.stringify([
          { slideIndex: 1, action: 'generate-photo', generatePrompt: 'produto em uso, luz natural' },
        ]),
      })
      .mockResolvedValue({ text: 'aprovado' });
    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }] } }],
    });
    prismaMock.asset.create.mockResolvedValue({ id: 'a1' });

    const skeleton = skeletonBase([{}, { imageHint: 'foto do produto' }]);
    const { resolved: result } = await resolveSlideImages({ ...baseParams, skeleton });

    expect(result.get(1)?.imageUrl).toBe('https://r2.example.com/brands/brand-1/generated/gerado.png');
    expect(uploadFileToR2).toHaveBeenCalledTimes(1);
    expect(prismaMock.asset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ brandId: 'brand-1', source: 'ai-generated', postId: 'post-1' }),
      }),
    );
  });

  it('gera um SVG inline e NÃO cria Asset (reaproveitamento de SVG é por prompt, não por URL)', async () => {
    (generateWithRetry as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        text: JSON.stringify([
          { slideIndex: 1, action: 'generate-svg', generatePrompt: 'ícone de gráfico crescente' },
        ]),
      })
      .mockResolvedValueOnce({ text: '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>' });

    const skeleton = skeletonBase([{}, { imageHint: 'ícone de crescimento' }]);
    const { resolved: result } = await resolveSlideImages({ ...baseParams, skeleton });

    expect(result.get(1)?.svgMarkup).toContain('<svg');
    expect(uploadFileToR2).not.toHaveBeenCalled();
    expect(prismaMock.asset.create).not.toHaveBeenCalled();
  });

  it('respeita o teto de gerações por deck — além do teto, o slide fica sem imagem', async () => {
    const { config } = await import('../config.js');
    const original = config.maxGeneratedImagesPerDeck;
    (config as any).maxGeneratedImagesPerDeck = 1;

    (generateWithRetry as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        text: JSON.stringify([
          { slideIndex: 0, action: 'generate-photo', generatePrompt: 'cena 1' },
          { slideIndex: 1, action: 'generate-photo', generatePrompt: 'cena 2' },
        ]),
      })
      .mockResolvedValue({ text: 'aprovado' });
    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }] } }],
    });
    prismaMock.asset.create.mockResolvedValue({ id: 'a1' });

    const skeleton = skeletonBase([{ imageHint: 'cena 1' }, { imageHint: 'cena 2' }]);
    const { resolved: result } = await resolveSlideImages({ ...baseParams, skeleton });

    expect(result.size).toBe(1);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);

    (config as any).maxGeneratedImagesPerDeck = original;
  });

  it('nunca lança — plano de imagens falhando não derruba a geração do deck', async () => {
    (generateWithRetry as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Gemini fora do ar'));
    const skeleton = skeletonBase([{}, { imageHint: 'algo' }]);

    await expect(resolveSlideImages({ ...baseParams, skeleton })).resolves.toEqual({ resolved: new Map(), pendingCandidates: [] });
  });

  it('backstop: ignora "generate-photo" se allowGeneratedGraphics=false mesmo se o modelo escolher essa ação', async () => {
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify([
        { slideIndex: 1, action: 'generate-photo', generatePrompt: 'cena qualquer' },
      ]),
    });

    const skeleton = skeletonBase([{}, { imageHint: 'foto do produto' }]);
    const { resolved: result } = await resolveSlideImages({ ...baseParams, skeleton, allowGeneratedGraphics: false });

    expect(result.size).toBe(0);
    expect(mockGenerateContent).not.toHaveBeenCalled();
    expect(uploadFileToR2).not.toHaveBeenCalled();
  });

  it('foto reprovada na autoverificação de coerência cai pro Unsplash em vez de usar a foto ruim', async () => {
    (generateWithRetry as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        text: JSON.stringify([
          { slideIndex: 1, action: 'generate-photo', generatePrompt: 'pessoa sorrindo no escritório' },
        ]),
      })
      .mockResolvedValueOnce({ text: 'reprovado' }); // autoverificação reprova a foto gerada
    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }] } }],
    });
    (searchUnsplashPhoto as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      url: 'https://r2.example.com/brands/brand-1/generated/unsplash-x.jpg',
      photographerName: 'Fotógrafo Y',
      photographerProfileUrl: 'https://unsplash.com/@y',
      photoPageUrl: 'https://unsplash.com/photos/x',
    });
    prismaMock.asset.create.mockResolvedValue({ id: 'a1' });

    const skeleton = skeletonBase([{}, { imageHint: 'foto de pessoa' }]);
    const { resolved: result } = await resolveSlideImages({ ...baseParams, skeleton });

    expect(result.get(1)?.imageUrl).toBe('https://r2.example.com/brands/brand-1/generated/unsplash-x.jpg');
    // A foto gerada (reprovada) NUNCA é enviada pro R2 — só a do Unsplash.
    expect(uploadFileToR2).not.toHaveBeenCalled();
    expect(prismaMock.asset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'unsplash', name: expect.stringContaining('Fotógrafo Y') }),
      }),
    );
  });

  it('gasto de IA da marca acima do teto: prefere Unsplash a gerar mais uma foto', async () => {
    const aiBudget = await import('../lib/aiBudget.js');
    const usageSpy = vi.spyOn(aiBudget, 'getUsage').mockResolvedValue({
      globalTokens: 0, globalBudget: 0, brandSlug: 'marca-x', brandTokens: 900_000, brandBudget: 1_000_000,
      models: [], cost: { usd: 0, brl: 0 }, currency: 'USD', taxRate: 0,
    } as any);
    const aiContext = await import('../lib/aiContext.js');
    const contextSpy = vi.spyOn(aiContext, 'getAiContext').mockReturnValue({ brandSlug: 'marca-x' });

    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      text: JSON.stringify([
        { slideIndex: 1, action: 'generate-photo', generatePrompt: 'produto em uso' },
      ]),
    });
    (searchUnsplashPhoto as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      url: 'https://r2.example.com/brands/brand-1/generated/unsplash-z.jpg',
      photographerName: 'Fotógrafo Z',
      photographerProfileUrl: 'https://unsplash.com/@z',
      photoPageUrl: 'https://unsplash.com/photos/z',
    });

    const skeleton = skeletonBase([{}, { imageHint: 'foto do produto' }]);
    const { resolved: result } = await resolveSlideImages({ ...baseParams, skeleton });

    expect(result.get(1)?.imageUrl).toBe('https://r2.example.com/brands/brand-1/generated/unsplash-z.jpg');
    // Nem chegou a tentar gerar — o gatilho de custo age ANTES da geração.
    expect(mockGenerateContent).not.toHaveBeenCalled();

    usageSpy.mockRestore();
    contextSpy.mockRestore();
  });

  it('gerar foto registra o gasto no billing (recordUsage) — antes esse gasto era invisível', async () => {
    const aiBudget = await import('../lib/aiBudget.js');
    const spy = vi.spyOn(aiBudget, 'recordUsage').mockResolvedValue(undefined);

    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify([
        { slideIndex: 1, action: 'generate-photo', generatePrompt: 'produto em uso' },
      ]),
    });
    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }] } }],
      usageMetadata: { totalTokenCount: 500 },
    });
    prismaMock.asset.create.mockResolvedValue({ id: 'a1' });

    const skeleton = skeletonBase([{}, { imageHint: 'foto do produto' }]);
    await resolveSlideImages({ ...baseParams, skeleton });

    expect(spy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ totalTokenCount: 500 }));
    spy.mockRestore();
  });

  it('teto de IA estourado: pula a geração de foto (não tenta nenhum modelo) em vez de gastar mesmo assim', async () => {
    const aiBudget = await import('../lib/aiBudget.js');
    const spy = vi.spyOn(aiBudget, 'assertWithinBudget').mockRejectedValue(new Error('teto estourado'));

    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify([
        { slideIndex: 1, action: 'generate-photo', generatePrompt: 'produto em uso' },
      ]),
    });

    const skeleton = skeletonBase([{}, { imageHint: 'foto do produto' }]);
    const { resolved: result } = await resolveSlideImages({ ...baseParams, skeleton });

    expect(result.size).toBe(0);
    expect(mockGenerateContent).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('backstop: ignora "generate-svg" se allowSvgLayouts=false mesmo se o modelo escolher essa ação', async () => {
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify([
        { slideIndex: 1, action: 'generate-svg', generatePrompt: 'ícone qualquer' },
      ]),
    });

    const skeleton = skeletonBase([{}, { imageHint: 'ícone' }]);
    const { resolved: result } = await resolveSlideImages({ ...baseParams, skeleton, allowSvgLayouts: false });

    expect(result.size).toBe(0);
    // só a chamada de decisão deve ter ocorrido, nenhuma segunda chamada pra gerar SVG
    expect(generateWithRetry).toHaveBeenCalledTimes(1);
  });

  it('não usa o mesmo asset duas vezes no deck — o segundo slide gera em vez de repetir', async () => {
    // Regressão medida em produção: uma peça de 4 slides saiu com 10 <img> e só 5
    // imagens distintas, o mesmo ícone de brandbook três vezes. O modelo julga
    // cada slide isolado e nunca enxerga que já usou aquele arquivo.
    prismaMock.asset.findMany.mockResolvedValue([
      { url: 'https://cdn.example.com/icon-grafico.svg', name: 'icon-bar-graph-arrow.svg', tags: ['brandbook'] },
    ]);
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify([
        { slideIndex: 0, action: 'reuse', assetUrl: 'https://cdn.example.com/icon-grafico.svg' },
        { slideIndex: 1, action: 'reuse', assetUrl: 'https://cdn.example.com/icon-grafico.svg' },
      ]),
    });

    const skeleton = skeletonBase([
      { imageHint: 'gráfico de crescimento' },
      { imageHint: 'equipe comemorando resultado' },
    ]);
    const { resolved: result } = await resolveSlideImages({ ...baseParams, skeleton });

    // O primeiro fica com o asset; o segundo NÃO recebe a mesma URL.
    expect(result.get(0)).toEqual({ imageUrl: 'https://cdn.example.com/icon-grafico.svg' });
    expect(result.get(1)?.imageUrl).not.toBe('https://cdn.example.com/icon-grafico.svg');
    // E a duplicata vira geração a partir do hint, em vez de virar slide vazio.
    expect(mockGenerateContent).toHaveBeenCalled();
  });
});

describe('resolveImageCandidateDecisions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const candidates = [
    { slideIndex: 1, hint: 'foto de pessoa no escritório', assetUrl: 'https://cdn.example.com/talvez.png', assetName: 'foto-generica.jpg' },
  ];

  it('"accept": usa o asset da biblioteca já sugerido, sem chamar IA nenhuma', async () => {
    const result = await resolveImageCandidateDecisions(candidates, 'accept', {
      brandName: 'Marca X', width: 1080, height: 1080, brandId: 'brand-1',
    });

    expect(result.get(1)).toEqual({ imageUrl: 'https://cdn.example.com/talvez.png' });
    expect(mockGenerateContent).not.toHaveBeenCalled();
    expect(prismaMock.asset.create).not.toHaveBeenCalled();
  });

  it('"regenerate": ignora o candidato da biblioteca e gera uma foto nova pro slide', async () => {
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({ text: 'aprovado' }); // autoverificação
    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }] } }],
    });
    prismaMock.asset.create.mockResolvedValue({ id: 'a1' });

    const result = await resolveImageCandidateDecisions(candidates, 'regenerate', {
      brandName: 'Marca X', width: 1080, height: 1080, brandId: 'brand-1',
    });

    expect(result.get(1)?.imageUrl).toBe('https://r2.example.com/brands/brand-1/generated/gerado.png');
    expect(uploadFileToR2).toHaveBeenCalledTimes(1);
    expect(prismaMock.asset.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: 'ai-generated' }) }),
    );
  });
});
