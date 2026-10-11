import { describe, expect, it } from 'vitest';
import { brainTextRule } from '../lib/htmlDesign.js';

describe('brainTextRule', () => {
  it('sem logo, proíbe digitar o nome da marca no lugar dele', () => {
    const r = brainTextRule(false);
    expect(r).toContain('NENHUM logo foi fornecido');
    expect(r).toContain('NÃO digite o nome da marca');
  });
  it('com logo, o logo é a imagem e não o nome digitado', () => {
    const r = brainTextRule(true);
    expect(r).toContain('é a imagem fornecida');
    expect(r).not.toContain('NENHUM logo');
  });
  it('proíbe numeração e rótulos inventados nos dois casos', () => {
    for (const has of [true, false]) {
      expect(brainTextRule(has)).toContain('NUNCA invente numeração');
    }
  });
});
