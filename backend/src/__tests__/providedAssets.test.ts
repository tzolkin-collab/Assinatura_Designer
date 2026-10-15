import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from './client';

vi.mock('../lib/r2', () => ({ uploadFileToR2: vi.fn() }));
vi.mock('../lib/geminiRetry', () => ({ generateWithRetry: vi.fn(), humanizeGeminiError: vi.fn((e) => e) }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: vi.fn() }; } }));
vi.mock('../lib/unsplash', () => ({ searchUnsplashPhoto: vi.fn(async () => null) }));

import { onlyProvidedAssets } from '../lib/designerBrain/providedAssets';
import { resolveSlideImages } from '../lib/imageResolver';

describe('onlyProvidedAssets', () => {
  it('tira o que o sistema gerou e mantém o que alguém forneceu', () => {
    const lista = [
      { url: 'a', source: 'upload' },
      { url: 'b', source: 'ai-generated' },
      { url: 'c', source: 'drive' },
      { url: 'd' },
      { url: 'e', source: null },
    ];
    expect(onlyProvidedAssets(lista).map((a) => a.url)).toEqual(['a', 'c', 'd', 'e']);
  });

  it('lista vazia continua vazia', () => {
    expect(onlyProvidedAssets([])).toEqual([]);
  });
});

describe('resolveSlideImages com o cérebro ligado', () => {
  const params = {
    brandId: 'brand-1',
    brandName: 'Amanda Coelho',
    brandColors: ['#410C1C'],
    width: 1920,
    height: 1080,
    postId: 'post-1',
    skeleton: [{ title: 'Capa', goal: 'Abrir', layout_type: 'title-hero', order: 1, imageHint: 'retrato da Amanda' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.asset.findMany.mockResolvedValue([]);
  });

  it('não oferece para reuso o que foi gerado por IA', async () => {
    await resolveSlideImages({ ...params, allowGeneratedGraphics: false, onlyProvidedAssets: true });

    const where = (prismaMock.asset.findMany.mock.calls[0]![0] as any).where;
    expect(where.source).toEqual({ not: 'ai-generated' });
    expect(where.brandId).toEqual({ in: ['brand-1'] });
  });

  it('sem o cérebro, a biblioteca continua inteira (comportamento antigo)', async () => {
    await resolveSlideImages({ ...params });

    const where = (prismaMock.asset.findMany.mock.calls[0]![0] as any).where;
    expect(where.source).toBeUndefined();
  });
});
