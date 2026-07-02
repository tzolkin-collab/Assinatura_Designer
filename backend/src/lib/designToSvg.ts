// Serializa um DesignDocument (ou uma de suas páginas) para SVG, para que possa
// ser rasterizado em PNG (via sharp) e enviado ao crítico multimodal — e, mais
// tarde, usado para export. Não precisa ser pixel-perfect com o renderizador do
// frontend; precisa ser fiel o bastante para o modelo avaliar contraste,
// hierarquia, composição e uso de imagem.

import type {
  DesignDocument,
  DesignNode,
  DesignPageNode,
  DesignTokens,
  LayoutStyle,
} from './designDocument.js';

type Box = { x: number; y: number; width: number; height: number };

const MIN = 1;

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function resolveSize(value: LayoutStyle['width'], parentSize: number, fallback: number): number {
  if (isNum(value)) return Math.max(MIN, value);
  if (typeof value === 'string') {
    const t = value.trim();
    if (t.endsWith('%')) {
      const r = Number(t.slice(0, -1));
      return Number.isFinite(r) ? Math.max(MIN, (parentSize * r) / 100) : fallback;
    }
    if (t.endsWith('px')) {
      const px = Number(t.slice(0, -2));
      return Number.isFinite(px) ? Math.max(MIN, px) : fallback;
    }
  }
  return Math.max(MIN, fallback);
}

function getPadding(layout?: LayoutStyle) {
  const p = layout?.padding;
  if (isNum(p)) return { top: p, right: p, bottom: p, left: p };
  if (p && typeof p === 'object') return p;
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

function layoutToBox(layout: LayoutStyle | undefined, parent: Box, fallbackHeight: number): Box {
  const pad = getPadding(layout);
  const availW = Math.max(MIN, parent.width - pad.left - pad.right);
  const availH = Math.max(MIN, parent.height - pad.top - pad.bottom);
  const width = resolveSize(layout?.width, availW, availW);
  const height = resolveSize(layout?.height, availH, fallbackHeight);
  const x = parent.x + pad.left + (isNum(layout?.x) ? (layout!.x as number) : 0);
  const y = parent.y + pad.top + (isNum(layout?.y) ? (layout!.y as number) : 0);
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(Math.min(width, parent.x + parent.width - x)),
    height: Math.round(Math.min(height, parent.y + parent.height - y)),
  };
}

function flowBoxes(children: DesignNode[], parent: Box, layout?: LayoutStyle): Box[] {
  if (children.length === 0) return [];
  const gap = isNum(layout?.gap) ? (layout!.gap as number) : 0;
  const row = layout?.display === 'flex' && layout.direction === 'row';
  if (row) {
    const w = Math.max(MIN, (parent.width - gap * (children.length - 1)) / children.length);
    return children.map((c, i) =>
      c.layout?.position === 'absolute'
        ? parent
        : { x: Math.round(parent.x + i * (w + gap)), y: parent.y, width: Math.round(w), height: parent.height },
    );
  }
  const h = Math.max(MIN, (parent.height - gap * (children.length - 1)) / children.length);
  return children.map((c, i) =>
    c.layout?.position === 'absolute'
      ? parent
      : { x: parent.x, y: Math.round(parent.y + i * (h + gap)), width: parent.width, height: Math.round(h) },
  );
}

// Resolve uma cor: hex/rgb literais passam direto; nomes de token mapeiam para a
// paleta; gradientes são tratados pelo caller (defs).
function resolveColor(value: unknown, tokens: DesignTokens, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const v = value.trim();
  const tokenMap: Record<string, string | undefined> = {
    background: tokens.colors.background,
    surface: tokens.colors.surface,
    text: tokens.colors.text,
    muted: tokens.colors.muted,
    accent: tokens.colors.accent,
    accent2: tokens.colors.accent2,
  };
  if (tokenMap[v]) return tokenMap[v]!;
  return v;
}

let gradSeq = 0;

// Extrai as cores de um string linear-gradient(...) e devolve <defs> + url(#id).
function gradientFill(value: string, defs: string[]): string | null {
  if (!value.startsWith('linear-gradient(')) return null;
  const colors = value.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)/g);
  if (!colors || colors.length === 0) return null;
  const angleMatch = value.match(/(-?\d+(?:\.\d+)?)deg/);
  const angle = angleMatch ? Number(angleMatch[1]) : 135;
  const id = `grad${gradSeq++}`;
  // converte ângulo CSS para x1/y1/x2/y2 (aproximação)
  const rad = ((angle - 90) * Math.PI) / 180;
  const x1 = 50 - Math.cos(rad) * 50;
  const y1 = 50 - Math.sin(rad) * 50;
  const x2 = 50 + Math.cos(rad) * 50;
  const y2 = 50 + Math.sin(rad) * 50;
  const stops = colors
    .map((c, i) => `<stop offset="${(i / Math.max(1, colors.length - 1)) * 100}%" stop-color="${esc(c)}"/>`)
    .join('');
  defs.push(
    `<linearGradient id="${id}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">${stops}</linearGradient>`,
  );
  return `url(#${id})`;
}

function fillFor(paint: unknown, tokens: DesignTokens, defs: string[], fallback: string): string {
  if (typeof paint === 'string' && paint.startsWith('linear-gradient(')) {
    return gradientFill(paint, defs) ?? fallback;
  }
  return resolveColor(paint, tokens, fallback);
}

function wrapText(content: string, fontSize: number, boxWidth: number): string[] {
  const charsPerLine = Math.max(1, Math.floor(boxWidth / (fontSize * 0.55)));
  const words = content.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > charsPerLine && cur) {
      lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 12);
}

function renderNode(node: DesignNode, parent: Box, tokens: DesignTokens, defs: string[], out: string[]): void {
  if (node.type === 'container') {
    const box = layoutToBox(node.layout, parent, Math.max(180, parent.height));
    const bg = node.style?.background;
    if (bg) {
      const fill = fillFor(bg, tokens, defs, tokens.colors.surface);
      const r = node.style?.borderRadius ?? 0;
      out.push(
        `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${r}" fill="${fill}" opacity="${node.style?.opacity ?? 1}"/>`,
      );
    }
    const pad = getPadding(node.layout);
    const inner: Box = {
      x: box.x + pad.left,
      y: box.y + pad.top,
      width: Math.max(MIN, box.width - pad.left - pad.right),
      height: Math.max(MIN, box.height - pad.top - pad.bottom),
    };
    const boxes = flowBoxes(node.children, inner, node.layout);
    node.children.forEach((child, i) => renderNode(child, boxes[i] ?? inner, tokens, defs, out));
    return;
  }

  if (node.type === 'shape') {
    const box = layoutToBox(node.layout, parent, 180);
    const fill = fillFor(node.style?.background, tokens, defs, tokens.colors.accent);
    const circle = node.style?.shape === 'circle';
    const r = circle ? Math.min(box.width, box.height) / 2 : node.style?.shape === 'pill' ? box.height / 2 : (node.style?.borderRadius ?? 0);
    out.push(
      `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${r}" fill="${fill}" opacity="${node.style?.opacity ?? 1}"/>`,
    );
    return;
  }

  if (node.type === 'image') {
    const box = layoutToBox(node.layout, parent, 180);
    const src = typeof node.src === 'string' ? node.src : '';
    if (src) {
      out.push(
        `<image x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" href="${esc(src)}" preserveAspectRatio="xMidYMid slice"/>`,
      );
    } else {
      out.push(`<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="${tokens.colors.surface}"/>`);
    }
    return;
  }

  if (node.type === 'text') {
    const box = layoutToBox(node.layout, parent, 96);
    const fontSize = node.style?.fontSize ?? (node.role === 'headline' ? 72 : node.role === 'subtitle' ? 38 : node.role === 'eyebrow' || node.role === 'caption' ? 22 : 30);
    const weight = node.style?.fontWeight ?? (node.role === 'headline' ? 800 : node.role === 'eyebrow' ? 700 : 400);
    const color = resolveColor(node.style?.color, tokens, tokens.colors.text);
    const align = node.style?.textAlign ?? 'left';
    const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
    const tx = align === 'center' ? box.x + box.width / 2 : align === 'right' ? box.x + box.width : box.x;
    const family = node.style?.fontFamily && !['display', 'heading', 'body'].includes(node.style.fontFamily) ? node.style.fontFamily : tokens.typography.body;
    const lineH = (node.style?.lineHeight ?? 1.2) * fontSize;
    const lines = wrapText(node.content ?? '', fontSize, box.width);
    const tspans = lines
      .map((ln, i) => `<tspan x="${tx}" dy="${i === 0 ? fontSize : lineH}">${esc(ln)}</tspan>`)
      .join('');
    out.push(
      `<text y="${box.y}" font-family="${esc(family)}, Inter, Arial, sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${tspans}</text>`,
    );
    return;
  }
}

export function designPageToSvg(page: DesignPageNode, tokens: DesignTokens, width: number, height: number): string {
  const defs: string[] = [];
  const out: string[] = [];
  const pageBox: Box = { x: 0, y: 0, width, height };
  const bgFill = fillFor(page.background, tokens, defs, tokens.colors.background);
  out.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${bgFill}"/>`);
  for (const node of page.children) renderNode(node, pageBox, tokens, defs, out);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    (defs.length ? `<defs>${defs.join('')}</defs>` : '') +
    out.join('') +
    `</svg>`;
}

export function designDocumentToSvgs(document: DesignDocument): string[] {
  return document.pages.map((page) => designPageToSvg(page, document.tokens, document.width, document.height));
}
