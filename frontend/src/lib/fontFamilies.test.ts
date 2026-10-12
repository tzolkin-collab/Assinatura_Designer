import { describe, it, expect } from 'vitest';
import { fontFaceCss, googleFontHrefs, normalizeFontFamilies, parseFontRefs, remoteFontHrefs } from './fontFamilies';

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

describe('fonte própria', () => {
  const q = { family: 'Queens', assetId: 'asset-queens', format: 'opentype' as const };

  it('parseFontRefs descarta lixo', () => {
    expect(parseFontRefs([q, { family: 3 }, { ...q, format: 'exe' }, { ...q, assetId: '../x' }, null])).toEqual([q]);
    expect(parseFontRefs(undefined)).toEqual([]);
  });
  it('fontFaceCss aponta para a rota pública da API e limpa o nome', () => {
    const css = fontFaceCss([q, { ...q, family: 'A";}x' }], 'http://api/api');
    expect(css).toContain('@font-face{font-family:"Queens";src:url("http://api/api/public/fonts/asset-queens") format("opentype")');
    expect(css).toContain('font-family:"Ax"');
  });
  it('a família com arquivo próprio não vai ao Google; as outras continuam indo', () => {
    const hrefs = remoteFontHrefs(['Queens', 'Inter'], [q]);
    expect(hrefs).toHaveLength(1);
    expect(hrefs[0]).toContain('family=Inter');
    expect(remoteFontHrefs(['Queens'], [q])).toEqual([]);
    expect(remoteFontHrefs(['Playfair Display'], [])[0]).toContain('Playfair+Display');
  });
});
