import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import sharp from 'sharp';
import {
  coverVisible,
  detectSubjectFocus,
  framePosition,
  parseSubjectResponse,
  slotAspectFromStyle,
  visibleFraction,
  type SubjectFocus,
} from '../lib/photoFocus.js';
import { analyzePhoto, clearFramingCache, frameFromAnalysis, measureSlotAspect } from '../lib/photoFraming.js';
import { photoSlotAspect } from '../lib/photoSlot.js';

const CENTER = { x: 50, y: 50 };

// Retrato em pé (3:4), rosto no terço de cima: o caso que o centro corta.
const retrato: SubjectFocus = {
  subject: { x0: 0.2, y0: 0.05, x1: 0.8, y1: 1 },
  face: { x0: 0.35, y0: 0.08, x1: 0.65, y1: 0.28 },
};

describe('geometria do cover', () => {
  it('espaço mais largo que a foto perde topo e base; mais alto perde as laterais', () => {
    expect(coverVisible(3 / 4, 16 / 9)).toEqual({ vx: 1, vy: expect.closeTo(0.421875, 5) });
    expect(coverVisible(16 / 9, 3 / 4)).toEqual({ vx: expect.closeTo(0.421875, 5), vy: 1 });
    expect(coverVisible(1, 1)).toEqual({ vx: 1, vy: 1 });
  });

  it('proporção inválida não quebra: nada é cortado', () => {
    expect(coverVisible(0, 1)).toEqual({ vx: 1, vy: 1 });
    expect(coverVisible(1, NaN)).toEqual({ vx: 1, vy: 1 });
  });

  it('fração visível: caixa inteira dentro da janela = 1; fora = 0', () => {
    // foto 3:4 num espaço 16:9: só 42% da altura aparece; no centro (y 50%) a janela vai de 0.29 a 0.71.
    expect(visibleFraction(retrato.face!, 3 / 4, 16 / 9, CENTER)).toBeLessThan(0.1); // o rosto (0.08–0.28) fica FORA
    expect(visibleFraction({ x0: 0, y0: 0.4, x1: 1, y1: 0.6 }, 3 / 4, 16 / 9, CENTER)).toBe(1);
  });
});

describe('framePosition: manter o assunto no espaço', () => {
  it('retrato com rosto no alto, espaço paisagem: sobe a janela e o rosto fica inteiro', () => {
    const pos = framePosition(retrato, 3 / 4, 16 / 9);
    expect(pos.x).toBe(50); // eixo sem corte não se mexe
    expect(pos.y).toBeLessThan(25);
    expect(visibleFraction(retrato.face!, 3 / 4, 16 / 9, pos)).toBe(1);
    expect(visibleFraction(retrato.face!, 3 / 4, 16 / 9, CENTER)).toBeLessThan(0.1); // e o centro perdia o rosto
  });

  it('foto larga com a pessoa à direita, espaço em pé: desloca para a direita', () => {
    const lateral: SubjectFocus = { subject: { x0: 0.6, y0: 0.1, x1: 0.8, y1: 1 }, face: { x0: 0.64, y0: 0.12, x1: 0.76, y1: 0.3 } };
    const pos = framePosition(lateral, 16 / 9, 9 / 16);
    expect(pos.y).toBe(50);
    expect(pos.x).toBeGreaterThan(55);
    expect(visibleFraction(lateral.face!, 16 / 9, 9 / 16, pos)).toBe(1);
    expect(visibleFraction(lateral.face!, 16 / 9, 9 / 16, CENTER)).toBeLessThan(1);
  });

  it('sem rosto: enquadra o assunto', () => {
    const objeto: SubjectFocus = { subject: { x0: 0.05, y0: 0.5, x1: 0.35, y1: 0.95 }, face: null };
    const pos = framePosition(objeto, 16 / 9, 1);
    expect(pos.x).toBeLessThan(20);
    expect(visibleFraction(objeto.subject, 16 / 9, 1, pos)).toBe(1);
  });

  it('proporção igual: não há o que decidir, fica no centro', () => {
    expect(framePosition(retrato, 3 / 4, 3 / 4)).toEqual({ x: 50, y: 50 });
  });

  it('nunca devolve posição fora de 0 a 100', () => {
    const canto: SubjectFocus = { subject: { x0: 0, y0: 0, x1: 0.1, y1: 0.1 }, face: null };
    for (const [ia, sa] of [[3 / 4, 3], [4, 1 / 3], [1, 2]] as const) {
      const p = framePosition(canto, ia, sa);
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(100);
    }
  });

  it('quando o rosto não cabe no espaço (faixa fina), escolhe a melhor janela em vez de desistir', () => {
    const pos = framePosition(retrato, 3 / 4, 3); // faixa 3:1: só 25% da altura aparece
    expect(visibleFraction(retrato.face!, 3 / 4, 3, pos)).toBeGreaterThan(visibleFraction(retrato.face!, 3 / 4, 3, CENTER));
  });
});

describe('slotAspectFromStyle', () => {
  it('lê largura e altura em px', () => {
    expect(slotAspectFromStyle('position:absolute;width:770px;height:1010px;')).toBeCloseTo(770 / 1010, 5);
  });
  it('sem px (%, auto, vazio): null', () => {
    expect(slotAspectFromStyle('width:50%;height:100%')).toBeNull();
    expect(slotAspectFromStyle('')).toBeNull();
    expect(slotAspectFromStyle(null)).toBeNull();
  });
  it('não confunde min-width/max-height com width/height', () => {
    expect(slotAspectFromStyle('min-width:100px;max-height:200px')).toBeNull();
  });
  it('photoSlotAspect lê do espaço certo do HTML', () => {
    const html = '<div data-photo-slot="1" style="width:100px;height:200px"></div><div data-photo-slot="2" style="width:300px;height:100px"></div>';
    expect(photoSlotAspect(html, '2')).toBe(3);
    expect(photoSlotAspect(html, '9')).toBeNull();
  });
});

describe('parseSubjectResponse', () => {
  it('converte box_2d [ymin,xmin,ymax,xmax] de 0-1000 em fração', () => {
    const r = parseSubjectResponse('{"subject":{"box_2d":[100,200,900,800]},"face":{"box_2d":[150,300,400,700]}}');
    expect(r?.subject).toEqual({ x0: 0.2, y0: 0.1, x1: 0.8, y1: 0.9 });
    expect(r?.face).toEqual({ x0: 0.3, y0: 0.15, x1: 0.7, y1: 0.4 });
  });
  it('aceita cerca de markdown', () => {
    expect(parseSubjectResponse('```json\n{"subject":{"box_2d":[0,0,1000,1000]},"face":null}\n```')?.face).toBeNull();
  });
  it('rosto fora do assunto é incoerente: ignora o rosto, mantém o assunto', () => {
    const r = parseSubjectResponse('{"subject":{"box_2d":[0,0,500,500]},"face":{"box_2d":[600,600,900,900]}}');
    expect(r?.subject).toBeDefined();
    expect(r?.face).toBeNull();
  });
  it('lixo, JSON cortado e caixa minúscula viram null (nunca um chute)', () => {
    expect(parseSubjectResponse('não sei')).toBeNull();
    expect(parseSubjectResponse('{"subject":{"box_2d":[0,0,1000,1000]},"face":{"box_2')).toBeNull(); // o MAX_TOKENS real
    expect(parseSubjectResponse('{"subject":{"box_2d":[0,0,5,5]}}')).toBeNull();
    expect(parseSubjectResponse('{"subject":{"box_2d":[1,2,3]}}')).toBeNull();
    expect(parseSubjectResponse('{"subject":null}')).toBeNull();
  });
  it('coordenadas fora de 0-1000 são limitadas', () => {
    expect(parseSubjectResponse('{"subject":{"box_2d":[-50,-50,1200,1200]}}')?.subject).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
  });
});

describe('detectSubjectFocus', () => {
  it('pede JSON, temperatura 0 e SEM raciocínio (com ele o JSON vinha cortado por MAX_TOKENS)', async () => {
    const generateContent = vi.fn(async () => ({ text: '{"subject":{"box_2d":[0,0,1000,1000]},"face":null}' }));
    const r = await detectSubjectFocus({ client: { models: { generateContent } }, base64: 'AAAA', mimeType: 'image/jpeg', model: 'm' });
    expect(r?.subject).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
    const cfg = (generateContent.mock.calls[0] as unknown as [{ config: Record<string, unknown> }])[0].config;
    expect(cfg).toMatchObject({ responseMimeType: 'application/json', temperature: 0, thinkingConfig: { thinkingBudget: 0 } });
  });
  it('erro do provedor vira null', async () => {
    const generateContent = vi.fn(async () => { throw new Error('503'); });
    expect(await detectSubjectFocus({ client: { models: { generateContent } }, base64: 'A', mimeType: 'image/jpeg', model: 'm' })).toBeNull();
  });
});

// Imagem 4x3 gerada na hora: o sharp precisa de bytes de verdade para ler as dimensões.
let PNG_4x3: Buffer;
beforeAll(async () => {
  PNG_4x3 = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#888888' } }).png().toBuffer();
});

describe('analyzePhoto / frameFromAnalysis', () => {
  beforeEach(() => clearFramingCache());

  it('baixa a foto, detecta uma vez e guarda em cache por URL', async () => {
    const generateContent = vi.fn(async () => ({ text: '{"subject":{"box_2d":[100,100,900,900]},"face":null}' }));
    const fetchImage = vi.fn(async () => PNG_4x3);
    const deps = { fetchImage, client: { models: { generateContent } }, model: 'm' };
    const a1 = await analyzePhoto('https://x/a.png', deps);
    const a2 = await analyzePhoto('https://x/a.png', deps);
    expect(a1?.aspect).toBeCloseTo(4 / 3, 5);
    expect(a2).toBe(a1);
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('download falhou ou detecção falhou: null (e nada é guardado em cache)', async () => {
    const falha = { fetchImage: vi.fn(async () => { throw new Error('HTTP 404'); }), client: { models: { generateContent: vi.fn() } } };
    expect(await analyzePhoto('https://x/b.png', falha)).toBeNull();
    const semAssunto = { fetchImage: async () => PNG_4x3, client: { models: { generateContent: vi.fn(async () => ({ text: 'ops' })) } } };
    expect(await analyzePhoto('https://x/c.png', semAssunto)).toBeNull();
    const ok = { fetchImage: async () => PNG_4x3, client: { models: { generateContent: vi.fn(async () => ({ text: '{"subject":{"box_2d":[0,0,1000,1000]}}' })) } } };
    expect(await analyzePhoto('https://x/c.png', ok)).not.toBeNull(); // a falha anterior não ficou presa no cache
  });

  it('sem proporção do espaço ou sem análise: null', () => {
    expect(frameFromAnalysis(null, 1)).toBeNull();
    expect(frameFromAnalysis({ focus: retrato, aspect: 0.75 }, null)).toBeNull();
  });
});

describe('measureSlotAspect', () => {
  it('lê a geometria real do espaço pedido', async () => {
    const measure = vi.fn(async () => [{ slot: '1', w: 600, h: 300 }, { slot: '2', w: 100, h: 400 }]);
    expect(await measureSlotAspect('<html/>', { width: 1920, height: 1080 }, '2', { measure })).toBe(0.25);
  });
  it('espaço inexistente, sem tamanho ou erro do navegador: null', async () => {
    expect(await measureSlotAspect('<html/>', { width: 1, height: 1 }, '9', { measure: async () => [{ slot: '1', w: 10, h: 10 }] })).toBeNull();
    expect(await measureSlotAspect('<html/>', { width: 1, height: 1 }, '1', { measure: async () => [{ slot: '1', w: 0, h: 0 }] })).toBeNull();
    expect(await measureSlotAspect('<html/>', { width: 1, height: 1 }, '1', { measure: async () => { throw new Error('chromium'); } })).toBeNull();
  });
});
