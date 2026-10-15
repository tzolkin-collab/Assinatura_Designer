import { describe, expect, it, vi } from 'vitest';
import { buildCorrectionInstruction, correctTextDivergences } from '../lib/designerBrain/correction.js';

const slide = (txt: string) => ({ html: `<div><h1>${txt}</h1></div>` });

describe('correctTextDivergences', () => {
  it('não chama o artista quando o texto confere', async () => {
    const editSlide = vi.fn();
    const r = await correctTextDivergences({ approved: ['Olá mundo'], slides: [slide('Olá mundo')], editSlide });
    expect(editSlide).not.toHaveBeenCalled();
    expect(r.remaining).toEqual([]);
    expect(r.attempts).toBe(0);
  });

  it('corrige o slide que tem texto inventado e para na primeira rodada', async () => {
    const editSlide = vi.fn(async () => slide('Olá mundo'));
    const r = await correctTextDivergences({ approved: ['Olá mundo'], slides: [slide('Olá mundo AMANDA COELHO')], editSlide });
    expect(editSlide).toHaveBeenCalledTimes(1);
    expect(editSlide.mock.calls[0]![1]).toContain('"amanda"');
    expect(r.remaining).toEqual([]);
    expect(r.corrected).toEqual([0]);
    expect(r.attempts).toBe(1);
  });

  it('só mexe nos slides com desvio', async () => {
    const editSlide = vi.fn(async () => slide('dois'));
    const r = await correctTextDivergences({
      approved: ['um', 'dois'],
      slides: [slide('um'), slide('dois 02')],
      editSlide,
    });
    expect(editSlide).toHaveBeenCalledTimes(1);
    expect(editSlide.mock.calls[0]![2]).toBe(1);
    expect(r.remaining).toEqual([]);
  });

  it('desiste depois de MAX tentativas e reporta o que sobrou', async () => {
    const editSlide = vi.fn(async (s) => s);
    const r = await correctTextDivergences({ approved: ['a'], slides: [slide('a b')], editSlide, maxAttempts: 2 });
    expect(editSlide).toHaveBeenCalledTimes(2);
    expect(r.attempts).toBe(2);
    expect(r.remaining).toHaveLength(1);
    expect(r.remaining[0]!.extra).toEqual(['b']);
  });

  it('descarta uma edição que piora o slide', async () => {
    const original = slide('a b');
    const editSlide = vi.fn(async () => slide('a b c d'));
    const r = await correctTextDivergences({ approved: ['a'], slides: [original], editSlide, maxAttempts: 1 });
    expect(r.slides[0]!.html).toBe(original.html);
    expect(r.corrected).toEqual([]);
  });

  it('uma edição que falha não derruba o laço', async () => {
    const editSlide = vi.fn(async () => { throw new Error('boom'); });
    const r = await correctTextDivergences({ approved: ['a'], slides: [slide('a b')], editSlide, maxAttempts: 1 });
    expect(r.remaining).toHaveLength(1);
    expect(r.slides).toHaveLength(1);
  });

  it('respeita o deslocamento do índice reportado', async () => {
    const editSlide = vi.fn(async () => slide('a'));
    const r = await correctTextDivergences({ approved: ['a'], slides: [slide('a x')], editSlide, indexOffset: 1 });
    expect(editSlide.mock.calls[0]![2]).toBe(1);
    expect(r.remaining).toEqual([]);
  });
});

describe('buildCorrectionInstruction', () => {
  it('traz o texto literal, o que remover e o que restaurar', () => {
    const txt = buildCorrectionInstruction('Pensar é livre', { slideIndex: 0, missing: ['livre'], extra: ['01'] });
    expect(txt).toContain('Pensar é livre');
    expect(txt).toContain('"01"');
    expect(txt).toContain('"livre"');
  });
  it('slide sem texto aprovado não pode ter texto', () => {
    expect(buildCorrectionInstruction('', { slideIndex: 2, missing: [], extra: ['x'] })).toContain('não pode ter texto algum');
  });
});
