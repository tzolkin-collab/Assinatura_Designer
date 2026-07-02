// Rasterização de SVG para PNG usando sharp (sem headless browser).
// Usado pelo crítico multimodal (vê o slide renderizado) e, futuramente, export.

import sharp from 'sharp';

export interface RasterOptions {
  // Maior dimensão do PNG resultante. O crítico não precisa de alta resolução;
  // imagens menores reduzem custo de token no modelo multimodal.
  maxDim?: number;
}

export async function rasterizeSvg(svg: string, opts: RasterOptions = {}): Promise<Buffer> {
  const maxDim = opts.maxDim ?? 768;
  return sharp(Buffer.from(svg))
    .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
}

export async function rasterizeSvgToBase64(svg: string, opts: RasterOptions = {}): Promise<string> {
  const buf = await rasterizeSvg(svg, opts);
  return buf.toString('base64');
}
