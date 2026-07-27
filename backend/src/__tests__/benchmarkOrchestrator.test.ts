import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from './client';

vi.mock('../lib/competitorDiscovery', () => ({
  discoverCompetitors: vi.fn(),
}));

vi.mock('../lib/referenceSync', () => ({
  analyzeReferenceFromCollectedMaterial: vi.fn(async () => {}),
}));

// Instagram sai em LOTE (1 chamada com todas as URLs, devolve um Map) — não
// mais 1 chamada por candidato. Ver apifyInstagram.ts.
vi.mock('../lib/apifyInstagram', () => ({
  fetchInstagramProfileReviews: vi.fn(async (urls: string[]) => {
    const map = new Map();
    for (const url of urls) map.set(url, { posts: [{ imageUrl: `${url}/post.jpg` }] });
    return map;
  }),
}));

vi.mock('../lib/apifyWebsiteCrawler', () => ({
  fetchWebsiteReview: vi.fn(async (url: string) => [{ url, text: 'texto' }]),
}));

vi.mock('../lib/geminiRetry', () => ({
  generateWithRetry: vi.fn(async () => ({ text: 'Resumo consolidado de teste.' })),
  humanizeGeminiError: vi.fn((err) => err),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {},
}));

import {
  startBenchmarkDiscovery,
  answerBenchmarkQuestion,
  confirmBenchmarkCandidates,
  getBenchmarkSession,
  runAutoResearchCycle,
  synthesizeBenchmarkSummary,
  type BenchmarkSession,
} from '../lib/benchmarkOrchestrator';
import { discoverCompetitors } from '../lib/competitorDiscovery';
import { analyzeReferenceFromCollectedMaterial } from '../lib/referenceSync';
import { fetchInstagramProfileReviews } from '../lib/apifyInstagram';
import { fetchWebsiteReview } from '../lib/apifyWebsiteCrawler';
import { generateWithRetry } from '../lib/geminiRetry';

const brandRecord = { id: 'brand-1', name: 'Marca X', config: { guidelines: 'Tom direto' } };

// Simula o BrandConfig inteiro como um "banco" em memória (não só
// benchmarkSession — upsert/update também gravam benchmarkSummary a partir de
// synthesizeBenchmarkSummary, então precisa mesclar campos, não sobrescrever).
function stubBrandConfigStorage() {
  let stored: Record<string, unknown> = {};
  (prismaMock.brandConfig.upsert as ReturnType<typeof vi.fn>).mockImplementation(async ({ update }: any) => {
    stored = { ...stored, ...update };
    return stored;
  });
  (prismaMock.brandConfig.update as ReturnType<typeof vi.fn>).mockImplementation(async ({ data }: any) => {
    stored = { ...stored, ...data };
    return stored;
  });
  (prismaMock.brandConfig.findUnique as ReturnType<typeof vi.fn>).mockImplementation(async () => stored);
  return {
    getSession: () => stored.benchmarkSession as BenchmarkSession | undefined,
    getConfig: () => stored,
  };
}

describe('benchmarkOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.brand.findUnique.mockResolvedValue(brandRecord as any);
    prismaMock.reference.findMany.mockResolvedValue([]);
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({ text: 'Resumo consolidado de teste.' });
  });

  it('startBenchmarkDiscovery: sem ambiguidade, coleta e vai direto pra AWAITING_CONFIRMATION', async () => {
    const { getSession: getStored } = stubBrandConfigStorage();
    (discoverCompetitors as ReturnType<typeof vi.fn>).mockResolvedValue({
      competitors: [{ name: 'Rival A', instagramUrl: 'https://instagram.com/rivala' }],
    });

    await startBenchmarkDiscovery('brand-1', 'marca-x', []);

    const session = getStored();
    expect(session?.status).toBe('AWAITING_CONFIRMATION');
    expect(session?.candidates).toHaveLength(1);
    expect(session?.candidates[0]?.collected?.instagram?.posts).toHaveLength(1);
  });

  it('pergunta de ambiguidade: pausa em AWAITING_QUESTION, resposta segue com extraContext e round+1', async () => {
    const { getSession: getStored } = stubBrandConfigStorage();
    (discoverCompetitors as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        competitors: [],
        question: { text: 'Existem duas marcas "Nike", qual delas?', options: ['Moda esportiva', 'Boutique'] },
      })
      .mockResolvedValueOnce({ competitors: [{ name: 'Nike (moda esportiva)', instagramUrl: 'https://instagram.com/nike' }] });

    await startBenchmarkDiscovery('brand-1', 'marca-x', ['Nike']);
    expect(getStored()?.status).toBe('AWAITING_QUESTION');
    expect(getStored()?.round).toBe(0);

    await answerBenchmarkQuestion('brand-1', 'marca-x', 'Moda esportiva');

    const secondCall = (discoverCompetitors as ReturnType<typeof vi.fn>).mock.calls[1]!;
    expect(secondCall[2].extraContext).toContain('Moda esportiva');
    expect(secondCall[2].allowQuestion).toBe(true);
    expect(getStored()?.status).toBe('AWAITING_CONFIRMATION');
  });

  it('teto de rodadas: na 2ª pergunta ainda dentro do round, na 3ª (round>=MAX) segue com o melhor resultado mesmo com question pendente', async () => {
    const { getSession: getStored } = stubBrandConfigStorage();
    (discoverCompetitors as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ competitors: [], question: { text: 'Pergunta 1' } }) // round 0 -> pausa
      .mockResolvedValueOnce({ competitors: [], question: { text: 'Pergunta 2' } }) // round 1 -> pausa (ainda < MAX_ROUNDS=2)
      .mockResolvedValueOnce({ competitors: [{ name: 'Rival A', websiteUrl: 'https://rivala.com' }], question: { text: 'Pergunta 3' } }); // round 2 -> teto batido, segue mesmo com question

    await startBenchmarkDiscovery('brand-1', 'marca-x', ['Ambíguo']);
    expect(getStored()?.status).toBe('AWAITING_QUESTION');
    expect(getStored()?.round).toBe(0);

    await answerBenchmarkQuestion('brand-1', 'marca-x', 'resposta 1');
    expect(getStored()?.status).toBe('AWAITING_QUESTION');
    expect(getStored()?.round).toBe(1);

    await answerBenchmarkQuestion('brand-1', 'marca-x', 'resposta 2');
    expect(getStored()?.status).toBe('AWAITING_CONFIRMATION'); // não fica preso esperando pergunta pra sempre
  });

  it('REGRESSÃO: coleta de N candidatos chama fetchInstagramProfileReviews UMA VEZ SÓ (lote), não uma vez por candidato', async () => {
    stubBrandConfigStorage();
    (discoverCompetitors as ReturnType<typeof vi.fn>).mockResolvedValue({
      competitors: [
        { name: 'Rival A', instagramUrl: 'https://instagram.com/rivala' },
        { name: 'Rival B', instagramUrl: 'https://instagram.com/rivalb' },
        { name: 'Rival C', instagramUrl: 'https://instagram.com/rivalc' },
      ],
    });

    await startBenchmarkDiscovery('brand-1', 'marca-x', []);

    expect(fetchInstagramProfileReviews).toHaveBeenCalledTimes(1);
    expect(fetchInstagramProfileReviews).toHaveBeenCalledWith(
      ['https://instagram.com/rivala', 'https://instagram.com/rivalb', 'https://instagram.com/rivalc'], 12,
    );
  });

  it('confirmBenchmarkCandidates: cria 1 Reference por candidato confirmado, ignora os desmarcados, nunca re-chama Apify', async () => {
    stubBrandConfigStorage();
    (discoverCompetitors as ReturnType<typeof vi.fn>).mockResolvedValue({
      competitors: [
        { name: 'Rival A', instagramUrl: 'https://instagram.com/rivala' },
        { name: 'Rival B', websiteUrl: 'https://rivalb.com' },
      ],
    });
    await startBenchmarkDiscovery('brand-1', 'marca-x', []);

    const session = await getBenchmarkSession('brand-1');
    const [candA, candB] = session!.candidates;
    prismaMock.reference.create.mockResolvedValueOnce({ id: 'ref-a' } as any);

    await confirmBenchmarkCandidates('brand-1', 'marca-x', [
      { id: candA!.id, confirmed: true },
      { id: candB!.id, confirmed: false },
    ]);

    expect(prismaMock.reference.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.reference.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: 'Rival A', sourceType: 'INSTAGRAM', brandId: 'brand-1' }),
    }));
    expect(analyzeReferenceFromCollectedMaterial).toHaveBeenCalledTimes(1);
    expect(analyzeReferenceFromCollectedMaterial).toHaveBeenCalledWith(
      'ref-a', 'marca-x', 'Rival A', 'https://instagram.com/rivala', 'INSTAGRAM', candA!.collected,
    );

    const finalSession = await getBenchmarkSession('brand-1');
    expect(finalSession?.status).toBe('DONE');
  });

  it('confirmBenchmarkCandidates: espera as análises terminarem e sintetiza o resumo consolidado antes de marcar DONE', async () => {
    const { getSession, getConfig } = stubBrandConfigStorage();
    (discoverCompetitors as ReturnType<typeof vi.fn>).mockResolvedValue({
      competitors: [{ name: 'Rival A', instagramUrl: 'https://instagram.com/rivala' }],
    });
    await startBenchmarkDiscovery('brand-1', 'marca-x', []);
    const session = await getBenchmarkSession('brand-1');
    prismaMock.reference.create.mockResolvedValueOnce({ id: 'ref-a' } as any);
    prismaMock.reference.findMany.mockResolvedValueOnce([
      { name: 'Rival A', archetype: 'O Criador', toneOfVoice: 'Direto', density: 'Alta', palette: ['#112233'], insightsText: 'Insight de teste' },
    ] as any);

    await confirmBenchmarkCandidates('brand-1', 'marca-x', [{ id: session!.candidates[0]!.id, confirmed: true }]);

    expect(generateWithRetry).toHaveBeenCalledTimes(1);
    const promptText = (generateWithRetry as ReturnType<typeof vi.fn>).mock.calls[0]![1].contents.parts[0].text;
    expect(promptText).toContain('Rival A');
    expect(promptText).toContain('O Criador');
    expect(getSession()?.status).toBe('DONE'); // sessão de benchmark continua íntegra
    expect((getConfig() as any).benchmarkSummary).toBe('Resumo consolidado de teste.');
  });

  it('synthesizeBenchmarkSummary: sem NENHUMA referência ANALYZED, não chama o Gemini (nada pra sintetizar)', async () => {
    stubBrandConfigStorage();
    prismaMock.reference.findMany.mockResolvedValueOnce([]);

    await synthesizeBenchmarkSummary('brand-1');

    expect(generateWithRetry).not.toHaveBeenCalled();
  });

  it('REGRESSÃO: handle de Instagram inventado (coleta não trouxe posts nem bio) — usa o SITE como fonte principal em vez de criar uma Reference de Instagram vazia', async () => {
    stubBrandConfigStorage();
    (discoverCompetitors as ReturnType<typeof vi.fn>).mockResolvedValue({
      competitors: [
        { name: 'Rival Fantasma', instagramUrl: 'https://instagram.com/handle-inventado', websiteUrl: 'https://rivalfantasma.com' },
      ],
    });
    (fetchInstagramProfileReviews as ReturnType<typeof vi.fn>).mockImplementationOnce(async (urls: string[]) => {
      const map = new Map();
      for (const url of urls) map.set(url, null); // handle inventado: nada real coletado
      return map;
    });
    (fetchWebsiteReview as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ url: 'https://rivalfantasma.com', text: 'site de verdade' }]);

    await startBenchmarkDiscovery('brand-1', 'marca-x', []);

    const session = await getBenchmarkSession('brand-1');
    const [candidate] = session!.candidates;
    prismaMock.reference.create.mockResolvedValueOnce({ id: 'ref-fantasma' } as any);

    await confirmBenchmarkCandidates('brand-1', 'marca-x', [{ id: candidate!.id, confirmed: true }]);

    expect(prismaMock.reference.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sourceType: 'WEBSITE', analysisUrl: 'https://rivalfantasma.com' }),
    }));
    expect(analyzeReferenceFromCollectedMaterial).toHaveBeenCalledWith(
      'ref-fantasma', 'marca-x', 'Rival Fantasma', 'https://rivalfantasma.com', 'WEBSITE', candidate!.collected,
    );
  });

  it('runAutoResearchCycle: sempre chama discoverCompetitors com allowQuestion:false', async () => {
    stubBrandConfigStorage();
    (discoverCompetitors as ReturnType<typeof vi.fn>).mockResolvedValue({
      competitors: [{ name: 'Rival A', instagramUrl: 'https://instagram.com/rivala' }],
    });
    await startBenchmarkDiscovery('brand-1', 'marca-x', []);
    const session = await getBenchmarkSession('brand-1');
    prismaMock.reference.create.mockResolvedValueOnce({ id: 'ref-a' } as any);
    await confirmBenchmarkCandidates('brand-1', 'marca-x', [{ id: session!.candidates[0]!.id, confirmed: true }]);

    prismaMock.reference.findUnique.mockResolvedValue({ id: 'ref-a', name: 'Rival A', analysisUrl: 'https://instagram.com/rivala', sourceType: 'INSTAGRAM' } as any);
    (discoverCompetitors as ReturnType<typeof vi.fn>).mockClear();
    (discoverCompetitors as ReturnType<typeof vi.fn>).mockResolvedValue({ competitors: [{ name: 'Rival A', instagramUrl: 'https://instagram.com/rivala' }] });

    await runAutoResearchCycle('brand-1', 'marca-x');

    const call = (discoverCompetitors as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[2].allowQuestion).toBe(false);
    expect(prismaMock.brandConfig.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { brandId: 'brand-1' },
      data: expect.objectContaining({ lastAutoResearchAt: expect.any(Date) }),
    }));
  });

  it('runAutoResearchCycle: sem sessão anterior confirmada (nunca rodou Configurar Benchmark), não faz nada além de marcar lastAutoResearchAt', async () => {
    stubBrandConfigStorage();

    await runAutoResearchCycle('brand-1', 'marca-x');

    expect(discoverCompetitors).not.toHaveBeenCalled();
  });
});
