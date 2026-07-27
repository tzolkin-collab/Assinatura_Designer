import { describe, it, expect } from 'vitest';
import { resolveCanvasSize } from '../agents/pipeline';

describe('resolveCanvasSize', () => {
  it('apresentação sempre 16:9, ignorando qualquer aspectRatio pedido', () => {
    expect(resolveCanvasSize('presentation')).toEqual({ width: 1920, height: 1080 });
    expect(resolveCanvasSize('presentation', '9:16')).toEqual({ width: 1920, height: 1080 });
  });

  it('design sem aspectRatio: mantém o padrão quadrado 1:1 (comportamento antigo preservado)', () => {
    expect(resolveCanvasSize('carousel')).toEqual({ width: 1080, height: 1080 });
  });

  it('design com aspectRatio: gera retrato de verdade — regressão do bug "todo Design nasce quadrado"', () => {
    expect(resolveCanvasSize('carousel', '9:16')).toEqual({ width: 1080, height: 1920 });
    expect(resolveCanvasSize('carousel', '4:5')).toEqual({ width: 1080, height: 1350 });
    expect(resolveCanvasSize('carousel', '3:4')).toEqual({ width: 1080, height: 1440 });
    expect(resolveCanvasSize('carousel', '16:9')).toEqual({ width: 1920, height: 1080 });
  });

  it('aspectRatio desconhecido cai pro padrão 1:1 em vez de quebrar', () => {
    expect(resolveCanvasSize('carousel', 'algo-invalido')).toEqual({ width: 1080, height: 1080 });
  });
});
