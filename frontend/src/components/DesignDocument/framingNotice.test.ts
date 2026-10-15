import { describe, it, expect } from 'vitest';
import { framingNotice } from './PhotoSlotsPanel';

describe('framingNotice', () => {
  it('enquadramento automático com o rosto inteiro: avisa que foi pelo assunto', () => {
    expect(framingNotice({ mode: 'auto', faceVisible: 1 })).toContain('assunto principal');
    expect(framingNotice({ mode: 'auto', faceVisible: null })).toContain('assunto principal');
  });
  it('rosto que não cabe no espaço: diz isso, em vez de fingir que deu certo', () => {
    expect(framingNotice({ mode: 'auto', faceVisible: 0.6 })).toContain('estreito demais');
  });
  it('não achou o assunto: avisa que ficou centralizada', () => {
    expect(framingNotice({ mode: 'center' })).toContain('centralizada');
  });
  it('escolha da pessoa, mesma foto ou resposta sem o campo: não diz nada', () => {
    expect(framingNotice({ mode: 'manual' })).toBeNull();
    expect(framingNotice({ mode: 'kept' })).toBeNull();
    expect(framingNotice(undefined)).toBeNull();
  });
});
