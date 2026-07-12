// Compilador IR → HTML/CSS (render de referência no backend).
//
// Este é o renderizador de VERDADE do DesignIR: transforma um SlideNode em HTML
// posicionado, fiel à spec (não à implementação parcial do editor React, que
// hoje ignora gradiente/imagem de fundo, shapes e grupos). Destrava três coisas:
//   1. cache `htmlRender` dos slides IR (postHelper),
//   2. reviewer VISUAL do IR (rasteriza + modelo multimodal vê a arte),
//   3. futuros export/preview server-side.
//
// Modelo de caixa espelha o editor: cada elemento é um <div> absoluto
// (left/top/width/height, zIndex) com flexbox para alinhamento.

import type { SlideNode, ElementNode, ElementStyle, BackgroundDef, DesignTokens } from './types.js';

export interface CompiledSlide {
  html: string;
  css: string;
}

// ── Escaping ────────────────────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Sanitiza uma URL de src/background: bloqueia javascript:, permite http(s)/data:. */
function safeUrl(url: string | undefined): string | null {
  if (!url) return null;
  const u = url.trim();
  if (/^javascript:/i.test(u)) return null;
  if (/^(https?:|data:)/i.test(u) || u.startsWith('/')) return u.replace(/"/g, '%22');
  return null;
}

// ── Style helpers ─────────────────────────────────────────────────────────────
function px(v: number | undefined): string | null {
  return typeof v === 'number' && Number.isFinite(v) ? `${v}px` : null;
}

function dim(v: number | string | undefined): string | null {
  if (typeof v === 'number') return `${v}px`;
  if (typeof v === 'string' && v.trim()) return v;
  return null;
}

/** Converte um ElementStyle em declarações CSS (sem posicionamento). */
function typographyAndBox(style: ElementStyle): string[] {
  const d: string[] = [];
  const push = (prop: string, val: string | null) => { if (val) d.push(`${prop}:${val}`); };

  push('font-family', style.fontFamily ? `${style.fontFamily}, sans-serif` : null);
  push('font-size', px(style.fontSize));
  if (style.fontWeight !== undefined) push('font-weight', String(style.fontWeight));
  if (style.lineHeight !== undefined) push('line-height', String(style.lineHeight));
  push('letter-spacing', px(style.letterSpacing));
  push('text-align', style.textAlign ?? null);
  push('text-transform', style.textTransform ?? null);
  if (style.italic) push('font-style', 'italic');
  push('text-decoration', style.textDecoration ?? null);
  push('color', style.color ?? null);

  push('border-radius', dim(style.borderRadius));
  if (style.borderWidth) push('border', `${style.borderWidth}px ${style.borderStyle ?? 'solid'} ${style.borderColor ?? '#000'}`);
  push('box-shadow', style.boxShadow ?? null);
  push('backdrop-filter', style.backdropFilter ?? null);
  push('padding', dim(style.padding));
  if (typeof style.opacity === 'number') push('opacity', String(style.opacity));
  push('overflow', style.overflow ?? null);
  return d;
}

// ── Background ─────────────────────────────────────────────────────────────────
function renderBackground(bg: BackgroundDef | undefined): string {
  if (!bg) return '';
  const layers: string[] = [];
  const base = 'position:absolute;inset:0;z-index:0;';

  if (bg.type === 'solid' && bg.color) {
    layers.push(`<div style="${base}background:${escapeHtml(bg.color)};"></div>`);
  } else if (bg.type === 'gradient' && bg.gradient) {
    layers.push(`<div style="${base}background:${escapeHtml(bg.gradient)};"></div>`);
  } else if (bg.type === 'image') {
    const src = safeUrl(bg.src);
    if (src) {
      layers.push(`<div style="${base}background-image:url(&quot;${src}&quot;);background-size:cover;background-position:center;"></div>`);
    } else if (bg.color) {
      layers.push(`<div style="${base}background:${escapeHtml(bg.color)};"></div>`);
    }
  }

  // Overlay opcional (cor ou gradiente por cima do fundo, atrás dos elementos).
  if (bg.overlay) {
    layers.push(`<div style="position:absolute;inset:0;z-index:0;background:${escapeHtml(bg.overlay)};"></div>`);
  }
  return layers.join('');
}

// ── Elementos ──────────────────────────────────────────────────────────────────
function positionStyle(el: ElementNode): string {
  const b = el.bounds;
  const parts = [
    'position:absolute',
    `left:${Math.round(b?.x ?? 0)}px`,
    `top:${Math.round(b?.y ?? 0)}px`,
    `width:${Math.round(b?.width ?? 0)}px`,
    `height:${Math.round(b?.height ?? 0)}px`,
    `z-index:${el.zIndex ?? 1}`,
  ];
  if (b?.rotation) parts.push(`transform:rotate(${b.rotation}deg)`);
  if (el.visible === false) parts.push('display:none');
  return parts.join(';');
}

function renderElement(el: ElementNode): string {
  if (!el) return '';

  // Grupos: achatamos os filhos como elementos absolutos (bounds em coords do
  // canvas), evitando bugs de offset duplo. Espelha o flatten do reviewer.
  if (el.type === 'group') {
    return (el.children ?? []).map(renderElement).join('');
  }

  const style = el.style ?? {};

  if (el.type === 'text') {
    const inner = typographyAndBox(style);
    const flex = [
      'display:flex',
      `align-items:${style.alignItems ?? 'flex-start'}`,
      `justify-content:${style.justifyContent ?? 'flex-start'}`,
    ];
    const bg = style.background || style.backgroundColor;
    const wrap = `${positionStyle(el)};${flex.join(';')};${bg ? `background:${escapeHtml(bg)};` : ''}${style.borderRadius ? `border-radius:${dim(style.borderRadius)};` : ''}`;
    const content = escapeHtml(el.content ?? '').replace(/\n/g, '<br>');
    return `<div style="${wrap}"><div style="width:100%;${inner.join(';')}">${content}</div></div>`;
  }

  if (el.type === 'image') {
    const src = safeUrl(el.src);
    const fit = style.objectFit ?? 'cover';
    const wrap = `${positionStyle(el)};overflow:hidden;${style.borderRadius ? `border-radius:${dim(style.borderRadius)};` : ''}${typeof style.opacity === 'number' ? `opacity:${style.opacity};` : ''}`;
    if (!src) {
      // Sem src válido: bloco neutro (o assetValidator já deveria ter corrigido).
      return `<div style="${wrap}background:#e5e7eb;"></div>`;
    }
    return `<div style="${wrap}"><img src="${src}" alt="" style="width:100%;height:100%;object-fit:${fit};display:block;"/></div>`;
  }

  if (el.type === 'shape') {
    const color = style.background || style.backgroundColor || style.color || '#000000';
    let shapeCss = '';
    switch (el.shapeType) {
      case 'circle': shapeCss = 'border-radius:50%;'; break;
      case 'triangle': shapeCss = 'clip-path:polygon(50% 0,100% 100%,0 100%);'; break;
      case 'line': shapeCss = ''; break; // usa a própria altura como espessura
      default: shapeCss = style.borderRadius ? `border-radius:${dim(style.borderRadius)};` : '';
    }
    const opacity = typeof style.opacity === 'number' ? `opacity:${style.opacity};` : '';
    const shadow = style.boxShadow ? `box-shadow:${style.boxShadow};` : '';
    return `<div style="${positionStyle(el)};background:${escapeHtml(color)};${shapeCss}${opacity}${shadow}"></div>`;
  }

  return '';
}

/**
 * Compila um slide IR em { html, css }. `html` é o conteúdo interno de um
 * container relative (fundo + elementos, ordenados por zIndex). Estilos são
 * inline para evitar colisão de classes.
 */
export function compileSlide(slide: SlideNode, _tokens?: DesignTokens, _fonts?: string[]): CompiledSlide {
  const bg = renderBackground(slide.background);
  const els = [...(slide.elements ?? [])]
    .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    .map(renderElement)
    .join('');
  return { html: `${bg}${els}`, css: '' };
}

// ── Documento completo (para rasterizar/preview) ───────────────────────────────
function googleFontsHref(fonts: string[]): string {
  const families = (fonts ?? [])
    .filter((f) => typeof f === 'string' && f.trim() && /^[\w\s]+$/.test(f.trim()))
    .slice(0, 4)
    .map((f) => `family=${encodeURIComponent(f.trim())}:wght@300;400;500;600;700;800;900`);
  if (families.length === 0) families.push('family=Inter:wght@400;500;700;800');
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
}

/** Documento HTML completo de um slide IR, com Google Fonts — pronto para chromium. */
export function compileSlideToDocument(slide: SlideNode, fonts: string[], width: number, height: number): string {
  const { html, css } = compileSlide(slide, undefined, fonts);
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${googleFontsHref(fonts)}" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:${width}px;height:${height}px;overflow:hidden;}
.slide-root{width:${width}px;height:${height}px;position:relative;overflow:hidden;}
${css}
</style></head>
<body><div class="slide-root">${html}</div></body></html>`;
}
