import { describe, it, expect } from 'vitest';
import { BRIEF_MESSAGE_SEPARATOR, briefForBrain, parseCopyBlocks, withoutWithheldText } from '../lib/designerBrain/copyBlocks.js';

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

describe('withoutWithheldText (o interno também sai do briefing da conversa)', () => {
  const colado = ['[APROVADO]', 'TITULO-APROVADO', '[INTERNO]', 'VALOR-DO-CONTRATO', 'SEGUNDA-LINHA', '[NÃO EXIBIR] SEGREDO-INLINE', '[FALA]', 'FALA-OK'].join('\n');

  it('sem nenhuma marca devolve o texto original, byte a byte (inclusive CRLF)', () => {
    const livre = 'Brief\r\n  com   espaços\n[Slide 3] x\n';
    expect(withoutWithheldText(livre)).toBe(livre);
  });

  it('com marcas, mas nenhuma interna, também devolve o texto original, byte a byte', () => {
    const t = 'Brief\r\n[APROVADO]\r\nTexto   ok\n[FALA] fala\n';
    expect(withoutWithheldText(t)).toBe(t);
  });

  it('tira o BLOCO de [INTERNO] e [NÃO EXIBIR] (multilinha e na mesma linha da marca) e deixa o resto', () => {
    const out = withoutWithheldText(`Faça uma apresentação.\n\n${colado}`);
    expect(out).not.toContain('VALOR-DO-CONTRATO');
    expect(out).not.toContain('SEGUNDA-LINHA');
    expect(out).not.toContain('SEGREDO-INLINE');
    expect(out).toContain('Faça uma apresentação.');
    expect(out).toContain('TITULO-APROVADO');
    expect(out).toContain('FALA-OK'); // fala e contexto são orientação, não ficam de fora do briefing
  });

  it('funciona com quebra de linha do Windows (CRLF) e preserva o CRLF do que fica', () => {
    const crlfText = colado.replace(/\n/g, '\r\n');
    const out = withoutWithheldText(crlfText);
    expect(out).not.toContain('VALOR-DO-CONTRATO');
    expect(out).not.toContain('SEGUNDA-LINHA');
    expect(out).toContain('TITULO-APROVADO\r\n');
  });

  it('remove o bloco, e não o trecho: um trecho curto igual ao interno, em outro lugar, fica', () => {
    const src = 'Texto ok e nada mais\n[APROVADO]\nTítulo ok\n[INTERNO]\nok';
    const out = withoutWithheldText(src);
    expect(out).toBe('Texto ok e nada mais\n[APROVADO]\nTítulo ok');
  });

  it('o mesmo texto do bloco interno, repetido em OUTRO bloco, só sai do bloco marcado', () => {
    const src = '[APROVADO]\nPreço de lançamento\n[INTERNO]\nPreço de lançamento';
    expect(withoutWithheldText(src)).toBe('[APROVADO]\nPreço de lançamento');
  });

  it('o bloco termina no separador entre mensagens: o pedido seguinte da pessoa não é engolido', () => {
    const src = `[INTERNO]\nSEGREDO-AQUI\n\n${BRIEF_MESSAGE_SEPARATOR}\nTroque a cor do fundo`;
    const out = withoutWithheldText(src);
    expect(out).not.toContain('SEGREDO-AQUI');
    expect(out).toContain('Troque a cor do fundo');
    expect(out).toContain(BRIEF_MESSAGE_SEPARATOR);
  });

  it('é idempotente', () => {
    const uma = withoutWithheldText(colado);
    expect(withoutWithheldText(uma)).toBe(uma);
  });
});

describe('briefForBrain (ponto único da limpeza do briefing)', () => {
  const bruto = '[APROVADO]\nTITULO\n[INTERNO]\nSEGREDO';

  it('com o cérebro global ligado limpa, com ou sem ficha (a regra não olha a ficha)', () => {
    expect(briefForBrain(bruto, true)).not.toContain('SEGREDO');
  });

  it('na saída de emergência devolve o briefing exatamente como veio', () => {
    expect(briefForBrain(bruto, false)).toBe(bruto);
  });
});
