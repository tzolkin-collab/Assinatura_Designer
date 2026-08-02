import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openRun, recordStep, closeRun } from '../lib/generationTracing.js';
import prisma from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

vi.mock('../lib/prisma.js', () => ({
  default: {
    generationRun: {
      create: vi.fn(),
      update: vi.fn(),
    },
    generationStep: {
      create: vi.fn(),
      aggregate: vi.fn(),
    },
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('Generation Tracing (Fail-open)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('openRun falha silenciosamente (fail-open) se o banco der erro', async () => {
    vi.mocked(prisma.generationRun.create).mockRejectedValueOnce(new Error('DB Error'));

    await expect(
      openRun({
        id: 'run-1',
        brandId: 'brand-1',
        feature: 'pipeline',
      })
    ).resolves.not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      'Falha ao abrir GenerationRun (fail-open, não quebra a requisição)',
      expect.objectContaining({ error: 'DB Error' })
    );
  });

  it('recordStep não trava a execução e registra logs', async () => {
    vi.mocked(prisma.generationStep.create).mockRejectedValueOnce(new Error('DB Step Error'));

    // É void / fire and forget
    expect(() =>
      recordStep({
        runId: 'run-1',
        kind: 'MODEL',
      })
    ).not.toThrow();

    // Como é assíncrono internamente, aguardamos
    await new Promise(r => setTimeout(r, 0));

    expect(logger.warn).toHaveBeenCalledWith(
      'Falha ao gravar GenerationStep (fail-open)',
      expect.objectContaining({ error: 'DB Step Error' })
    );
  });

  it('closeRun não lança erro se agregar tokens falhar', async () => {
    vi.mocked(prisma.generationStep.aggregate).mockRejectedValueOnce(new Error('DB Agg Error'));

    await expect(closeRun('run-1', { status: 'COMPLETED' })).resolves.not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      'Falha ao fechar GenerationRun (fail-open)',
      expect.objectContaining({ error: 'DB Agg Error' })
    );
  });
});
