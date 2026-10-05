import { describe, it, expect } from 'vitest';
import { config } from '../config.js';
import {
  estimateRunCost,
  estimatePostCost,
  runDurationMs,
  isPostInProgress,
  IN_PROGRESS_WINDOW_MS,
  type CostStepInput,
} from '../lib/generationCost.js';

// Tabela fixa: o teste não pode quebrar quando o preço real de config.ts mudar.
const PRECOS = {
  'modelo-pro': { input: 2, output: 12 },
  'modelo-flash': { input: 0.3, output: 2.5 },
  'modelo-imagem': { input: 0.5, output: 60 },
  'modelo-lite': { input: 0.1, output: 0.4 },
};

const run = { startedAt: '2026-09-21T10:00:00.000Z', finishedAt: '2026-09-21T10:02:30.000Z' };

const modelo = (over: Partial<CostStepInput>): CostStepInput => ({ kind: 'MODEL', role: 'artist', ...over });

describe('estimateRunCost — preço por modelo e por papel', () => {
  it('cobra input e output com preços separados, agrupando por papel e por modelo', () => {
    const est = estimateRunCost(
      run,
      [
        // 10k in a US$2/M = 0,02 ; 2k out a US$12/M = 0,024 → 0,044
        modelo({ role: 'artist', model: 'modelo-pro', inputTokens: 10_000, outputTokens: 2_000 }),
        // 5k in a US$0,3/M = 0,0015 ; 1k out a US$2,5/M = 0,0025 → 0,004
        modelo({ role: 'fast', model: 'modelo-flash', inputTokens: 5_000, outputTokens: 1_000 }),
      ],
      PRECOS,
    );

    expect(est.estimated).toBe(true);
    expect(est.totalUsd).toBe(0.048);
    expect(est.byRole.artist).toEqual({ usd: 0.044, inputTokens: 10_000, outputTokens: 2_000, calls: 1 });
    expect(est.byRole.fast!.usd).toBe(0.004);
    expect(est.byModel['modelo-pro']!.priced).toBe(true);
    expect(est.calls).toBe(2);
    expect(est.inputTokens).toBe(15_000);
    expect(est.outputTokens).toBe(3_000);
    expect(est.partial).toBe(false);
    expect(est.unpricedModels).toEqual([]);
  });

  it('soma os tokens de raciocínio como output (o Gemini cobra thinking como output)', () => {
    // 1k out (0,012) + 4k thinking (0,048) = 0,06. Sem contar o thinking daria 0,012.
    const est = estimateRunCost(
      run,
      [modelo({ model: 'modelo-pro', inputTokens: 0, outputTokens: 1_000, metadata: { thinkingTokens: 4_000 } })],
      PRECOS,
    );

    expect(est.totalUsd).toBe(0.06);
    expect(est.outputTokens).toBe(5_000);
    expect(est.thinkingTokens).toBe(4_000);
  });

  it('ignora steps de ferramenta: não chamam modelo', () => {
    const est = estimateRunCost(
      run,
      [{ kind: 'TOOL', name: 'set_design', inputTokens: 999, outputTokens: 999 }],
      PRECOS,
    );

    expect(est.calls).toBe(0);
    expect(est.totalUsd).toBe(0);
  });
});

describe('estimateRunCost — modelo sem preço', () => {
  it('lista em unpricedModels e marca o total como parcial, em vez de virar zero calado', () => {
    const est = estimateRunCost(
      run,
      [
        modelo({ model: 'modelo-pro', inputTokens: 10_000, outputTokens: 0 }), // 0,02
        modelo({ role: 'brain', model: 'modelo-fantasma', inputTokens: 50_000, outputTokens: 8_000 }),
      ],
      PRECOS,
    );

    expect(est.unpricedModels).toEqual(['modelo-fantasma']);
    expect(est.partial).toBe(true);
    // O total só tem o que foi possível precificar...
    expect(est.totalUsd).toBe(0.02);
    // ...mas os tokens do modelo sem preço continuam contados e visíveis.
    expect(est.byModel['modelo-fantasma']).toEqual({
      usd: 0,
      inputTokens: 50_000,
      outputTokens: 8_000,
      calls: 1,
      priced: false,
    });
    expect(est.inputTokens).toBe(60_000);
  });

  it('step com tokens mas sem nome de modelo também é parcial', () => {
    const est = estimateRunCost(run, [modelo({ model: null, inputTokens: 1_000, outputTokens: 1_000 })], PRECOS);

    expect(est.unpricedModels).toEqual(['desconhecido']);
    expect(est.partial).toBe(true);
  });

  it('step de modelo que respondeu sem contagem de tokens é parcial (custo desconhecido)', () => {
    const est = estimateRunCost(run, [modelo({ model: 'modelo-pro', inputTokens: null, outputTokens: null })], PRECOS);

    expect(est.unmeteredSteps).toBe(1);
    expect(est.partial).toBe(true);
  });

  it('falha registrada (com erro e sem tokens) não foi cobrada: não torna o total parcial', () => {
    const est = estimateRunCost(
      run,
      [modelo({ model: 'modelo-pro', inputTokens: null, outputTokens: null, error: '503' })],
      PRECOS,
    );

    expect(est.partial).toBe(false);
    expect(est.totalUsd).toBe(0);
  });
});

describe('estimateRunCost — imagem cobrada por tokens de saída', () => {
  it('precifica o step IMAGE pelo output (1120 tokens ≈ US$ 0,067 num modelo a US$ 60/M)', () => {
    const est = estimateRunCost(
      run,
      [{ kind: 'IMAGE', model: 'modelo-imagem', inputTokens: 200, outputTokens: 1_120 }],
      PRECOS,
    );

    // 200 in a 0,5/M = 0,0001 ; 1120 out a 60/M = 0,0672
    expect(est.totalUsd).toBe(0.0673);
    expect(est.imageCount).toBe(1);
    expect(est.byRole.image!.calls).toBe(1);
    expect(est.byRole.image!.usd).toBe(0.0673);
  });

  it('não conta como imagem a falha final (sem modelo, com erro)', () => {
    const est = estimateRunCost(
      run,
      [
        { kind: 'IMAGE', model: 'modelo-imagem', inputTokens: 200, outputTokens: 1_120 },
        { kind: 'IMAGE', error: 'Nenhum modelo de imagem retornou imagem utilizável' },
      ],
      PRECOS,
    );

    expect(est.imageCount).toBe(1);
    expect(est.partial).toBe(false);
  });

  it('a imagem conta mesmo se o provedor não devolveu tokens, e o total vira parcial', () => {
    const est = estimateRunCost(run, [{ kind: 'IMAGE', model: 'modelo-imagem' }], PRECOS);

    expect(est.imageCount).toBe(1);
    expect(est.unmeteredSteps).toBe(1);
    expect(est.partial).toBe(true);
  });
});

describe('estimateRunCost — run sem steps e arredondamento', () => {
  it('run sem steps devolve zeros, sem erro e sem "parcial"', () => {
    const est = estimateRunCost({}, [], PRECOS);

    expect(est).toEqual({
      estimated: true,
      totalUsd: 0,
      partial: false,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      byRole: {},
      byModel: {},
      imageCount: 0,
      durationMs: null,
      unpricedModels: [],
      unmeteredSteps: 0,
    });
  });

  it('arredonda só no fim: 7 chamadas de US$ 0,00001 somam 0,0001, não 0', () => {
    // Cada uma custa 100 tokens × US$ 0,1/M = 0,00001. Arredondar step a step
    // (4 casas) zeraria cada uma, e um deck de muitas chamadas baratas sairia de graça.
    const steps = Array.from({ length: 7 }, () =>
      modelo({ role: 'utility', model: 'modelo-lite', inputTokens: 100, outputTokens: 0 }),
    );

    const est = estimateRunCost(run, steps, PRECOS);

    expect(est.totalUsd).toBe(0.0001);
    expect(est.byRole.utility!.calls).toBe(7);
  });

  it('limita o resultado a 4 casas decimais', () => {
    const est = estimateRunCost(run, [modelo({ model: 'modelo-pro', inputTokens: 12_345, outputTokens: 6_789 })], PRECOS);

    // 12345×2/1e6 + 6789×12/1e6 = 0,02469 + 0,081468 = 0,106158
    expect(est.totalUsd).toBe(0.1062);
  });

  it('trata tokens null, negativos ou NaN como zero, sem contaminar o total', () => {
    const est = estimateRunCost(
      run,
      [modelo({ model: 'modelo-pro', inputTokens: -50, outputTokens: Number.NaN }), modelo({ model: 'modelo-pro', inputTokens: 1_000, outputTokens: 0 })],
      PRECOS,
    );

    expect(est.totalUsd).toBe(0.002);
    expect(Number.isNaN(est.totalUsd)).toBe(false);
  });
});

describe('duração', () => {
  it('calcula pela diferença entre começo e fim do run', () => {
    expect(runDurationMs(run)).toBe(150_000);
    expect(estimateRunCost(run, [], PRECOS).durationMs).toBe(150_000);
  });

  it('aceita Date (é o que o Prisma devolve)', () => {
    expect(runDurationMs({ startedAt: new Date('2026-01-01T00:00:00Z'), finishedAt: new Date('2026-01-01T00:00:10Z') })).toBe(10_000);
  });

  it('run ainda rodando (sem finishedAt) ou com datas absurdas fica null, não 0', () => {
    expect(runDurationMs({ startedAt: run.startedAt, finishedAt: null })).toBeNull();
    expect(runDurationMs({ startedAt: run.finishedAt, finishedAt: run.startedAt })).toBeNull();
    expect(runDurationMs({ startedAt: 'lixo', finishedAt: run.finishedAt })).toBeNull();
  });
});

describe('estimatePostCost — deck com vários runs', () => {
  it('soma custo, tokens, imagens e duração de todos os runs do post', () => {
    const est = estimatePostCost(
      [
        {
          run,
          steps: [
            modelo({ model: 'modelo-pro', inputTokens: 10_000, outputTokens: 0 }), // 0,02
            { kind: 'IMAGE', model: 'modelo-imagem', inputTokens: 0, outputTokens: 1_000 }, // 0,06
          ],
        },
        {
          // edição posterior de slide
          run: { startedAt: '2026-09-21T11:00:00.000Z', finishedAt: '2026-09-21T11:00:20.000Z' },
          steps: [modelo({ model: 'modelo-pro', inputTokens: 5_000, outputTokens: 0 })], // 0,01
        },
      ],
      PRECOS,
    );

    expect(est.totalUsd).toBe(0.09);
    expect(est.byRole.artist!.calls).toBe(2);
    expect(est.imageCount).toBe(1);
    expect(est.durationMs).toBe(170_000);
  });

  it('duração fica null quando nenhum run terminou', () => {
    const est = estimatePostCost([{ run: { startedAt: run.startedAt }, steps: [] }], PRECOS);

    expect(est.durationMs).toBeNull();
  });

  it('modelo sem preço em qualquer run marca o deck inteiro como parcial', () => {
    const est = estimatePostCost(
      [
        { run, steps: [modelo({ model: 'modelo-pro', inputTokens: 1_000, outputTokens: 0 })] },
        { run, steps: [modelo({ model: 'modelo-fantasma', inputTokens: 1_000, outputTokens: 0 })] },
      ],
      PRECOS,
    );

    expect(est.partial).toBe(true);
    expect(est.unpricedModels).toEqual(['modelo-fantasma']);
  });
});

describe('tabela de preço real (config.ts)', () => {
  it('todo modelo padrão de config.models tem preço: nenhum papel cai em "sem preço" de fábrica', () => {
    // Regressão do bug que o config.ts descreve: modelo de imagem fora da tabela virava US$ 0,00.
    const steps: CostStepInput[] = Object.values(config.models).map((m) => ({
      kind: 'MODEL',
      role: 'x',
      model: m,
      inputTokens: 1_000,
      outputTokens: 1_000,
    }));

    const est = estimateRunCost({}, steps);

    expect(est.unpricedModels).toEqual([]);
    expect(est.totalUsd).toBeGreaterThan(0);
  });

  it('a imagem do modelo padrão custa cerca de US$ 0,067 a 1K (1120 tokens)', () => {
    const est = estimateRunCost({}, [
      { kind: 'IMAGE', model: config.models.image, inputTokens: 0, outputTokens: 1_120 },
    ]);

    expect(est.totalUsd).toBeCloseTo(0.0672, 4);
  });
});

describe('isPostInProgress — blocker: run implícito não fecha, e travava "em andamento" para sempre', () => {
  const AGORA = new Date('2026-09-28T12:00:00.000Z').getTime();

  it('run implícito antigo (feature edit-slide, RUNNING, de horas atrás) NÃO conta como em andamento', () => {
    const inProgress = isPostInProgress(
      [{ status: 'RUNNING', feature: 'edit-slide', startedAt: new Date(AGORA - 3 * 60 * 60 * 1000) }],
      AGORA,
    );

    expect(inProgress).toBe(false);
  });

  it('run pipeline RUNNING recente conta como em andamento', () => {
    const inProgress = isPostInProgress(
      [{ status: 'RUNNING', feature: 'pipeline', startedAt: new Date(AGORA - 5 * 60 * 1000) }],
      AGORA,
    );

    expect(inProgress).toBe(true);
  });

  it('run pipeline RUNNING mas fora da janela (processo caiu no meio) NÃO conta — o valor já parou de subir', () => {
    const inProgress = isPostInProgress(
      [{ status: 'RUNNING', feature: 'pipeline', startedAt: new Date(AGORA - IN_PROGRESS_WINDOW_MS - 1000) }],
      AGORA,
    );

    expect(inProgress).toBe(false);
  });

  it('run pipeline COMPLETED não conta, mesmo recente', () => {
    const inProgress = isPostInProgress(
      [{ status: 'COMPLETED', feature: 'pipeline', startedAt: new Date(AGORA - 1000) }],
      AGORA,
    );

    expect(inProgress).toBe(false);
  });

  it('sem runs, não está em andamento', () => {
    expect(isPostInProgress([], AGORA)).toBe(false);
  });

  it('run sem startedAt não conta (não dá para saber a idade)', () => {
    const inProgress = isPostInProgress([{ status: 'RUNNING', feature: 'pipeline', startedAt: null }], AGORA);

    expect(inProgress).toBe(false);
  });
});
