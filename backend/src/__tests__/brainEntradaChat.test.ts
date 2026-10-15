import { describe, it, expect } from 'vitest';
import { dropStrayTagFragments, isPastedCopy } from '../agents/brain/entradaChat';

const BLOCO = 'Antes de qualquer plano, existe uma pergunta: o que realmente vale a pena construir? Quando a resposta é clara, o caminho deixa de ser ruído.';

describe('isPastedCopy', () => {
  it('mensagem curta de pedido não é copy', () => {
    expect(isPastedCopy('Crie uma apresentação de 5 slides sobre estratégia.')).toBe(false);
  });

  it('mensagem longa (1200+) continua sendo copy', () => {
    expect(isPastedCopy('a'.repeat(1200))).toBe(true);
  });

  it('briefing estruturado de ~1.000 caracteres, com 3+ blocos, é copy (caso do teste real)', () => {
    const titulo = 'Todo resultado começa em uma decisão';
    const msg = [
      'Crie uma apresentação de 5 slides com o texto aprovado abaixo.',
      `${titulo}\n${BLOCO}`,
      `Crescer sem direção cansa\n${BLOCO}`,
      `Três movimentos para ganhar clareza\n${BLOCO}`,
    ].join('\n\n');
    expect(msg.length).toBeGreaterThan(500);
    expect(msg.length).toBeLessThan(1200);
    expect(isPastedCopy(msg)).toBe(true);
  });

  it('texto médio sem estrutura (um parágrafo só) não vira copy', () => {
    expect(isPastedCopy(`${BLOCO} `.repeat(4))).toBe(false);
  });

  it('aceita quebra de linha do Windows entre os blocos', () => {
    const msg = [`A\r\n${BLOCO}`, `B\r\n${BLOCO}`, `C\r\n${BLOCO}`, `D\r\n${BLOCO}`].join('\r\n\r\n');
    expect(msg.length).toBeGreaterThan(500);
    expect(isPastedCopy(msg)).toBe(true);
  });
});

describe('dropStrayTagFragments', () => {
  it('tira a linha com fragmento de tag que sobrou', () => {
    expect(dropStrayTagFragments('Combinado. Já estou gerando.\n\n}]')).toBe('Combinado. Já estou gerando.');
    expect(dropStrayTagFragments('Já estou gerando.\n\n}}')).toBe('Já estou gerando.');
  });

  it('não mexe em texto normal nem em colchetes dentro da frase', () => {
    const texto = 'Use o slide [1] e depois o {2}.\nSegunda linha.';
    expect(dropStrayTagFragments(texto)).toBe(texto);
  });

  it('texto vazio continua vazio', () => {
    expect(dropStrayTagFragments('')).toBe('');
  });
});
