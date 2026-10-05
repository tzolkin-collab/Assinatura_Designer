import { describe, it, expect } from 'vitest';
import { buildSlideDocument, googleFontHrefs, normalizeFontFamilies, validateHtmlDesign } from '../lib/htmlDesign';

describe('normalizeFontFamilies', () => {
  it('tira a especificação de pesos que o modelo costuma anexar ao nome', () => {
    // Era o que fazia o slide sair em Times/Arial: o nome inteiro era descartado.
    expect(normalizeFontFamilies(['Playfair Display:ital,wght@0,400;0,600;1,400', 'Manrope:wght@300;400;700']))
      .toEqual(['Playfair Display', 'Manrope']);
  });

  it('mantém nomes simples como estão', () => {
    expect(normalizeFontFamilies(['Inter', 'DM Sans', 'Source Sans 3'])).toEqual(['Inter', 'DM Sans', 'Source Sans 3']);
  });

  it('remove aspas, espaços sobrando e repetidos (sem diferenciar maiúsculas)', () => {
    expect(normalizeFontFamilies(["'Playfair  Display'", 'playfair display:wght@400', '"Inter"'])).toEqual(['Playfair Display', 'Inter']);
  });

  it('descarta o que não é um nome de família e o que não é texto', () => {
    expect(normalizeFontFamilies(['', '   ', 'Inter; color:red', '<script>', 42, null, 'Lora'])).toEqual(['Lora']);
  });

  it('no máximo 4 famílias', () => {
    expect(normalizeFontFamilies(['A', 'B', 'C', 'D', 'E'])).toEqual(['A', 'B', 'C', 'D']);
  });

  it('entrada que não é lista vira lista vazia', () => {
    expect(normalizeFontFamilies(undefined)).toEqual([]);
    expect(normalizeFontFamilies('Inter')).toEqual([]);
  });
});

describe('googleFontHrefs', () => {
  it('um endereço por família, para uma desconhecida não derrubar as outras', () => {
    const hrefs = googleFontHrefs(['Queens', 'Playfair Display', 'Manrope']);
    expect(hrefs).toHaveLength(3);
    expect(hrefs[1]).toContain('family=Playfair+Display:wght@');
    for (const h of hrefs) expect((h.match(/family=/g) ?? []).length).toBe(1);
  });

  it('sem nenhuma fonte válida, cai em Inter', () => {
    expect(googleFontHrefs([])).toHaveLength(1);
    expect(googleFontHrefs([])[0]).toContain('family=Inter');
    expect(googleFontHrefs(['<x>'])[0]).toContain('family=Inter');
  });
});

describe('buildSlideDocument', () => {
  it('carrega cada fonte pedida, mesmo quando o nome veio com os pesos', () => {
    const doc = buildSlideDocument({ html: '<p>oi</p>' }, ['Playfair Display:ital,wght@0,400;1,400', 'Manrope'], 1920, 1080);
    expect(doc).toContain('family=Playfair+Display:wght@');
    expect(doc).toContain('family=Manrope:wght@');
    expect(doc).not.toContain('ital,wght@0,400;1,400'); // a especificação do modelo não vaza para o link
  });
});

describe('validateHtmlDesign', () => {
  it('guarda as fontes já limpas no design', () => {
    const out = validateHtmlDesign(
      { fonts: ['Playfair Display:ital,wght@0,400', 'Manrope:wght@400'], slides: [{ html: '<p>a</p>' }] },
      { width: 1920, height: 1080, format: 'presentation' },
    );
    expect(out.fonts).toEqual(['Playfair Display', 'Manrope']);
  });

  it('sem fontes utilizáveis, usa Inter', () => {
    const out = validateHtmlDesign({ fonts: [';;;'], slides: [{ html: '<p>a</p>' }] }, { width: 1080, height: 1080, format: 'carousel' });
    expect(out.fonts).toEqual(['Inter']);
  });
});
