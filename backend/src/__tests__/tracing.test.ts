import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openRun, recordStep, closeRun, ensureRun } from '../lib/generationTracing.js';
import { runWithAiContext, getAiContext } from '../lib/aiContext.js';
import prisma from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

vi.mock('../lib/prisma.js', () => ({
  default: {
    brand: { findUnique: vi.fn() },
    generationRun: { create: vi.fn(), update: vi.fn() },
    generationStep: { create: vi.fn(), aggregate: vi.fn() },
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Slugs distintos por teste: o resolvedor de marca tem cache em memória por
// processo, então reusar o mesmo slug faria um teste enxergar o id do anterior.
let n = 0;
const slug = () => `marca-${++n}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.generationStep.create).mockResolvedValue({} as never);
  vi.mocked(prisma.generationRun.create).mockResolvedValue({} as never);
});

describe('openRun', () => {
  it('traduz o slug da marca para o id antes de gravar', async () => {
    // Regressão: a versão anterior gravava `brandId: ctx.brandSlug`, e como
    // brandId é FK para Brand.id toda inserção violava a constraint — em
    // silêncio, por causa do fail-open. As tabelas nunca recebiam nada.
    const s = slug();
    vi.mocked(prisma.brand.findUnique).mockResolvedValueOnce({ id: 'brand-uuid-real' } as never);

    const runId = await openRun({ brandSlug: s, feature: 'pipeline', brief: 'um brief' });

    expect(runId).toBeTruthy();
    expect(prisma.generationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          brandId: 'brand-uuid-real',
          feature: 'pipeline',
          brief: 'um brief',
          status: 'RUNNING',
        }),
      }),
    );
  });

  it('devolve null e não grava quando a marca não existe', async () => {
    vi.mocked(prisma.brand.findUnique).mockResolvedValueOnce(null as never);

    const runId = await openRun({ brandSlug: slug(), feature: 'pipeline' });

    expect(runId).toBeNull();
    expect(prisma.generationRun.create).not.toHaveBeenCalled();
  });

  it('devolve null sem slug de marca', async () => {
    expect(await openRun({ feature: 'chat' })).toBeNull();
    expect(prisma.generationRun.create).not.toHaveBeenCalled();
  });

  it('devolve null (fail-open) se o banco cair, sem lançar', async () => {
    vi.mocked(prisma.brand.findUnique).mockResolvedValueOnce({ id: 'b' } as never);
    vi.mocked(prisma.generationRun.create).mockRejectedValueOnce(new Error('DB Error'));

    await expect(openRun({ brandSlug: slug(), feature: 'pipeline' })).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('ensureRun', () => {
  it('abre um run implícito e pendura o id no contexto', async () => {
    vi.mocked(prisma.brand.findUnique).mockResolvedValueOnce({ id: 'brand-x' } as never);
    const s = slug();

    await runWithAiContext({ brandSlug: s, feature: 'chat' }, async () => {
      const runId = await ensureRun();
      expect(runId).toBeTruthy();
      // O id tem de ficar no contexto, senão cada chamada da mesma requisição
      // abriria um run novo e o rastro viraria confete.
      expect(getAiContext().runId).toBe(runId);
    });

    expect(prisma.generationRun.create).toHaveBeenCalledTimes(1);
  });

  it('reaproveita o run já aberto em vez de criar outro', async () => {
    await runWithAiContext({ brandSlug: slug(), feature: 'chat', runId: 'ja-aberto' }, async () => {
      expect(await ensureRun()).toBe('ja-aberto');
    });

    expect(prisma.generationRun.create).not.toHaveBeenCalled();
  });

  it('devolve null fora de um escopo de contexto', async () => {
    expect(await ensureRun()).toBeNull();
    expect(prisma.generationRun.create).not.toHaveBeenCalled();
  });
});

describe('recordStep', () => {
  it('grava o step e numera a sequência dentro do run', async () => {
    recordStep({ runId: 'run-seq', kind: 'MODEL', model: 'gemini-x' });
    recordStep({ runId: 'run-seq', kind: 'TOOL', name: 'uma-ferramenta' });
    await new Promise(r => setTimeout(r, 0));

    expect(prisma.generationStep.create).toHaveBeenCalledTimes(2);
    const seqs = vi.mocked(prisma.generationStep.create).mock.calls
      .map(([arg]) => (arg as { data: { seq: number } }).data.seq);
    expect(seqs).toEqual([1, 2]);
  });

  it('trunca prompt e resposta em 100k com marca explícita do corte', async () => {
    recordStep({ runId: 'run-t', kind: 'MODEL', promptText: 'a'.repeat(100_050) });
    await new Promise(r => setTimeout(r, 0));

    const { data } = vi.mocked(prisma.generationStep.create).mock.calls[0]![0] as {
      data: { promptText: string };
    };
    expect(data.promptText.length).toBeLessThan(100_100);
    expect(data.promptText).toContain('[...truncado em 100000 caracteres]');
  });

  it('não lança nem propaga erro quando a escrita falha', async () => {
    vi.mocked(prisma.generationStep.create).mockRejectedValueOnce(new Error('DB Step Error'));

    expect(() => recordStep({ runId: 'run-1', kind: 'MODEL' })).not.toThrow();
    await new Promise(r => setTimeout(r, 0));

    expect(logger.warn).toHaveBeenCalledWith(
      'Falha ao gravar GenerationStep (fail-open)',
      expect.objectContaining({ error: 'DB Step Error' }),
    );
  });
});

describe('closeRun', () => {
  it('fecha somando os tokens dos steps', async () => {
    vi.mocked(prisma.generationStep.aggregate).mockResolvedValueOnce({
      _sum: { inputTokens: 120, outputTokens: 340 },
    } as never);

    await closeRun('run-1', { status: 'COMPLETED' });

    expect(prisma.generationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1' },
        data: expect.objectContaining({
          status: 'COMPLETED',
          totalInputTokens: 120,
          totalOutputTokens: 340,
        }),
      }),
    );
  });

  it('não lança se agregar tokens falhar', async () => {
    vi.mocked(prisma.generationStep.aggregate).mockRejectedValueOnce(new Error('DB Agg Error'));

    await expect(closeRun('run-1', { status: 'COMPLETED' })).resolves.not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      'Falha ao fechar GenerationRun (fail-open)',
      expect.objectContaining({ error: 'DB Agg Error' }),
    );
  });
});
