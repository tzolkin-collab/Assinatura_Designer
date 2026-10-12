import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import sharp from 'sharp';
import { autoFrameSlidePhotos, clearFramingCache } from '../lib/photoFraming.js';
import { listPhotoSlots, setPhotoPosition } from '../lib/photoSlot.js';

// Foto em pé (3:4) com o rosto no terço de cima, num espaço paisagem 16:9: o caso que o centro corta.
const FOTO = 'https://r2.example/brands/b1/amanda-01.jpg';
const OUTRA = 'https://evil.example/foto.jpg';
const RESP = JSON.stringify({ subject: { box_2d: [50, 200, 1000, 800] }, face: { box_2d: [80, 350, 280, 650] } });

let img: Buffer;
beforeAll(async () => {
  img = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#888' } }).jpeg().toBuffer();
});

const slideCom = (src: string, style = 'object-fit:cover') =>
  `<h1>Título</h1><div data-photo-slot="1" style="width:960px;height:540px"><img data-photo-img src="${src}" alt="Retrato da Amanda" style="width:100%;height:100%;${style}"></div>`;

const fakeDeps = (aspect: number | null = 16 / 9, resposta = RESP) => ({
  fetchImage: vi.fn(async () => img),
  client: { models: { generateContent: vi.fn(async () => ({ text: resposta })) } },
  measure: vi.fn(async () => (aspect === null ? [] : [{ slot: '1', w: 960 * 1, h: (960 / aspect) }])),
});

const base = { fonts: ['Inter'], width: 1920, height: 1080, allowedUrls: new Set([FOTO]) as ReadonlySet<string> };

beforeEach(() => clearFramingCache());

describe('autoFrameSlidePhotos: foto que o artista colocou no slide', () => {
  it('sobe o enquadramento para manter o rosto, e não toca em mais nada do slide', async () => {
    const deps = fakeDeps();
    const { slides, framed } = await autoFrameSlidePhotos({ ...base, slides: [{ html: slideCom(FOTO), css: '.x{}' }] }, deps);
    expect(framed).toBe(1);
    const [s] = listPhotoSlots(slides[0]!.html);
    expect(s!.position.x).toBe(50);
    expect(s!.position.y).toBeLessThan(30); // o rosto está no alto da foto
    expect(slides[0]!.html).toContain('alt="Retrato da Amanda"'); // alt preservado
    expect(slides[0]!.html).toContain('<h1>Título</h1>');
    expect(slides[0]!.css).toBe('.x{}');
  });

  it('só baixa fotos permitidas (biblioteca e anexos): a URL que o artista escreveu não vira fetch do servidor', async () => {
    const deps = fakeDeps();
    const html = slideCom(OUTRA);
    const { slides, framed } = await autoFrameSlidePhotos({ ...base, slides: [{ html }] }, deps);
    expect(framed).toBe(0);
    expect(slides[0]!.html).toBe(html);
    expect(deps.fetchImage).not.toHaveBeenCalled();
  });

  it('respeita o enquadramento que o artista já definiu e o contain', async () => {
    const deps = fakeDeps();
    const definido = slideCom(FOTO, 'object-fit:cover;object-position:20% 30%');
    const contain = slideCom(FOTO, 'object-fit:contain');
    const { slides, framed } = await autoFrameSlidePhotos({ ...base, slides: [{ html: definido }, { html: contain }] }, deps);
    expect(framed).toBe(0);
    expect(slides.map((s) => s.html)).toEqual([definido, contain]);
    expect(deps.fetchImage).not.toHaveBeenCalled();
  });

  it('espaço vazio e slide sem foto passam intactos, sem render nem chamada ao modelo', async () => {
    const deps = fakeDeps();
    const vazio = '<div data-photo-slot="1" style="width:10px;height:10px"></div>';
    const semFoto = '<div>só texto</div>';
    const { slides, framed } = await autoFrameSlidePhotos({ ...base, slides: [{ html: vazio }, { html: semFoto }] }, deps);
    expect(framed).toBe(0);
    expect(slides.map((s) => s.html)).toEqual([vazio, semFoto]);
    expect(deps.measure).not.toHaveBeenCalled();
    expect(deps.client.models.generateContent).not.toHaveBeenCalled();
  });

  it('falha ao medir o espaço ou ao detectar o assunto: o slide fica exatamente como veio (centro)', async () => {
    const html = slideCom(FOTO);
    const semMedida = await autoFrameSlidePhotos({ ...base, slides: [{ html }] }, fakeDeps(null));
    expect(semMedida.framed).toBe(0);
    expect(semMedida.slides[0]!.html).toBe(html);

    clearFramingCache();
    const semAssunto = await autoFrameSlidePhotos({ ...base, slides: [{ html }] }, fakeDeps(16 / 9, 'não sei'));
    expect(semAssunto.framed).toBe(0);
    expect(semAssunto.slides[0]!.html).toBe(html);
  });

  it('a mesma foto em vários slides é analisada uma vez só', async () => {
    const deps = fakeDeps();
    const { framed } = await autoFrameSlidePhotos({ ...base, slides: [{ html: slideCom(FOTO) }, { html: slideCom(FOTO) }] }, deps);
    expect(framed).toBe(2);
    expect(deps.client.models.generateContent).toHaveBeenCalledTimes(1);
  });
});

describe('setPhotoPosition', () => {
  it('muda só o object-position da foto do espaço', () => {
    const html = setPhotoPosition(slideCom(FOTO), '1', { x: 40, y: 10 });
    const [s] = listPhotoSlots(html);
    expect(s!.position).toEqual({ x: 40, y: 10 });
    expect(s!.fit).toBe('cover');
    expect(html).toContain('alt="Retrato da Amanda"');
  });
  it('espaço inexistente ou vazio: devolve o HTML igual', () => {
    const vazio = '<div data-photo-slot="1"></div>';
    expect(setPhotoPosition(vazio, '1', { x: 1, y: 1 })).toBe(vazio);
    expect(setPhotoPosition(slideCom(FOTO), '9', { x: 1, y: 1 })).toBe(slideCom(FOTO));
  });
  it('limita a 0..100', () => {
    const [s] = listPhotoSlots(setPhotoPosition(slideCom(FOTO), '1', { x: 500, y: -20 }));
    expect(s!.position).toEqual({ x: 100, y: 0 });
  });
});
