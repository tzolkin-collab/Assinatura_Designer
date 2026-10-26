// Fundo exato e versão transparente de um logo.
//
// Os logos da Amanda chegam como PNG RGB, sem canal alfa: o fundo vem queimado no arquivo. O fundo do
// arquivo (65,11,28) e a cor da paleta #410C1C (65,12,28) diferem em UM nível, o suficiente para aparecer
// como uma linha fraca quando o logo é posto sobre o fundo da paleta. Aqui se mede a cor exata do fundo
// (para o agente pintar a área do logo com ela) e, quando o logo tem só duas cores (tinta e fundo), se
// deriva uma versão transparente com a mesma tinta, que serve sobre qualquer fundo.
//
// Logo com três ou mais cores, degradê ou textura NÃO é derivado: a projeção em duas cores o estragaria.

import sharp from 'sharp';

export interface LogoAnalysis {
  /** Cor exata do fundo do arquivo (#RRGGBB); null quando o arquivo já é transparente. */
  bgHex: string | null;
  /** Cor da tinta (#RRGGBB) quando o logo tem só duas cores. */
  ink: string | null;
  /** O arquivo já tem transparência: não há o que derivar. */
  alreadyTransparent: boolean;
  /** Só tinta e fundo (com serrilhado). Só então `transparentPng` existe. */
  twoColor: boolean;
  transparentPng?: Buffer;
}

type Rgb = [number, number, number];

/** Distância do pixel à reta fundo→tinta acima da qual ele é "uma terceira cor". */
const LINE_TOLERANCE = 14;
/** Fração máxima de pixels fora da reta para ainda contar como duas cores (ruído de compressão). */
const OUTLIER_FRACTION = 0.002;
const MAX_SIDE = 1600;

const hex = ([r, g, b]: Rgb): string =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

const dist = (a: Rgb, b: Rgb): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function hexToRgb(h: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export async function analyzeLogo(input: Buffer): Promise<LogoAnalysis> {
  const meta = await sharp(input).metadata();
  // Os arquivos trazem 1 px de borda com resto de antialias (cor diferente do fundo): fica fora da medida.
  const edge = Math.min(meta.width ?? 0, meta.height ?? 0) > 16 ? 2 : 0;
  const base = edge
    ? sharp(await sharp(input).rotate().extract({ left: edge, top: edge, width: (meta.width ?? 0) - 2 * edge, height: (meta.height ?? 0) - 2 * edge }).toBuffer())
    : sharp(input).rotate();
  const resized = (meta.width ?? 0) > MAX_SIDE || (meta.height ?? 0) > MAX_SIDE
    ? base.resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside' })
    : base;
  const { data, info } = await resized.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const n = width * height;

  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3]! < 250) return { bgHex: null, ink: null, alreadyTransparent: true, twoColor: false };
  }

  // Tinta = a cor, entre as que ocupam ao menos 0,1% da imagem, mais distante do fundo.
  const bins = new Map<number, { sum: Rgb; count: number }>();
  for (let i = 0; i < n; i++) {
    const r = data[i * 4]!;
    const g = data[i * 4 + 1]!;
    const b = data[i * 4 + 2]!;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const e = bins.get(key) ?? { sum: [0, 0, 0] as Rgb, count: 0 };
    e.sum[0] += r;
    e.sum[1] += g;
    e.sum[2] += b;
    e.count += 1;
    bins.set(key, e);
  }
  // Fundo = a cor mais comum da imagem (o fundo ocupa a maior parte do quadro), no valor exato do pixel.
  let topBin = -1;
  let topCount = 0;
  for (const [k, e] of bins) if (e.count > topCount) { topBin = k; topCount = e.count; }
  const exact = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const r = data[i * 4]!, g = data[i * 4 + 1]!, b = data[i * 4 + 2]!;
    if ((((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)) !== topBin) continue;
    const key = `${r},${g},${b}`;
    exact.set(key, (exact.get(key) ?? 0) + 1);
  }
  const bg = [...exact.entries()].sort((x, y) => y[1] - x[1])[0]![0].split(',').map(Number) as Rgb;

  let ink: Rgb | null = null;
  let best = 0;
  for (const e of bins.values()) {
    if (e.count < n * 0.001) continue;
    const mean: Rgb = [e.sum[0] / e.count, e.sum[1] / e.count, e.sum[2] / e.count];
    const d = dist(mean, bg);
    if (d > best) {
      best = d;
      ink = mean;
    }
  }
  // Fundo liso, sem tinta distinguível: não há logo para derivar.
  if (!ink || best < 30) return { bgHex: hex(bg), ink: null, alreadyTransparent: false, twoColor: false };

  const axis: Rgb = [ink[0] - bg[0], ink[1] - bg[1], ink[2] - bg[2]];
  const axisLen2 = axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2;
  const alpha = Buffer.alloc(n);
  let outliers = 0;
  for (let i = 0; i < n; i++) {
    const p: Rgb = [data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!];
    const t = ((p[0] - bg[0]) * axis[0] + (p[1] - bg[1]) * axis[1] + (p[2] - bg[2]) * axis[2]) / axisLen2;
    const tc = Math.min(1, Math.max(0, t));
    const onLine: Rgb = [bg[0] + axis[0] * tc, bg[1] + axis[1] * tc, bg[2] + axis[2] * tc];
    if (dist(p, onLine) > LINE_TOLERANCE || t < -0.08 || t > 1.08) outliers += 1;
    alpha[i] = Math.round(tc * 255);
  }
  if (outliers > n * OUTLIER_FRACTION) return { bgHex: hex(bg), ink: hex(ink), alreadyTransparent: false, twoColor: false };

  const rgba = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    rgba[i * 4] = Math.round(ink[0]);
    rgba[i * 4 + 1] = Math.round(ink[1]);
    rgba[i * 4 + 2] = Math.round(ink[2]);
    rgba[i * 4 + 3] = alpha[i]!;
  }

  // A borda já ficou fora; aqui só se corta o transparente em volta do desenho.
  const trimmed = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer().then((png) => sharp(png).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 }).png().toBuffer());

  return { bgHex: hex(bg), ink: hex(ink), alreadyTransparent: false, twoColor: true, transparentPng: trimmed };
}
