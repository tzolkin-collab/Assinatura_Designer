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

import { analyzeReferenceBackground } from '../lib/referenceSync';
import { generateWithRetry } from '../lib/geminiRetry';

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

  it('manda a screenshot capturada como inlineData (visão de verdade) quando o Microlink funciona', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('api.microlink.io')) {
        return { ok: true, json: async () => ({ status: 'success', data: { screenshot: { url: 'https://cdn.microlink.io/shot.png' } } }) } as any;
      }
      if (url.includes('cdn.microlink.io')) {
        return { ok: true, arrayBuffer: async () => new TextEncoder().encode('fake-png').buffer } as any;
      }
      // scrape do site
      return { ok: true, text: async () => '<html><body>Site de verdade</body></html>' } as any;
    }));
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({ text: analiseFake() });

    await analyzeReferenceBackground('ref-1', 'marca-x', 'Concorrente', 'https://concorrente.com', 'WEBSITE');

    const call = (generateWithRetry as ReturnType<typeof vi.fn>).mock.calls[0];
    const parts = call[1].contents.parts as Array<{ text?: string; inlineData?: { mimeType: string } }>;
    expect(parts.some((p) => p.inlineData?.mimeType === 'image/png')).toBe(true);
    // O prompt precisa instruir a IA a confiar na imagem, não inventar hex
    expect(parts[0]!.text).toContain('screenshot REAL');
    expect(parts[0]!.text).not.toContain('array vazio em vez de inventar hex');
  });

  it('sem screenshot (Microlink falha): NÃO manda inlineData e instrui a não inventar paleta', async () => {
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

  it('Instagram usa Google Search grounding em vez de scraping (Instagram bloqueia scrape)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ status: 'fail' }) } as any)));
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({ text: analiseFake() });

    await analyzeReferenceBackground('ref-1', 'marca-x', 'Perfil IG', 'https://instagram.com/perfil', 'INSTAGRAM');

    const call = (generateWithRetry as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].config.tools).toEqual([{ googleSearch: {} }]);
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
