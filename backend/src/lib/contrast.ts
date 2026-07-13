// Garantia determinística de legibilidade.
//
// O modelo erra contraste com frequência (texto escuro em fundo escuro, ou não
// declara cor e cai no default). Este passo roda DEPOIS da geração e, para cada
// node de texto, descobre o fundo diretamente atrás dele (card/shape sólido,
// imagem ou o fundo da página) e força uma cor de texto com contraste WCAG
// adequado. Sobre imagens/fundos incertos, garante um card de contraste.

import type { DesignDocument, DesignNode, DesignTokens, TextNode } from './designDocument.js';

const LIGHT_TEXT = '#FFFFFF';
const DARK_TEXT = '#0A0A0A';
const MIN_RATIO = 4.5; // WCAG AA para texto normal

type RGB = { r: number; g: number; b: number };
type Box = { x: number; y: number; w: number; h: number };

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

const NAMED = new Set(['background', 'surface', 'text', 'muted', 'accent', 'accent2']);

function parseColor(value: unknown, tokens: DesignTokens, depth = 0): RGB | null {
  if (typeof value !== 'string' || depth > 3) return null;
  const v = value.trim();
  if (!v) return null;
  if (NAMED.has(v)) return parseColor(tokens.colors[v as keyof DesignTokens['colors']], tokens, depth + 1);

  // hex
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(v);
  if (m) {
    let hex = m[1];
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
  }
  // rgb/rgba
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(v);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  return null;
}

function relLuminance({ r, g, b }: RGB): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratioFromLum(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

// Luminância de um paint (cor sólida ou gradiente — média dos stops). null = desconhecido.
function paintLuminance(value: unknown, tokens: DesignTokens): number | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (v.startsWith('linear-gradient(')) {
    const cols = v.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)/g) ?? [];
    const lums = cols.map((c) => parseColor(c, tokens)).filter((c): c is RGB => !!c).map(relLuminance);
    return lums.length ? lums.reduce((a, b) => a + b, 0) / lums.length : null;
  }
  const rgb = parseColor(v, tokens);
  return rgb ? relLuminance(rgb) : null;
}

function isSolid(value: unknown, tokens: DesignTokens): boolean {
  return typeof value === 'string' && !value.trim().startsWith('linear-gradient(') && parseColor(value, tokens) !== null;
}

function nodeBox(node: DesignNode, offX: number, offY: number): Box | null {
  const L = node.layout;
  if (!L || !isNum(L.x) || !isNum(L.y) || !isNum(L.width) || !isNum(L.height)) return null;
  return { x: offX + L.x, y: offY + L.y, w: L.width as number, h: L.height as number };
}

function centerIn(box: Box, cx: number, cy: number): boolean {
  return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
}

function setColor(node: TextNode, color: string): void {
  node.style = { ...(node.style ?? {}), color };
}

function ensureSmartContrast(node: TextNode): void {
  const behaviors = Array.isArray(node.behaviors) ? node.behaviors.filter((b) => b.type !== 'smart-contrast') : [];
  node.behaviors = [...behaviors, { type: 'smart-contrast' }];
}

// Clampa blocos de texto de topo dentro da área segura do canvas, para que o
// texto nunca vaze pelas bordas (mantendo sobreposição intencional permitida).
// Só mexe em texto de primeiro nível (layout absoluto); texto aninhado em
// containers é posicionado pelo próprio container e não é tocado.
export function clampTextToSafeArea(document: DesignDocument): void {
  const { width, height } = document;
  const margin = Math.round(Math.min(width, height) * 0.055);
  const minX = margin;
  const minY = margin;
  const maxX = width - margin;
  const maxY = height - margin;

  for (const page of document.pages) {
    for (const node of page.children) {
      if (node.type !== 'text') continue;
      const L = node.layout;
      if (!L || !isNum(L.x) || !isNum(L.y) || !isNum(L.width) || !isNum(L.height)) continue;
      const w = Math.min(L.width as number, maxX - minX);
      const h = Math.min(L.height as number, maxY - minY);
      const x = Math.min(Math.max(L.x as number, minX), maxX - w);
      const y = Math.min(Math.max(L.y as number, minY), maxY - h);
      node.layout = { ...L, x, y, width: w, height: h };
    }
  }
}

type Surface = { box: Box; lum: number };

export function enforceTextContrast(document: DesignDocument): void {
  for (const page of document.pages) {
    const pageLum = paintLuminance(page.background, document.tokens) ?? 1; // default: claro
    const surfaces: Surface[] = []; // em ordem de pintura (mais ao fim = mais por cima)
    const images: Box[] = [];
    const texts: Array<{ node: TextNode; box: Box | null }> = [];

    const walk = (nodes: DesignNode[], offX: number, offY: number): void => {
      for (const node of nodes) {
        const box = nodeBox(node, offX, offY);
        if (node.type === 'container') {
          if (isSolid(node.style?.background, document.tokens) && box) {
            surfaces.push({ box, lum: relLuminance(parseColor(node.style!.background, document.tokens)!) });
          }
          const nx = box ? box.x : offX;
          const ny = box ? box.y : offY;
          walk(node.children, nx, ny);
        } else if (node.type === 'shape') {
          if (isSolid(node.style?.background, document.tokens) && box) {
            surfaces.push({ box, lum: relLuminance(parseColor(node.style!.background, document.tokens)!) });
          }
        } else if (node.type === 'image') {
          if (box) images.push(box);
        } else if (node.type === 'text') {
          texts.push({ node, box });
        }
      }
    };
    walk(page.children, 0, 0);

    for (const { node, box } of texts) {
      let bgLum = pageLum;
      let overImage = false;

      if (box) {
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        const surf = [...surfaces].reverse().find((s) => centerIn(s.box, cx, cy));
        if (surf) {
          bgLum = surf.lum;
        } else if (images.some((b) => centerIn(b, cx, cy))) {
          overImage = true;
        }
      }

      if (overImage) {
        // Fundo desconhecido (foto): card branco + texto escuro garante leitura.
        ensureSmartContrast(node);
        setColor(node, DARK_TEXT);
        continue;
      }

      const cur = parseColor(node.style?.color, document.tokens);
      const curRatio = cur ? ratioFromLum(relLuminance(cur), bgLum) : 0;
      if (!cur || curRatio < MIN_RATIO) {
        // Escolhe preto ou branco — o que tiver melhor contraste com o fundo.
        const readable = ratioFromLum(relLuminance(parseColor(LIGHT_TEXT, document.tokens)!), bgLum) >=
          ratioFromLum(relLuminance(parseColor(DARK_TEXT, document.tokens)!), bgLum)
          ? LIGHT_TEXT
          : DARK_TEXT;
        setColor(node, readable);
      }
    }
  }
}
