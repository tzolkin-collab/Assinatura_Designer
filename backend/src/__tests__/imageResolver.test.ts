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

import { resolveSlideImages } from '../lib/imageResolver';
import { generateWithRetry } from '../lib/geminiRetry';
import { uploadFileToR2 } from '../lib/r2';

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

describe('resolveSlideImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.asset.findMany.mockResolvedValue([]);
  });

  it('não chama nada quando nenhum slide tem imageHint', async () => {
    const result = await resolveSlideImages({ ...baseParams, skeleton: skeletonBase() });
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
    const result = await resolveSlideImages({ ...baseParams, skeleton });

    expect(result.get(1)).toEqual({ imageUrl: 'https://cdn.example.com/logo.png' });
    expect(mockGenerateContent).not.toHaveBeenCalled();
    expect(prismaMock.asset.create).not.toHaveBeenCalled();
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
    const result = await resolveSlideImages({ ...baseParams, skeleton });

    expect(result.has(1)).toBe(false);
  });

  it('gera uma foto, sobe pro R2 e salva na biblioteca como ai-generated', async () => {
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify([
        { slideIndex: 1, action: 'generate-photo', generatePrompt: 'produto em uso, luz natural' },
      ]),
    });
    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }] } }],
    });
    prismaMock.asset.create.mockResolvedValue({ id: 'a1' });

    const skeleton = skeletonBase([{}, { imageHint: 'foto do produto' }]);
    const result = await resolveSlideImages({ ...baseParams, skeleton });

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
    const result = await resolveSlideImages({ ...baseParams, skeleton });

    expect(result.get(1)?.svgMarkup).toContain('<svg');
    expect(uploadFileToR2).not.toHaveBeenCalled();
    expect(prismaMock.asset.create).not.toHaveBeenCalled();
  });

  it('respeita o teto de gerações por deck — além do teto, o slide fica sem imagem', async () => {
    const { config } = await import('../config.js');
    const original = config.maxGeneratedImagesPerDeck;
    (config as any).maxGeneratedImagesPerDeck = 1;

    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify([
        { slideIndex: 0, action: 'generate-photo', generatePrompt: 'cena 1' },
        { slideIndex: 1, action: 'generate-photo', generatePrompt: 'cena 2' },
      ]),
    });
    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }] } }],
    });
    prismaMock.asset.create.mockResolvedValue({ id: 'a1' });

    const skeleton = skeletonBase([{ imageHint: 'cena 1' }, { imageHint: 'cena 2' }]);
    const result = await resolveSlideImages({ ...baseParams, skeleton });

    expect(result.size).toBe(1);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);

    (config as any).maxGeneratedImagesPerDeck = original;
  });

  it('nunca lança — plano de imagens falhando não derruba a geração do deck', async () => {
    (generateWithRetry as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Gemini fora do ar'));
    const skeleton = skeletonBase([{}, { imageHint: 'algo' }]);

    await expect(resolveSlideImages({ ...baseParams, skeleton })).resolves.toEqual(new Map());
  });
});
