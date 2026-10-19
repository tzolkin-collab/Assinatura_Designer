import { describe, expect, it } from 'vitest';
import { insertStatusMarker, summarizeStatuses } from './textStatus';

describe('summarizeStatuses', () => {
  it('texto sem marca é um bloco aprovado e nada fica de fora', () => {
    const s = summarizeStatuses('Título\nCorpo');
    expect(s.hasMarkers).toBe(false);
    expect(s.counts).toEqual({ APROVADO: 1 });
    expect(s.outOfArt).toBe(0);
  });

  it('separa os blocos como o backend: fala e contexto ficam fora da arte', () => {
    const s = summarizeStatuses('Título\n[FALA]\nGravar devagar\n[contexto] cliente pediu tom sério\n[Em revisão]\nTexto novo');
    expect(s.hasMarkers).toBe(true);
    expect(s.counts).toEqual({ APROVADO: 1, FALA: 1, CONTEXTO: 1, 'EM REVISÃO': 1 });
    expect(s.outOfArt).toBe(2);
    expect(s.inReview).toBe(true);
  });

  it('aceita as variantes sem acento e "mostrar"; colchete desconhecido é texto comum', () => {
    expect(summarizeStatuses('[NAO MOSTRAR]\nx').counts).toEqual({ 'NÃO EXIBIR': 1 });
    expect(summarizeStatuses('[em revisao]\nx').inReview).toBe(true);
    const s = summarizeStatuses('[Nota] algo');
    expect(s.hasMarkers).toBe(false);
    expect(s.counts).toEqual({ APROVADO: 1 });
  });

  it('bloco vazio não conta', () => {
    expect(summarizeStatuses('[FALA]\n\n[APOIO]\nx').counts).toEqual({ APOIO: 1 });
  });
});

describe('insertStatusMarker', () => {
  it('sem seleção, abre um bloco na linha do cursor', () => {
    const r = insertStatusMarker('Título', 6, 6, 'FALA');
    expect(r.text).toBe('Título\n[FALA]\n');
    expect(r.caret).toBe(r.text.length);
  });

  it('no começo do texto não põe linha em branco antes', () => {
    expect(insertStatusMarker('abc', 0, 0, 'APOIO').text).toBe('[APOIO]\nabc');
  });

  it('com seleção, marca só o trecho e devolve o resto a aprovado', () => {
    const t = 'Título\nroteiro de fala\nFecho';
    const start = t.indexOf('roteiro');
    const end = start + 'roteiro de fala'.length;
    const r = insertStatusMarker(t, start, end, 'FALA');
    expect(r.text).toBe('Título\n[FALA]\nroteiro de fala\n[APROVADO]\nFecho');
    expect(summarizeStatuses(r.text).counts).toEqual({ APROVADO: 2, FALA: 1 });
  });

  it('se o resto já abre com outra marca, não insere [APROVADO] à toa', () => {
    const t = 'Título\n[FALA]\nroteiro';
    const r = insertStatusMarker(t, 0, 6, 'CONTEXTO');
    expect(r.text).toBe('[CONTEXTO]\nTítulo\n[FALA]\nroteiro');
  });

  it('com seleção no fim, não acrescenta marca de aprovado', () => {
    const r = insertStatusMarker('Título\nfala', 7, 11, 'FALA');
    expect(r.text).toBe('Título\n[FALA]\nfala');
  });

  it('marcar como aprovado não reabre o bloco seguinte', () => {
    const r = insertStatusMarker('a\nb', 2, 3, 'APROVADO');
    expect(r.text).toBe('a\n[APROVADO]\nb');
  });

  it('posições fora do texto são aparadas', () => {
    expect(insertStatusMarker('ab', 50, 90, 'INTERNO').text).toBe('ab\n[INTERNO]\n');
  });
});
