import { describe, it, expect } from 'vitest';
import { acceptancePassed, evaluateRealPhotoRun, type RunEvidence } from '../lib/designerBrain/photoAcceptance.js';

const FOTO = 'https://r2.example/brands/b1/amanda-01.jpg';
const LOGO = 'https://r2.example/brands/b1/logo.png';
const img = (src: string, style = '') => `<img src="${src}" style="${style}">`;

const ev = (over: Partial<RunEvidence> = {}): RunEvidence => ({
  slides: [{ html: `<div data-photo-slot="1">${img(FOTO, 'object-fit:cover;object-position:50% 18%')}</div>${img(LOGO)}` }],
  photos: [{ url: FOTO, name: 'foto' }],
  libraryUrls: new Set([FOTO, LOGO]),
  generatedAssets: 0,
  ...over,
});
const by = (r: ReturnType<typeof evaluateRealPhotoRun>, id: string) => r.find((x) => x.id === id)!;

describe('Teste 2 (§14): slide com foto real', () => {
  it('caso bom: usa a foto, nada de IA, nada de fora, enquadrada: passa', () => {
    const r = evaluateRealPhotoRun(ev());
    expect(acceptancePassed(r)).toBe(true);
    expect(r.filter((x) => x.status === 'fail')).toEqual([]);
    expect(by(r, 'usa-foto-real').status).toBe('pass');
    expect(by(r, 'enquadramento').status).toBe('pass');
  });

  it('sem fotos na biblioteca: o teste nem pode rodar', () => {
    const r = evaluateRealPhotoRun(ev({ photos: [] }));
    expect(by(r, 'ha-fotos').status).toBe('fail');
    expect(acceptancePassed(r)).toBe(false);
  });

  it('nenhum slide usa a foto fornecida: falha', () => {
    const r = evaluateRealPhotoRun(ev({ slides: [{ html: img(LOGO) }] }));
    expect(by(r, 'usa-foto-real').status).toBe('fail');
    expect(acceptancePassed(r)).toBe(false);
  });

  it('qualquer arquivo gerado pelo sistema nesta execução reprova (a regra é absoluta)', () => {
    const r = evaluateRealPhotoRun(ev({ generatedAssets: 1 }));
    expect(by(r, 'sem-ia').status).toBe('fail');
    expect(acceptancePassed(r)).toBe(false);
  });

  it('imagem de fora da biblioteca (stock, URL inventada) reprova', () => {
    const r = evaluateRealPhotoRun(ev({ slides: [{ html: img(FOTO) + img('https://images.unsplash.com/photo-1') }] }));
    expect(by(r, 'sem-intrusa').status).toBe('fail');
    expect(by(r, 'sem-intrusa').detail).toContain('unsplash');
  });

  it('P&B e ajuste de luz são tratamento permitido; filtro de cor e espelhamento viram alerta', () => {
    const pb = evaluateRealPhotoRun(ev({ slides: [{ html: img(FOTO, 'object-position:50% 20%;filter:grayscale(1) contrast(1.1)') }] }));
    expect(by(pb, 'foto-intacta').status).toBe('pass');
    const cor = evaluateRealPhotoRun(ev({ slides: [{ html: img(FOTO, 'object-position:50% 20%;filter:hue-rotate(90deg)') }] }));
    expect(by(cor, 'foto-intacta').status).toBe('warn');
    const espelho = evaluateRealPhotoRun(ev({ slides: [{ html: img(FOTO, 'object-position:50% 20%;transform:scaleX(-1)') }] }));
    expect(by(espelho, 'foto-intacta').status).toBe('warn');
  });

  it('foto centralizada (sem enquadramento) vira alerta, não falha', () => {
    const r = evaluateRealPhotoRun(ev({ slides: [{ html: img(FOTO, 'object-fit:cover') }] }));
    expect(by(r, 'enquadramento').status).toBe('warn');
    expect(acceptancePassed(r)).toBe(true);
  });

  it('o que só um olho humano julga fica marcado como manual, nunca como passou', () => {
    const r = evaluateRealPhotoRun(ev());
    expect(by(r, 'rosto-sem-texto').status).toBe('manual');
  });
});
