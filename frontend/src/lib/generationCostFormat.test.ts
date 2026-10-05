import { describe, it, expect } from 'vitest';
import {
  costWarnings,
  formatChipLabel,
  formatDuration,
  formatImageCount,
  formatRoleTokens,
  formatSummaryLine,
  formatUsd,
  roleLabel,
  roleRows,
  type GenerationCostAvailable,
} from './generationCostFormat';

const base = (over: Partial<GenerationCostAvailable> = {}): GenerationCostAvailable => ({
  available: true,
  estimated: true,
  totalUsd: 0.31,
  partial: false,
  runs: 1,
  inProgress: false,
  calls: 12,
  inputTokens: 80_000,
  outputTokens: 20_000,
  thinkingTokens: 5_000,
  byRole: {},
  imageCount: 6,
  durationMs: 150_000,
  unpricedModels: [],
  unmeteredSteps: 0,
  ...over,
});

describe('formatUsd', () => {
  it('usa vírgula decimal e duas casas', () => {
    expect(formatUsd(0.31)).toBe('US$ 0,31');
    expect(formatUsd(1234.5)).toBe('US$ 1.234,50');
  });

  it('centavos quebrados viram "< US$ 0,01", não "US$ 0,00"', () => {
    expect(formatUsd(0.004)).toBe('< US$ 0,01');
  });

  it('zero, negativo e NaN não quebram a tela', () => {
    expect(formatUsd(0)).toBe('US$ 0,00');
    expect(formatUsd(-1)).toBe('US$ 0,00');
    expect(formatUsd(Number.NaN)).toBe('US$ 0,00');
  });
});

describe('formatChipLabel', () => {
  it('rotula como estimativa', () => {
    expect(formatChipLabel(base())).toBe('Custo estimado US$ 0,31');
  });

  it('total parcial vira piso (≥): o valor exato seria mentira', () => {
    expect(formatChipLabel(base({ partial: true }))).toBe('Custo estimado ≥ US$ 0,31');
  });
});

describe('formatDuration', () => {
  it.each([
    [45_000, '45 s'],
    [60_000, '1 min'],
    [150_000, '2 min 30 s'],
    [125_000, '2 min 05 s'],
    [3_600_000, '1 h 00 min'],
    [3_900_000, '1 h 05 min'],
  ])('%d ms → %s', (ms, esperado) => {
    expect(formatDuration(ms)).toBe(esperado);
  });

  it('desconhecida (run em andamento) é "—", não "0 s"', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(-5)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
  });
});

describe('papéis', () => {
  it('nomeia os papéis pelo que fazem de verdade (fast = planejador + revisor de texto)', () => {
    expect(roleLabel('fast')).toBe('Planejador e revisor de texto');
    expect(roleLabel('artist')).toBe('Artista e revisor visual');
    expect(roleLabel('image')).toBe('Imagens');
    expect(roleLabel('coisa-nova')).toBe('Outros');
  });

  it('ordena numa sequência estável e descarta papel sem chamada', () => {
    const c = { usd: 1, inputTokens: 1, outputTokens: 1 };
    const rows = roleRows({
      image: { ...c, calls: 6 },
      zeta: { ...c, calls: 1 },
      artist: { ...c, calls: 3 },
      utility: { ...c, calls: 0 },
      fast: { ...c, calls: 2 },
      alfa: { ...c, calls: 1 },
    });

    expect(rows.map((r) => r.role)).toEqual(['fast', 'artist', 'image', 'alfa', 'zeta']);
    expect(rows[0]!.label).toBe('Planejador e revisor de texto');
  });

  it('formata os tokens de um papel', () => {
    expect(formatRoleTokens({ inputTokens: 10_200, outputTokens: 900 })).toBe('10,2 mil entrada · 900 saída');
  });
});

describe('formatImageCount', () => {
  it('singular, plural e zero', () => {
    expect(formatImageCount(1)).toBe('1 imagem');
    expect(formatImageCount(6)).toBe('6 imagens');
    expect(formatImageCount(0)).toBe('nenhuma imagem');
  });
});

describe('formatSummaryLine', () => {
  it('junta imagens, duração e nº de execuções', () => {
    expect(formatSummaryLine(base({ runs: 3 }))).toBe('6 imagens · 2 min 30 s · 3 execuções');
  });

  it('omite o que não se sabe (duração null) e o que é trivial (1 execução)', () => {
    expect(formatSummaryLine(base({ durationMs: null, runs: 1, imageCount: 0 }))).toBe('nenhuma imagem');
  });
});

describe('costWarnings — o que precisa aparecer junto do número', () => {
  it('sem nada de errado e com thinking gravado: nenhum aviso', () => {
    expect(costWarnings(base())).toEqual([]);
  });

  it('modelo sem preço: nomeia o modelo e diz que o total é um mínimo', () => {
    const w = costWarnings(base({ partial: true, unpricedModels: ['gemini-9-ultra-preview'] }));

    expect(w).toHaveLength(1);
    expect(w[0]).toContain('Gemini 9 ultra');
    expect(w[0]).toMatch(/mínimo/);
  });

  it('modelo não identificado tem nome legível', () => {
    const w = costWarnings(base({ partial: true, unpricedModels: ['desconhecido'] }));

    expect(w[0]).toContain('modelo não identificado');
  });

  it('chamadas sem contagem de tokens: singular e plural', () => {
    expect(costWarnings(base({ partial: true, unmeteredSteps: 1 }))[0]).toMatch(/^1 chamada respondeu/);
    expect(costWarnings(base({ partial: true, unmeteredSteps: 3 }))[0]).toMatch(/^3 chamadas responderam .* ficaram fora da conta/);
  });

  it('geração em andamento avisa que o valor ainda sobe', () => {
    expect(costWarnings(base({ inProgress: true }))[0]).toMatch(/ainda vai subir/);
  });

  it('deck sem tokens de raciocínio gravados avisa que o valor tende a ser maior', () => {
    const w = costWarnings(base({ thinkingTokens: 0 }));

    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/raciocínio/);
    expect(w[0]).toMatch(/tende a ser maior/);
  });

  it('deck sem nenhuma chamada não gera o aviso de raciocínio (não há o que subestimar)', () => {
    expect(costWarnings(base({ thinkingTokens: 0, calls: 0 }))).toEqual([]);
  });
});
