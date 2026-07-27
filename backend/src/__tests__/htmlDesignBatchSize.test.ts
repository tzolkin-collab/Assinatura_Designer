import { describe, it, expect, vi } from 'vitest';
import { generateHtmlDesignBatched, type GenerateHtmlDesignInput } from '../lib/htmlDesign';

const baseInput = (format: GenerateHtmlDesignInput['format'], slideCount: number): GenerateHtmlDesignInput => ({
  prompt: 'Um deck qualquer',
  format,
  width: format === 'presentation' ? 1920 : 1080,
  height: 1080,
  slideCount,
  brand: { name: 'Marca X', colors: ['#111111'], primaryFonts: ['Inter'] },
  skeleton: Array.from({ length: slideCount }, (_, i) => ({
    title: `Slide ${i + 1}`,
    goal: 'Objetivo',
    layout_type: 'content-split',
    order: i + 1,
  })),
});

// Simula o modelo devolvendo exatamente os N slides pedidos no lote, inferindo o
// tamanho do lote a partir do próprio texto do prompt ("Gere os slides de X a Y").
const generateTextMock = vi.fn(async (_systemInstruction: string, userPrompt: string) => {
  const m = userPrompt.match(/Gere os slides de (\d+) a (\d+)/);
  const start = m ? parseInt(m[1]!, 10) : 1;
  const end = m ? parseInt(m[2]!, 10) : 1;
  const n = end - start + 1;
  return JSON.stringify({
    reasoning: 'Direção de arte de teste',
    fonts: ['Inter'],
    slides: Array.from({ length: n }, (_, i) => ({ html: `<div>Slide ${start + i}</div>`, css: '' })),
  });
});

describe('generateHtmlDesignBatched — tamanho do lote por formato', () => {
  it('carousel (Design): lote de 1 — cada slide vira sua própria chamada à IA e chega individualmente', async () => {
    generateTextMock.mockClear();
    const emitted: number[] = [];

    await generateHtmlDesignBatched(
      generateTextMock,
      baseInput('carousel', 4),
      (raw) => JSON.parse(raw as string),
      (_partial, index) => { emitted.push(index); },
      { concurrency: 1 },
    );

    // 4 slides, lote de 1 => 4 chamadas ao modelo (não 2, como seria com lote de 3).
    expect(generateTextMock).toHaveBeenCalledTimes(4);
    expect(emitted.sort()).toEqual([0, 1, 2, 3]);
  });

  it('presentation: mantém lote de 3 (comportamento anterior preservado — decks grandes não podem pagar 1 chamada por slide)', async () => {
    generateTextMock.mockClear();

    await generateHtmlDesignBatched(
      generateTextMock,
      baseInput('presentation', 6),
      (raw) => JSON.parse(raw as string),
      undefined,
      { concurrency: 1 },
    );

    // 6 slides, lote de 3 => 2 chamadas ao modelo.
    expect(generateTextMock).toHaveBeenCalledTimes(2);
  });
});
