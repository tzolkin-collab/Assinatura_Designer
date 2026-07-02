// Render fiel de HTML/CSS para PNG usando chromium headless (Playwright).
// É o que torna o crítico confiável: ele vê EXATAMENTE o que o CSS produz —
// flexbox, gradientes, fontes, sombras — em vez de uma aproximação.

import { chromium, type Browser } from 'playwright';
import sharp from 'sharp';

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}

export interface HtmlRasterOptions {
  width: number;
  height: number;
  // Maior dimensão do PNG final (downscale para o crítico economizar token). 0 = full.
  maxDim?: number;
}

export async function renderHtmlToPng(html: string, opts: HtmlRasterOptions): Promise<Buffer> {
  const { width, height, maxDim = 768 } = opts;
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 15000 });
    // Espera as webfonts carregarem para não rasterizar com fonte de fallback.
    await page.evaluate(() => {
      const d = (globalThis as { document?: { fonts?: { ready?: Promise<unknown> } } }).document;
      return d?.fonts?.ready ?? null;
    }).catch(() => {});
    await page.waitForTimeout(200);
    const raw = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height } });
    if (!maxDim) return raw;
    return sharp(raw).resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  } finally {
    await context.close();
  }
}

export async function renderHtmlToBase64(html: string, opts: HtmlRasterOptions): Promise<string> {
  const buf = await renderHtmlToPng(html, opts);
  return buf.toString('base64');
}
