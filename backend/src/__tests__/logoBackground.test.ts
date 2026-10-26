import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { analyzeLogo } from '../lib/logoBackground';

const BG = { r: 65, g: 11, b: 28 };
const INK = { r: 142, g: 35, b: 45 };

/** Logo sintético: fundo liso, barra de tinta com meio-tom nas pontas e, se pedido, 1 px de borda de outra cor. */
async function logo(opts: { third?: boolean; border?: boolean } = {}): Promise<Buffer> {
  const w = 200;
  const h = 80;
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let c = BG;
      if (x >= 40 && x < 160 && y >= 30 && y < 50) c = INK;
      else if ((x === 39 || x === 160) && y >= 30 && y < 50) c = { r: 103, g: 23, b: 36 };
      if (opts.third && x >= 20 && x < 60 && y >= 5 && y < 25) c = { r: 20, g: 160, b: 200 };
      if (opts.border && (x === 0 || y === 0 || x === w - 1 || y === h - 1)) c = { r: 165, g: 140, b: 148 };
      const o = (y * w + x) * 3;
      px[o] = c.r;
      px[o + 1] = c.g;
      px[o + 2] = c.b;
    }
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

describe('analyzeLogo', () => {
  it('mede o fundo exato (pixel do arquivo, não a paleta) mesmo com borda de outra cor', async () => {
    const r = await analyzeLogo(await logo({ border: true }));
    expect(r.bgHex).toBe('#410B1C'); // a paleta diz #410C1C: um nível de diferença
    expect(r.ink).toBe('#8E232D');
    expect(r.twoColor).toBe(true);
  });

  it('deriva a versão transparente: só a tinta, sem fundo, caixa justa ao desenho', async () => {
    const r = await analyzeLogo(await logo({ border: true }));
    const out = await sharp(r.transparentPng!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = out.info;
    expect(width).toBeGreaterThanOrEqual(118);
    expect(width).toBeLessThanOrEqual(124);
    expect(height).toBeLessThanOrEqual(22);
    const mid = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
    expect([out.data[mid], out.data[mid + 1], out.data[mid + 2], out.data[mid + 3]]).toEqual([142, 35, 45, 255]);
  });

  it('logo com três cores não é derivado, mas o fundo exato continua medido', async () => {
    const r = await analyzeLogo(await logo({ third: true }));
    expect(r.twoColor).toBe(false);
    expect(r.transparentPng).toBeUndefined();
    expect(r.bgHex).toBe('#410B1C');
  });

  it('arquivo que já é transparente não é derivado nem tem fundo', async () => {
    const red = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 200, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const png = await sharp({ create: { width: 50, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: red, left: 5, top: 5 }])
      .png()
      .toBuffer();
    const r = await analyzeLogo(png);
    expect(r).toMatchObject({ alreadyTransparent: true, bgHex: null, twoColor: false });
  });
});
