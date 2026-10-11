import { describe, expect, it } from 'vitest';
import { deriveDeckName } from '../lib/deckName.js';

describe('deriveDeckName', () => {
  it('usa a primeira linha do texto da capa', () => {
    expect(deriveDeckName([{ title: 'Capa', copy: 'Pensar é um ato livre\nde coragem' }])).toBe('Pensar é um ato livre');
  });
  it('sem texto na capa, usa o título do planner', () => {
    expect(deriveDeckName([{ title: 'Estratégia para 2027' }])).toBe('Estratégia para 2027');
  });
  it('rótulo genérico não vira nome', () => {
    expect(deriveDeckName([{ title: 'Capa' }])).toBeNull();
    expect(deriveDeckName([{ title: 'Slide 1', copy: '   ' }])).toBeNull();
  });
  it('limpa aspas e pontuação nas pontas', () => {
    expect(deriveDeckName([{ copy: '“Olá, mundo.”' }])).toBe('Olá, mundo');
  });
  it('corta nome longo em palavra inteira', () => {
    const n = deriveDeckName([{ copy: 'palavra '.repeat(30) }])!;
    expect(n.length).toBeLessThanOrEqual(81);
    expect(n.endsWith('…')).toBe(true);
  });
  it('sem esqueleto, não inventa', () => {
    expect(deriveDeckName([])).toBeNull();
  });
});
