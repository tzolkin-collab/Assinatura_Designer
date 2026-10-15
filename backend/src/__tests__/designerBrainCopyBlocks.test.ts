import { describe, it, expect } from 'vitest';
import { parseCopyBlocks } from '../lib/designerBrain/copyBlocks.js';

describe('parseCopyBlocks', () => {
  it('sem marcas: o texto passa intacto e vale como aprovado (nada muda para quem não usa)', () => {
    const src = 'Slide 1\nTítulo\n\nSlide 2\nCorpo';
    const r = parseCopyBlocks(src);
    expect(r.hasMarkers).toBe(false);
    expect(r.copyForSlides).toBe(src);
    expect(r.blocks).toEqual([{ status: 'approved', text: src }]);
    expect(r.hasInReview).toBe(false);
  });

  it('vazio: sem blocos', () => {
    expect(parseCopyBlocks(undefined).blocks).toEqual([]);
    expect(parseCopyBlocks('   ').copyForSlides).toBe('   ');
  });

  it('separa cada bloco pelo status e só aprovado vai para os slides', () => {
    const r = parseCopyBlocks(
      ['[APROVADO]', 'Título final', '', '[FALA]', 'Aqui eu conto a história', '[INTERNO]', 'Valor do contrato R$ 18 mil', '[CONTEXTO]', 'Cliente é conservador'].join('\n'),
    );
    expect(r.hasMarkers).toBe(true);
    expect(r.copyForSlides).toBe('Título final');
    expect(r.blocks.map((b) => b.status)).toEqual(['approved', 'speech', 'internal', 'context']);
    expect(r.excluded).toEqual({ guidance: 2, withheld: 1 });
  });

  it('texto interno e "não exibir" jamais entram no texto dos slides', () => {
    const r = parseCopyBlocks('[APROVADO] Oi\n[NÃO EXIBIR] segredo\n[nao mostrar] outro segredo');
    expect(r.copyForSlides).toBe('Oi');
    expect(r.copyForSlides).not.toContain('segredo');
  });

  it('em revisão vai para os slides como rascunho e impede chamar de final', () => {
    const r = parseCopyBlocks('[APROVADO] Fechado\n[EM REVISÃO] Talvez mude');
    expect(r.copyForSlides).toBe('Fechado\n\nTalvez mude');
    expect(r.hasInReview).toBe(true);
  });

  it('texto antes da primeira marca conta como aprovado', () => {
    const r = parseCopyBlocks('Abertura\n[FALA] só falado');
    expect(r.blocks.map((b) => b.status)).toEqual(['approved', 'speech']);
    expect(r.copyForSlides).toBe('Abertura');
  });

  it('colchetes que não são marca (ex.: [Slide 3]) ficam no texto', () => {
    const r = parseCopyBlocks('[Slide 3]\nTexto');
    expect(r.hasMarkers).toBe(false);
    expect(r.copyForSlides).toBe('[Slide 3]\nTexto');
  });

  it('só orientação, sem nada aprovado: os slides ficam sem texto (o pipeline então para e pede)', () => {
    const r = parseCopyBlocks('[FALA] só fala\n[CONTEXTO] só contexto');
    expect(r.copyForSlides).toBe('');
  });
});
