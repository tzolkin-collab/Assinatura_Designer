import { describe, it, expect } from 'vitest';
import { parseDispatchTag, stripDispatchTag } from '../lib/dispatchTag';

describe('parseDispatchTag', () => {
  it('sem tag, devolve null', () => {
    expect(parseDispatchTag('Só bati um papo, sem disparar nada.')).toBeNull();
  });

  it('[DISPATCH:presentation] simples', () => {
    expect(parseDispatchTag('Combinado! [DISPATCH:presentation]')).toEqual({
      format: 'presentation',
      isProof: false,
      aspectRatio: undefined,
    });
  });

  it('[DISPATCH:carousel] simples — sem proporção pedida, aspectRatio fica undefined (o pipeline decide o default 1:1)', () => {
    expect(parseDispatchTag('Vou gerar. [DISPATCH:carousel]')).toEqual({
      format: 'carousel',
      isProof: false,
      aspectRatio: undefined,
    });
  });

  it('[DISPATCH:presentation:proof] marca isProof', () => {
    const r = parseDispatchTag('[DISPATCH:presentation:proof]');
    expect(r?.isProof).toBe(true);
    expect(r?.aspectRatio).toBeUndefined();
  });

  it('[DISPATCH:carousel:9x16] extrai a proporção retrato — regressão do bug "todo Design nasce quadrado"', () => {
    expect(parseDispatchTag('Story vertical! [DISPATCH:carousel:9x16]')).toEqual({
      format: 'carousel',
      isProof: false,
      aspectRatio: '9:16',
    });
  });

  it('reconhece todas as proporções suportadas', () => {
    expect(parseDispatchTag('[DISPATCH:carousel:4x5]')?.aspectRatio).toBe('4:5');
    expect(parseDispatchTag('[DISPATCH:carousel:3x4]')?.aspectRatio).toBe('3:4');
    expect(parseDispatchTag('[DISPATCH:carousel:1x1]')?.aspectRatio).toBe('1:1');
    expect(parseDispatchTag('[DISPATCH:carousel:16x9]')?.aspectRatio).toBe('16:9');
  });

  it('token de terceiro segmento fora da lista suportada: a tag inteira não bate (fail-safe — nunca despacha com dado inválido)', () => {
    expect(parseDispatchTag('[DISPATCH:carousel:9x99]')).toBeNull();
  });
});

describe('stripDispatchTag', () => {
  it('remove a tag do texto exibido ao usuário, preservando o resto', () => {
    expect(stripDispatchTag('Perfeito, já vou gerar. [DISPATCH:carousel:9x16]')).toBe('Perfeito, já vou gerar. ');
  });

  it('sem tag, devolve o texto intacto', () => {
    expect(stripDispatchTag('Texto normal sem tag nenhuma.')).toBe('Texto normal sem tag nenhuma.');
  });
});
