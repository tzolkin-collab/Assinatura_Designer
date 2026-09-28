import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attachRunToPost } from '../agents/pipeline.js';
import { estimatePostCost, type CostStepInput } from '../lib/generationCost.js';
import prisma from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

// Blocker 1: researchBrand e runPlanner rodam ANTES de o Post existir. Cada
// generateWithRetry deles passa por ensureRun(), que abre um GenerationRun
// IMPLÍCITO com postId ainda undefined. Se o pipeline abrisse um SEGUNDO run
// depois de criar o Post (comportamento antigo), o implícito ficava órfão,
// RUNNING para sempre, e os tokens do planner/pesquisa nunca entravam no
// "Custo estimado" — estimatePostCost só soma runs COM postId. attachRunToPost
// é o ponto que decide: reaproveitar o implícito, ou abrir um novo quando não
// há nenhum.
vi.mock('../lib/prisma.js', () => ({
  default: {
    brand: { findUnique: vi.fn() },
    post: { findUnique: vi.fn() },
    generationRun: { create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const modelo = (over: Partial<CostStepInput>): CostStepInput => ({ kind: 'MODEL', role: 'fast', ...over });

beforeEach(() => {
  vi.clearAllMocks();
  // Defaults saudáveis: cada teste sobrescreve só o que importa pro seu caso.
  vi.mocked(prisma.generationRun.update).mockResolvedValue({} as never);
  vi.mocked(prisma.generationRun.create).mockResolvedValue({} as never);
  vi.mocked(prisma.post.findUnique).mockResolvedValue({ id: 'post-existente' } as never);
});

describe('attachRunToPost', () => {
  it('reaproveita o run implícito (não abre um segundo) e grava postId/brief/format/aspectRatio nele', async () => {
    const runId = await attachRunToPost('run-implicito', {
      postId: 'post-1',
      brandSlug: 'marca-x',
      sessionId: 'sessao-1',
      brief: 'um brief qualquer',
      format: 'carousel',
      aspectRatio: '4:5',
    });

    expect(runId).toBe('run-implicito');
    expect(prisma.generationRun.update).toHaveBeenCalledWith({
      where: { id: 'run-implicito' },
      data: { postId: 'post-1', brief: 'um brief qualquer', format: 'carousel', aspectRatio: '4:5' },
    });
    // O ponto central do blocker: NENHUM run novo é criado quando já existe um implícito.
    expect(prisma.generationRun.create).not.toHaveBeenCalled();
  });

  it('sem run implícito, abre um novo normalmente (comportamento pré-existente)', async () => {
    vi.mocked(prisma.brand.findUnique).mockResolvedValueOnce({ id: 'brand-uuid' } as never);
    vi.mocked(prisma.generationRun.create).mockResolvedValueOnce({} as never);

    const runId = await attachRunToPost(undefined, {
      postId: 'post-2',
      brandSlug: 'marca-y',
      sessionId: 'sessao-2',
      brief: 'outro brief',
      format: 'presentation',
    });

    expect(runId).toBeTruthy();
    expect(prisma.generationRun.update).not.toHaveBeenCalled();
    expect(prisma.generationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ feature: 'pipeline', brief: 'outro brief', format: 'presentation' }),
      }),
    );
  });

  it('fail-open: se o update falhar, ainda devolve o id do implícito (não trava o pipeline) e avisa no log', async () => {
    vi.mocked(prisma.generationRun.update).mockRejectedValueOnce(new Error('DB fora do ar'));

    const runId = await attachRunToPost('run-implicito', {
      postId: 'post-3',
      brandSlug: 'marca-z',
      sessionId: 'sessao-3',
      brief: 'brief',
      format: 'carousel',
    });

    expect(runId).toBe('run-implicito');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('regressão fim-a-fim: os tokens gravados no run ENQUANTO ele era implícito aparecem no custo do post depois do reaproveitamento', async () => {
    // 1) Enquanto o run era implícito (antes do Post existir), o planner/pesquisa
    //    já gravaram steps nele — via recordStep, fora do escopo deste teste; aqui
    //    simulamos o que a rota de custo leria DEPOIS do reaproveitamento: a mesma
    //    linha de GenerationRun, agora com postId preenchido.
    const stepsDoRunImplicito: CostStepInput[] = [
      modelo({ role: 'fast', model: 'gemini-2.5-flash', inputTokens: 2_000, outputTokens: 500 }), // pesquisa
      modelo({ role: 'fast', model: 'gemini-2.5-flash', inputTokens: 3_000, outputTokens: 1_500 }), // planner
    ];

    // 2) attachRunToPost reaproveita o run implícito — é a chamada que teria
    //    atualizado postId na linha real do banco.
    const runId = await attachRunToPost('run-implicito', {
      postId: 'post-4',
      brandSlug: 'marca-w',
      sessionId: 'sessao-4',
      brief: 'brief',
      format: 'carousel',
    });
    expect(runId).toBe('run-implicito');
    expect(prisma.generationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'run-implicito' }, data: expect.objectContaining({ postId: 'post-4' }) }),
    );

    // 3) Com o postId gravado, a rota GET /api/posts/:id/cost (where: {postId})
    //    passa a incluir este run — e os tokens do planner/pesquisa entram na conta.
    //    Sem a correção, este run nunca aparecia nessa consulta (postId ficava NULL).
    const estimate = estimatePostCost([{ run: {}, steps: stepsDoRunImplicito }]);

    expect(estimate.calls).toBe(2);
    expect(estimate.inputTokens).toBe(5_000);
    expect(estimate.outputTokens).toBe(2_000);
  });
});
