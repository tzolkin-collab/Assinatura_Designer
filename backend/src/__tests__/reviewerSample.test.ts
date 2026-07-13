import { describe, it, expect } from 'vitest';
import { sampleSlideIndexes } from '../agents/reviewer/index';

describe('Amostra do crítico visual', () => {
  it('deck pequeno: revisa tudo, sem sortear', () => {
    expect(sampleSlideIndexes(5, 8)).toEqual([0, 1, 2, 3, 4]);
  });

  it('deck grande: sempre inclui a capa e o encerramento', () => {
    const amostra = sampleSlideIndexes(200, 8);
    expect(amostra[0]).toBe(0);
    expect(amostra[amostra.length - 1]).toBe(199);
  });

  it('deck grande: a amostra é espalhada, não os N primeiros', () => {
    const amostra = sampleSlideIndexes(200, 8);

    expect(amostra).toHaveLength(8);
    // O bug antigo era slice(0, 8): olhava só o começo e nunca via o slide 90.
    expect(amostra).not.toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(amostra.some((i) => i > 100)).toBe(true);
    expect([...amostra].sort((a, b) => a - b)).toEqual(amostra); // em ordem
    expect(new Set(amostra).size).toBe(amostra.length); // sem repetido
  });

  it('devolve exatamente `max` amostras mesmo quando o arredondamento colide', () => {
    // 9 slides em 8 amostras: os índices calculados colidem e antes sobrava menos.
    expect(sampleSlideIndexes(9, 8)).toHaveLength(8);
    expect(sampleSlideIndexes(10, 3)).toHaveLength(3);
  });

  it('casos de borda não explodem', () => {
    expect(sampleSlideIndexes(0, 8)).toEqual([]);
    expect(sampleSlideIndexes(10, 0)).toEqual([]);
    expect(sampleSlideIndexes(1, 8)).toEqual([0]);
  });
});
