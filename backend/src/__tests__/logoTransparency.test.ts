import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { diagnosticarLogo, aplicarAlfaPorLuminancia } from '../lib/logoTransparency';

/** Gera um PNG sintético: fundo `bg`, um retângulo central `fg`. */
async function fazerPng(
  bg: [number, number, number],
  fg: [number, number, number],
  opts: { alfa?: boolean } = {},
): Promise<Buffer> {
  const w = 100, h = 100;
  const ch = opts.alfa ? 4 : 3;
  const raw = Buffer.alloc(w * h * ch);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dentro = x > 30 && x < 70 && y > 30 && y < 70;
      const cor = dentro ? fg : bg;
      const p = (y * w + x) * ch;
      raw[p] = cor[0]; raw[p + 1] = cor[1]; raw[p + 2] = cor[2];
      if (opts.alfa) raw[p + 3] = dentro ? 255 : 0;
    }
  }
  return await sharp(raw, { raw: { width: w, height: h, channels: ch as 3 | 4 } }).png().toBuffer();
}

const PRETO: [number, number, number] = [0, 0, 0];
const BRANCO: [number, number, number] = [255, 255, 255];
const VINHO: [number, number, number] = [58, 13, 27];
const CRIMSON: [number, number, number] = [194, 16, 63];

describe('diagnosticarLogo', () => {
  it('aceita arte monocromática sobre fundo branco — o caso do Canva/Word', async () => {
    const d = await diagnosticarLogo(await fazerPng(BRANCO, PRETO));
    expect(d.aplicavel).toBe(true);
    expect(d.fracaoBordaClara).toBe(1);
  });

  it('recusa imagem que já tem canal alfa', async () => {
    const d = await diagnosticarLogo(await fazerPng(BRANCO, PRETO, { alfa: true }));
    expect(d.aplicavel).toBe(false);
    expect(d.temAlfa).toBe(true);
  });

  // O caso perigoso: converter destruiria as cores da marca.
  it('recusa logo colorido', async () => {
    const d = await diagnosticarLogo(await fazerPng(BRANCO, CRIMSON));
    expect(d.aplicavel).toBe(false);
    expect(d.motivo).toMatch(/colorido/);
  });

  // O outro caso perigoso: arte clara sobre fundo escuro sairia toda invertida.
  // Fundo cinza-escuro NEUTRO para exercitar a checagem de borda — o vinho da
  // marca cai antes, na checagem de cor, e vira o caso seguinte.
  it('recusa arte clara sobre fundo escuro neutro', async () => {
    const d = await diagnosticarLogo(await fazerPng([28, 28, 28], BRANCO));
    expect(d.aplicavel).toBe(false);
    expect(d.motivo).toMatch(/fundo não é branco/);
  });

  it('recusa fundo escuro colorido antes mesmo de olhar a borda', async () => {
    const d = await diagnosticarLogo(await fazerPng(VINHO, BRANCO));
    expect(d.aplicavel).toBe(false);
    expect(d.motivo).toMatch(/colorido/);
  });

  it('recusa fundo cinza médio, que não é branco chapado', async () => {
    const d = await diagnosticarLogo(await fazerPng([128, 128, 128], PRETO));
    expect(d.aplicavel).toBe(false);
  });
});

describe('aplicarAlfaPorLuminancia', () => {
  it('deixa o fundo branco totalmente transparente e a arte preta opaca', async () => {
    const png = await aplicarAlfaPorLuminancia(await fazerPng(BRANCO, PRETO));
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);

    const alfaEm = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    expect(alfaEm(5, 5)).toBe(0);      // canto: era branco
    expect(alfaEm(50, 50)).toBe(255);  // centro: era preto
  });

  // É o que separa esta conversão de um recorte por limiar: o cinza da borda do
  // traço vira alfa proporcional em vez de virar franja serrilhada.
  it('converte cinza intermediário em alfa proporcional', async () => {
    const png = await aplicarAlfaPorLuminancia(await fazerPng(BRANCO, [128, 128, 128]));
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const alfa = data[(50 * info.width + 50) * 4 + 3]!;
    expect(alfa).toBeGreaterThan(120);
    expect(alfa).toBeLessThan(135);
  });

  it('preserva as dimensões originais', async () => {
    const png = await aplicarAlfaPorLuminancia(await fazerPng(BRANCO, PRETO));
    const m = await sharp(png).metadata();
    expect(m.width).toBe(100);
    expect(m.height).toBe(100);
  });
});
