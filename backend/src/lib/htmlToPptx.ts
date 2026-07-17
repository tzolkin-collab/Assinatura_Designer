// HTML/CSS → PPTX editável (scan de DOM no chromium + pptxgenjs).
//
// É o caminho da entrega EDITÁVEL no Canva: o PPTX importado vira design com
// texto, formas e imagens como elementos nativos (via Design Imports by URL),
// em vez do PNG rasterizado do canvaExport.ts (arte pronta, não editável).
//
// Como funciona:
//   1. O documento HTML do slide é carregado no MESMO chromium do raster
//      (htmlRaster.scanHtmlLayout), com a mesma espera de webfonts.
//   2. Um script na página percorre o DOM e extrai a geometria REAL pós-layout
//      (getBoundingClientRect) + estilos computados — não coordenadas declaradas.
//   3. Cada item vira um elemento nativo do PPTX: texto → text box, <img> e
//      background-image → picture, div com fundo/borda → shape.
//
// Limites conhecidos do formato (não são bugs do conversor):
//   - Gradientes CSS não têm equivalente no pptxgenjs → aproxima pela 1ª cor.
//   - backdrop-filter/glassmorphism não existem em PPTX → sai o fundo sólido.
//   - SVG inline é ignorado no v1 (contado em `skipped` para o parecer).
//   - Fontes: o nome da família vai no PPTX, mas o Canva/PowerPoint precisa
//     tê-la — Google Fonts populares costumam existir no Canva.

import PptxGenJS from 'pptxgenjs';
import { scanHtmlLayout } from './htmlRaster.js';
import { logger } from './logger.js';

const PX_PER_INCH = 96;
const PX_TO_PT = 0.75;

// ── Resultado do scan (contrato com o script in-page) ──────────────────────────
interface ScanItem {
  kind: 'text' | 'image' | 'shape';
  x: number;
  y: number;
  w: number;
  h: number;
  // texto
  text?: string;
  fontFamily?: string;
  fontSizePx?: number;
  fontWeightNum?: number;
  italic?: boolean;
  color?: string;
  align?: string;
  lineHeightPx?: number;
  letterSpacingPx?: number;
  // imagem
  src?: string;
  objectFit?: string;
  // shape
  fill?: string;
  gradientCss?: string;
  radiusPx?: number;
  borderColor?: string;
  borderWidthPx?: number;
  opacity?: number;
}

interface ScanResult {
  width: number;
  height: number;
  background: { color?: string; gradientCss?: string };
  items: ScanItem[];
  skipped: { svg: number };
}

// ── Script executado DENTRO da página (string: o backend não tem lib DOM) ──────
// Ordem de pintura ≈ ordem do documento; z-index explícito é raro nos slides
// gerados (o HTML livre usa sobreposição por ordem). Texto usa Range para medir
// o retângulo REAL do texto (não a caixa flex que o centraliza) — é o que evita
// o desalinhamento vertical quando o PPTX ancorar o texto no topo da caixa.
const SCAN_SCRIPT = `
(() => {
  const root = document.querySelector('.slide-root') || document.body;
  const rootRect = root.getBoundingClientRect();
  const items = [];
  const skipped = { svg: 0 };

  const alphaOf = (cssColor) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(cssColor || '');
    if (!m) return 0;
    const parts = m[1].split(',').map(parseFloat);
    return parts.length >= 4 ? parts[3] : 1;
  };

  const bgUrlOf = (cs) => {
    const m = /url\\(["']?([^"')]+)["']?\\)/.exec(cs.backgroundImage || '');
    return m ? m[1] : null;
  };

  const directText = (el) => {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent;
    return t.trim();
  };

  // Um elemento com texto direto mas TAMBÉM filhos-bloco com texto próprio é
  // tratado como container (desce); só vira text box quando o conteúdo é
  // inline/texto puro — evita duplicar texto de filhos.
  const hasBlockChildren = (el) => {
    for (const c of el.children) {
      const d = getComputedStyle(c).display;
      if (d && !d.startsWith('inline')) return true;
    }
    return false;
  };

  const walk = (el) => {
    if (el.nodeType !== 1) return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style') return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const elOpacity = parseFloat(cs.opacity);
    if (elOpacity === 0) return;

    const r = el.getBoundingClientRect();
    const x = r.left - rootRect.left;
    const y = r.top - rootRect.top;

    if (tag === 'svg') { skipped.svg++; return; }

    if (tag === 'img') {
      if (r.width >= 1 && r.height >= 1) {
        items.push({
          kind: 'image', x, y, w: r.width, h: r.height,
          src: el.currentSrc || el.src || '',
          objectFit: cs.objectFit,
          radiusPx: parseFloat(cs.borderTopLeftRadius) || 0,
          opacity: elOpacity,
        });
      }
      return;
    }

    if (r.width >= 1 && r.height >= 1) {
      const isGradient = (cs.backgroundImage || '').includes('gradient');
      const bgUrl = bgUrlOf(cs);
      const hasFill = alphaOf(cs.backgroundColor) > 0.01;
      const hasBorder = (parseFloat(cs.borderTopWidth) || 0) > 0 && cs.borderTopStyle !== 'none';

      if (bgUrl) {
        items.push({
          kind: 'image', x, y, w: r.width, h: r.height, src: bgUrl,
          objectFit: cs.backgroundSize === 'contain' ? 'contain' : 'cover',
          radiusPx: parseFloat(cs.borderTopLeftRadius) || 0,
          opacity: elOpacity,
        });
      } else if (hasFill || isGradient || hasBorder) {
        items.push({
          kind: 'shape', x, y, w: r.width, h: r.height,
          fill: hasFill ? cs.backgroundColor : undefined,
          gradientCss: isGradient ? cs.backgroundImage : undefined,
          radiusPx: parseFloat(cs.borderTopLeftRadius) || 0,
          borderColor: hasBorder ? cs.borderTopColor : undefined,
          borderWidthPx: hasBorder ? parseFloat(cs.borderTopWidth) : 0,
          opacity: elOpacity,
        });
      }

      const txt = directText(el);
      if (txt && !hasBlockChildren(el)) {
        // Range mede o retângulo real do TEXTO (a caixa pode ser um flex maior).
        let tx = x, ty = y, tw = r.width, th = r.height;
        try {
          const range = document.createRange();
          range.selectNodeContents(el);
          const tr = range.getBoundingClientRect();
          if (tr.width > 0 && tr.height > 0) {
            tx = tr.left - rootRect.left; ty = tr.top - rootRect.top;
            tw = tr.width; th = tr.height;
          }
        } catch (e) { /* mantém a caixa do elemento */ }
        items.push({
          kind: 'text', x: tx, y: ty, w: tw, h: th,
          text: el.innerText,
          fontFamily: (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim(),
          fontSizePx: parseFloat(cs.fontSize) || 16,
          fontWeightNum: parseInt(cs.fontWeight, 10) || 400,
          italic: cs.fontStyle === 'italic',
          color: cs.color,
          align: cs.textAlign,
          lineHeightPx: Number.isFinite(parseFloat(cs.lineHeight)) ? parseFloat(cs.lineHeight) : undefined,
          letterSpacingPx: parseFloat(cs.letterSpacing) || 0,
        });
        return; // innerText já capturou os filhos inline
      }
    }

    for (const child of el.children) walk(child);
  };

  for (const child of root.children) walk(child);

  const rootCs = getComputedStyle(root);
  return {
    width: rootRect.width,
    height: rootRect.height,
    background: {
      color: alphaOf(rootCs.backgroundColor) > 0.01 ? rootCs.backgroundColor : undefined,
      gradientCss: (rootCs.backgroundImage || '').includes('gradient') ? rootCs.backgroundImage : undefined,
    },
    items,
    skipped,
  };
})()
`;

// ── Cores ───────────────────────────────────────────────────────────────────────
interface ParsedColor { hex: string; alpha: number }

/** rgb()/rgba()/#hex → { hex sem '#', alpha 0..1 }. null para transparente/inválido. */
export function parseCssColor(css: string | undefined): ParsedColor | null {
  if (!css) return null;
  const s = css.trim();
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hexMatch) {
    let h = hexMatch[1]!;
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return { hex: h.toUpperCase(), alpha: 1 };
  }
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (!m) return null;
  const parts = m[1]!.split(',').map((p) => parseFloat(p));
  const [r, g, b] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  const alpha = parts.length >= 4 ? (parts[3] ?? 1) : 1;
  if (alpha <= 0.01) return null;
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return { hex: `${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase(), alpha };
}

/** Primeira cor de um gradiente CSS (aproximação: PPTX não tem gradiente livre). */
export function firstGradientColor(gradientCss: string | undefined): ParsedColor | null {
  if (!gradientCss) return null;
  const m = /(#[0-9a-f]{3,8}|rgba?\([^)]+\))/i.exec(gradientCss);
  return m ? parseCssColor(m[1]!) : null;
}

// ── Imagens: baixa e embute como base64 (URL remota direto no pptxgenjs é frágil) ─
const imageCache = new Map<string, string | null>();

async function fetchImageAsData(url: string): Promise<string | null> {
  if (imageCache.has(url)) return imageCache.get(url)!;
  let data: string | null = null;
  try {
    if (/^data:image\//i.test(url)) {
      data = url.replace(/^data:/i, '');
    } else if (/^https?:\/\//i.test(url)) {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'follow' });
      if (res.ok) {
        const mime = (res.headers.get('content-type') || 'image/png').split(';')[0]!.trim();
        if (mime.startsWith('image/')) {
          const buf = Buffer.from(await res.arrayBuffer());
          data = `${mime};base64,${buf.toString('base64')}`;
        }
      }
    }
  } catch (err) {
    logger.warn('PPTX: falha ao baixar imagem; slide segue sem ela', { url: url.slice(0, 120), error: (err as Error).message });
  }
  imageCache.set(url, data);
  return data;
}

// ── Montagem do PPTX ────────────────────────────────────────────────────────────
const ALIGN_MAP: Record<string, 'left' | 'center' | 'right' | 'justify'> = {
  left: 'left', start: 'left', center: 'center', right: 'right', end: 'right', justify: 'justify',
};

export interface HtmlToPptxResult {
  buffer: Buffer;
  stats: Array<{ slide: number; texts: number; images: number; shapes: number; svgSkipped: number; gradientApprox: number }>;
}

/**
 * Converte os documentos HTML dos slides (um por slide, já completos — saída de
 * `resolveRenderableDeck().docAt`) em um PPTX multi-slide editável.
 */
export async function htmlDocsToPptx(
  docs: string[],
  width: number,
  height: number,
  title?: string,
  onProgress?: (done: number, total: number) => Promise<void> | void,
): Promise<HtmlToPptxResult> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'DESIGNER', width: width / PX_PER_INCH, height: height / PX_PER_INCH });
  pptx.layout = 'DESIGNER';
  if (title) pptx.title = title;

  const inch = (px: number) => px / PX_PER_INCH;
  const stats: HtmlToPptxResult['stats'] = [];

  for (let i = 0; i < docs.length; i++) {
    const scan = await scanHtmlLayout<ScanResult>(docs[i]!, { width, height }, SCAN_SCRIPT);
    const slide = pptx.addSlide();
    const st = { slide: i + 1, texts: 0, images: 0, shapes: 0, svgSkipped: scan.skipped?.svg ?? 0, gradientApprox: 0 };

    // Fundo do slide: cor sólida, ou 1ª cor do gradiente (aproximação).
    const bgSolid = parseCssColor(scan.background?.color);
    const bgGrad = firstGradientColor(scan.background?.gradientCss);
    if (scan.background?.gradientCss) st.gradientApprox++;
    const bg = bgSolid ?? bgGrad;
    if (bg) slide.background = { color: bg.hex };

    for (const item of scan.items ?? []) {
      // Clampa ao canvas: elementos decorativos costumam vazar de propósito
      // (overflow:hidden corta no browser; o PPTX não corta).
      const x = Math.max(0, item.x);
      const y = Math.max(0, item.y);
      const w = Math.min(item.w - (x - item.x), width - x);
      const h = Math.min(item.h - (y - item.y), height - y);
      if (w < 1 || h < 1) continue;

      if (item.kind === 'shape') {
        const fill = parseCssColor(item.fill) ?? firstGradientColor(item.gradientCss);
        if (item.gradientCss) st.gradientApprox++;
        if (!fill && !item.borderWidthPx) continue;
        const radius = item.radiusPx ?? 0;
        const isEllipse = radius >= Math.min(w, h) / 2 - 1;
        const border = parseCssColor(item.borderColor);
        slide.addShape(isEllipse ? 'ellipse' : radius > 0 ? 'roundRect' : 'rect', {
          x: inch(x), y: inch(y), w: inch(w), h: inch(h),
          fill: fill
            ? { color: fill.hex, transparency: Math.round((1 - fill.alpha * (item.opacity ?? 1)) * 100) }
            : { color: 'FFFFFF', transparency: 100 },
          line: border && item.borderWidthPx
            ? { color: border.hex, width: item.borderWidthPx * PX_TO_PT }
            : { color: 'FFFFFF', transparency: 100 },
          ...(isEllipse ? {} : radius > 0 ? { rectRadius: inch(Math.min(radius, Math.min(w, h) / 2)) } : {}),
        });
        st.shapes++;
        continue;
      }

      if (item.kind === 'image' && item.src) {
        const data = await fetchImageAsData(item.src);
        if (!data) continue;
        slide.addImage({
          data,
          x: inch(x), y: inch(y), w: inch(w), h: inch(h),
          ...(item.radiusPx && item.radiusPx >= Math.min(w, h) / 2 - 1 ? { rounding: true } : {}),
          sizing: { type: item.objectFit === 'contain' ? 'contain' : 'crop', w: inch(w), h: inch(h) },
        });
        st.images++;
        continue;
      }

      if (item.kind === 'text' && item.text?.trim()) {
        const color = parseCssColor(item.color);
        // Folga anti-rewrap: o PowerPoint mede texto diferente do chromium; sem
        // uma margem, frases na largura exata quebram linha onde não quebravam.
        const padW = Math.min(item.fontSizePx ?? 16, width - x - w);
        slide.addText(item.text, {
          x: inch(x), y: inch(y), w: inch(w + Math.max(0, padW)), h: inch(h),
          fontFace: item.fontFamily || 'Inter',
          fontSize: Math.max(1, Math.round((item.fontSizePx ?? 16) * PX_TO_PT * 10) / 10),
          color: color?.hex ?? '000000',
          bold: (item.fontWeightNum ?? 400) >= 600,
          italic: item.italic ?? false,
          align: ALIGN_MAP[item.align ?? 'left'] ?? 'left',
          valign: 'top',
          margin: 0,
          ...(item.lineHeightPx ? { lineSpacing: Math.round(item.lineHeightPx * PX_TO_PT * 10) / 10 } : {}),
          ...(item.letterSpacingPx ? { charSpacing: Math.round(item.letterSpacingPx * PX_TO_PT * 100) / 100 } : {}),
        });
        st.texts++;
      }
    }

    stats.push(st);
    await onProgress?.(i + 1, docs.length);
  }

  const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  return { buffer, stats };
}
