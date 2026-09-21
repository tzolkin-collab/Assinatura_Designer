import { describe, it, expect, vi } from 'vitest';
import { generateHtmlDesignBatched, type GenerateHtmlDesignInput } from '../lib/htmlDesign';
import { brainAdviceBlock, pipelineAdviceBlock, adviceLines } from '../lib/adviceText';

const baseInput = (slideCount: number, format: GenerateHtmlDesignInput['format'] = 'presentation'): GenerateHtmlDesignInput => ({
  prompt: 'Deck de teste',
  format,
  width: 1920,
  height: 1080,
  slideCount,
  brand: { name: 'Marca X', colors: ['#111111'], primaryFonts: ['Inter'] },
  skeleton: Array.from({ length: slideCount }, (_, i) => ({
    title: `Slide ${i + 1}`, goal: 'Objetivo', layout_type: 'content-split', order: i + 1,
  })),
});

/** Modelo de mentira: devolve exatamente os slides pedidos no lote e guarda os prompts. */
function fakeModel() {
  const prompts: Array<{ start: number; user: string }> = [];
  const generate = vi.fn(async (_sys: string, user: string) => {
    const m = user.match(/Gere os slides de (\d+) a (\d+)/);
    const start = m ? parseInt(m[1]!, 10) : 1;
    const end = m ? parseInt(m[2]!, 10) : 1;
    prompts.push({ start, user });
    return JSON.stringify({
      reasoning: 'direção', fonts: ['Inter'],
      slides: Array.from({ length: end - start + 1 }, (_, i) => ({ html: `<div>Slide ${start + i}</div>`, css: '' })),
    });
  });
  return { generate, prompts };
}
const parse = (raw: string) => JSON.parse(raw);

describe('orientações em tempo real no gerador de lotes', () => {
  it('chama getPendingAdvice no INÍCIO de cada lote, com o número do lote', async () => {
    const { generate } = fakeModel();
    const vistos: Array<{ batch: number; totalBatches: number }> = [];

    await generateHtmlDesignBatched(generate, baseInput(9), parse, undefined, {
      concurrency: 1,
      getPendingAdvice: ({ batch, totalBatches }) => { vistos.push({ batch, totalBatches }); return []; },
    });

    // 9 slides em lotes de 3 = 3 lotes
    expect(vistos).toEqual([
      { batch: 1, totalBatches: 3 },
      { batch: 2, totalBatches: 3 },
      { batch: 3, totalBatches: 3 },
    ]);
  });

  it('a orientação entra no prompt do lote em que foi drenada E nos seguintes — não nos anteriores', async () => {
    const { generate, prompts } = fakeModel();
    const fila = new Map<number, string[]>([[2, ['use fundo escuro em todos os slides']]]);

    await generateHtmlDesignBatched(generate, baseInput(9), parse, undefined, {
      concurrency: 1,
      getPendingAdvice: ({ batch }) => fila.get(batch) ?? [],
    });

    const porInicio = new Map(prompts.map((p) => [p.start, p.user]));
    expect(porInicio.get(1)).not.toContain('use fundo escuro');
    expect(porInicio.get(4)).toContain('use fundo escuro em todos os slides');
    expect(porInicio.get(7)).toContain('use fundo escuro em todos os slides');
    expect(porInicio.get(4)).toContain('ORIENTAÇÕES DO USUÁRIO');
  });

  it('orientações novas se somam às anteriores nos lotes seguintes', async () => {
    const { generate, prompts } = fakeModel();
    const fila = new Map<number, string[]>([[2, ['primeira']], [3, ['segunda']]]);

    await generateHtmlDesignBatched(generate, baseInput(9), parse, undefined, {
      concurrency: 1,
      getPendingAdvice: ({ batch }) => fila.get(batch) ?? [],
    });

    const ultimo = prompts.find((p) => p.start === 7)!.user;
    expect(ultimo).toContain('- primeira');
    expect(ultimo).toContain('- segunda');
    expect(prompts.find((p) => p.start === 4)!.user).not.toContain('- segunda');
  });

  it('sem orientação o prompt não ganha bloco nenhum', async () => {
    const { generate, prompts } = fakeModel();
    await generateHtmlDesignBatched(generate, baseInput(3), parse, undefined, {
      getPendingAdvice: () => [],
    });
    expect(prompts[0]!.user).not.toContain('ORIENTAÇÕES DO USUÁRIO');
  });

  it('falha ao buscar orientação NÃO derruba a geração', async () => {
    const { generate } = fakeModel();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const design = await generateHtmlDesignBatched(generate, baseInput(6), parse, undefined, {
      getPendingAdvice: () => { throw new Error('redis fora'); },
    });
    warn.mockRestore();
    expect(design.slides).toHaveLength(6);
  });

  it('retries do MESMO lote reusam o texto do snapshot (não drenam de novo)', async () => {
    let chamadas = 0;
    const prompts: string[] = [];
    const generate = vi.fn(async (_s: string, user: string) => {
      prompts.push(user);
      chamadas++;
      if (chamadas === 1) throw new Error('falha transitória');
      return JSON.stringify({ reasoning: 'r', fonts: ['Inter'], slides: [{ html: '<div>ok</div>', css: '' }] });
    });
    const drenou = vi.fn(() => ['mais respiro']);

    vi.useFakeTimers();
    const p = generateHtmlDesignBatched(generate, baseInput(1, 'carousel'), parse, undefined, { getPendingAdvice: drenou });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await vi.runAllTimersAsync();
    await p;
    warn.mockRestore();
    vi.useRealTimers();

    expect(drenou).toHaveBeenCalledTimes(1);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain('mais respiro');
    expect(prompts[1]).toContain('mais respiro');
  });
});

describe('interrupção cooperativa no gerador de lotes', () => {
  it('para no limite do lote pedido: devolve os slides já prontos e NÃO lança', async () => {
    const { generate } = fakeModel();
    const consultas: number[] = [];

    const design = await generateHtmlDesignBatched(generate, baseInput(12), parse, undefined, {
      concurrency: 1,
      shouldStop: ({ batch }) => { consultas.push(batch); return batch >= 3; },
    });

    // lotes 1 e 2 rodaram (6 slides); o 3 foi visto e barrado
    expect(design.slides).toHaveLength(6);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(consultas).toEqual([1, 2, 3, 4].slice(0, consultas.length));
    expect(consultas).toContain(3);
  });

  it('pedido já presente no lote 1: devolve vazio sem lançar (não é falha)', async () => {
    const { generate } = fakeModel();
    const design = await generateHtmlDesignBatched(generate, baseInput(6), parse, undefined, {
      shouldStop: () => true,
    });
    expect(design.slides).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
  });

  it('parar vem ANTES de drenar: as pendentes não são gastas num lote que não vai rodar', async () => {
    const { generate } = fakeModel();
    const drenou = vi.fn(() => ['pendente']);
    await generateHtmlDesignBatched(generate, baseInput(6), parse, undefined, {
      shouldStop: () => true,
      getPendingAdvice: drenou,
    });
    expect(drenou).not.toHaveBeenCalled();
  });

  it('com lotes paralelos, os que já começaram terminam e nenhum novo começa', async () => {
    const { generate } = fakeModel();
    let pedidoDepoisDoLote = 0;
    const design = await generateHtmlDesignBatched(generate, baseInput(30), parse, undefined, {
      concurrency: 2,
      shouldStop: ({ batch }) => { pedidoDepoisDoLote = Math.max(pedidoDepoisDoLote, batch); return batch >= 5; },
    });
    // O que sai é um prefixo contíguo de slides (lotes iniciados em ordem)
    const n = design.slides.length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(30);
    expect(n % 3).toBe(0);
    design.slides.forEach((s, i) => expect(s.html).toContain(`Slide ${i + 1}`));
  });

  it('sem shouldStop o comportamento antigo é preservado (guarda de "nenhum slide real" intacta)', async () => {
    const generate = vi.fn(async () => { throw new Error('modelo fora'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();
    const p = generateHtmlDesignBatched(generate, baseInput(3), parse).catch((e) => e);
    await vi.runAllTimersAsync();
    const r = await p;
    vi.useRealTimers();
    warn.mockRestore(); err.mockRestore();
    expect(r).toBeInstanceOf(Error);
    expect((r as Error).message).toMatch(/nenhum slide real/);
  });
});

describe('texto das orientações nos prompts', () => {
  it('normaliza espaços, ignora vazias e corta abusos', () => {
    expect(adviceLines(['  mais   respiro \n aqui ', '', '   '])).toEqual(['- mais respiro aqui']);
    expect(adviceLines(['x'.repeat(5000)])[0]!.length).toBeLessThan(1100);
  });

  it('bloco do cérebro é vazio sem orientação e explícito com ela', () => {
    expect(brainAdviceBlock([])).toBe('');
    expect(brainAdviceBlock(['usar tom mais formal'])).toContain('Orientações do usuário durante esta resposta');
    expect(brainAdviceBlock(['usar tom mais formal'])).toContain('- usar tom mais formal');
  });

  it('bloco do pipeline diz que prevalece sobre o briefing e que não refaz slides prontos', () => {
    const b = pipelineAdviceBlock(['sem fotos']);
    expect(b).toContain('PREVALECE');
    expect(b).toContain('não refaça slides anteriores');
  });
});
