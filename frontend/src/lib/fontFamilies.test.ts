import { describe, it, expect } from 'vitest';
import { googleFontHrefs, normalizeFontFamilies } from './fontFamilies';

describe('normalizeFontFamilies', () => {
  it('tira a especificação de pesos do nome da família', () => {
    expect(normalizeFontFamilies(['Playfair Display:ital,wght@0,400;1,400', 'Manrope:wght@400'])).toEqual(['Playfair Display', 'Manrope']);
  });
  it('remove aspas e repetidos, descarta lixo e limita a 4', () => {
    expect(normalizeFontFamilies(["'Inter'", 'inter:wght@400', 'x;y', 7, 'A', 'B', 'C', 'D'])).toEqual(['Inter', 'A', 'B', 'C']);
  });
  it('entrada que não é lista vira vazia', () => {
    expect(normalizeFontFamilies(undefined)).toEqual([]);
  });
});

describe('googleFontHrefs', () => {
  it('um link por família', () => {
    const hrefs = googleFontHrefs(['Queens', 'Playfair Display']);
    expect(hrefs).toHaveLength(2);
    expect(hrefs[1]).toContain('family=Playfair+Display:wght@');
  });
  it('sem fonte válida, Inter', () => {
    expect(googleFontHrefs(['<x>'])[0]).toContain('family=Inter');
  });
});
