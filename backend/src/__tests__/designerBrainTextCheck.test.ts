import { describe, it, expect } from 'vitest';
import {
  checkApprovedText,
  hasApprovedText,
  textIssuesToDeviations,
  tokenize,
  visibleText,
} from '../lib/designerBrain/textCheck';

describe('visibleText', () => {
  it('ignora estilo, script e título de SVG, e separa elementos vizinhos', () => {
    const html = '<style>.a{color:red}</style><h1>Estratégia</h1><p>para uma vida</p><svg><title>ícone</title></svg><script>x()</script>';
    expect(visibleText(html)).toBe('Estratégia para uma vida');
  });
});

describe('tokenize', () => {
  it('mantém acentos, valores e porcentagens inteiros e ignora pontuação solta', () => {
    expect(tokenize('Investimento: R$ 1.500,00 — condições à vista (30%).')).toEqual(
      ['investimento', 'r$', '1.500,00', 'condições', 'à', 'vista', '30%'],
    );
  });
});

describe('checkApprovedText', () => {
  const APROVADO = 'Estratégia para uma vida mais extraordinária';

  it('texto idêntico: nenhum problema', () => {
    expect(checkApprovedText([APROVADO], [`<h1>${APROVADO}</h1>`])).toEqual([]);
  });

  it('quebrar o texto em vários elementos e mudar a ordem visual é permitido', () => {
    const html = '<h1>extraordinária</h1><small>para uma vida mais</small><h2>Estratégia</h2>';
    expect(checkApprovedText([APROVADO], [html])).toEqual([]);
  });

  it('maiúscula e minúscula não contam (o artista pode usar caixa alta no título)', () => {
    expect(checkApprovedText([APROVADO], ['<h1>ESTRATÉGIA PARA UMA VIDA MAIS EXTRAORDINÁRIA</h1>'])).toEqual([]);
  });

  it('acento conta: trocar "Estratégia" por "Estrategia" é erro', () => {
    const [issue] = checkApprovedText([APROVADO], ['<h1>Estrategia para uma vida mais extraordinária</h1>']);
    expect(issue!.missing).toEqual(['estratégia']);
    expect(issue!.extra).toEqual(['estrategia']);
  });

  it('palavra omitida aparece em "missing"', () => {
    const [issue] = checkApprovedText([APROVADO], ['<h1>Estratégia para uma vida extraordinária</h1>']);
    expect(issue).toMatchObject({ slideIndex: 0, missing: ['mais'], extra: [] });
  });

  it('texto inventado aparece em "extra"', () => {
    const [issue] = checkApprovedText([APROVADO], [`<h1>${APROVADO}</h1><p>Anos de vivência como empresária</p>`]);
    expect(issue!.missing).toEqual([]);
    expect(issue!.extra).toEqual(['anos', 'de', 'vivência', 'como', 'empresária']);
  });

  it('respeita repetição: palavra que aparece duas vezes no aprovado e uma no slide falta uma vez', () => {
    const [issue] = checkApprovedText(['mais e mais'], ['<p>mais e</p>']);
    expect(issue!.missing).toEqual(['mais']);
  });

  it('slide sem texto aprovado: tudo o que ele mostra é texto a mais', () => {
    const [issue] = checkApprovedText([undefined], ['<h1>Obrigado</h1>']);
    expect(issue).toMatchObject({ missing: [], extra: ['obrigado'] });
  });

  it('só devolve os slides com problema, com o índice real (retomada após a amostra de estilo)', () => {
    const issues = checkApprovedText(['ok', 'certo'], ['<p>ok</p>', '<p>errado</p>'], 1);
    expect(issues.map((i) => i.slideIndex)).toEqual([2]);
  });

  it('valores monetários batem inteiros', () => {
    expect(checkApprovedText(['R$ 1.500,00'], ['<b>R$</b> <b>1.500,00</b>'])).toEqual([]);
    expect(checkApprovedText(['R$ 1.500,00'], ['<b>R$ 1.800,00</b>'])[0]!.missing).toEqual(['1.500,00']);
  });
});

describe('hasApprovedText', () => {
  it('copy oficial conta', () => {
    expect(hasApprovedText({ sourceCopy: 'texto' })).toBe(true);
  });
  it('roteiro aprovado com copy em algum slide conta', () => {
    expect(hasApprovedText({ approvedSkeleton: [{}, { copy: 'texto' }] })).toBe(true);
  });
  it('vazio, só espaços ou roteiro sem copy não contam', () => {
    expect(hasApprovedText({})).toBe(false);
    expect(hasApprovedText({ sourceCopy: '   ' })).toBe(false);
    expect(hasApprovedText({ approvedSkeleton: [{ copy: '' }, {}] })).toBe(false);
  });
});

describe('textIssuesToDeviations', () => {
  it('falta é crítica e sobra é grave, no formato do reviewer', () => {
    const devs = textIssuesToDeviations([{ slideIndex: 2, missing: ['mais'], extra: ['impérios'] }]);
    expect(devs).toHaveLength(2);
    expect(devs[0]).toMatchObject({ type: 'content', severity: 'critical', slideIndex: 2 });
    expect(devs[0]!.description).toContain('"mais"');
    expect(devs[1]).toMatchObject({ severity: 'major' });
    expect(devs[1]!.fix).toContain('inventados');
  });
});
