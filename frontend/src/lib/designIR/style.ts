// ═══════════════════════════════════════════════════════════════════════════════
// Design IR — estilo (espelho do compilador do backend)
// ═══════════════════════════════════════════════════════════════════════════════
// Traduz um SlideNode em CSS, com a MESMA semântica de `backend/src/lib/designIR/
// compiler.ts` — que é o renderizador de verdade (o que vira PNG no export e o que o
// reviewer visual enxerga).
//
// Por que isto existe: o canvas do editor desenhava à mão 11 propriedades de estilo
// (fontFamily, fontSize, fontWeight, color, textAlign, display, alignItems,
// justifyContent, background, borderRadius, objectFit). Sombra, rotação, opacidade,
// letterSpacing, borda, gradiente de fundo, shapes e grupos NÃO eram desenhados.
// Mas o sanitizador da IA aceita qualquer CSS. Resultado: "adiciona uma sombra no
// título" era gravado no IR, aparecia no PNG exportado, e NÃO aparecia na tela — a IA
// parecia estar mentindo. Um renderizador só mata isso.
//
// ⚠️ Espelho de `backend/src/lib/designIR/compiler.ts`. Mudou lá, muda aqui.

import type { CSSProperties } from 'react';
import type { ElementNode, ElementStyle, BackgroundDef } from './types';

/** Bloqueia `javascript:`; permite http(s), data: e caminhos absolutos. */
export function safeUrl(url: string | undefined): string | null {
  if (!url) return null;
  const u = url.trim();
  if (/^javascript:/i.test(u)) return null;
  if (/^(https?:|data:)/i.test(u) || u.startsWith('/')) return u;
  return null;
}

function dim(v: number | string | undefined): string | number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim()) return v;
  return undefined;
}

/** Tipografia e caixa — tudo que o compilador põe no <div> interno do texto. */
export function typographyAndBox(style: ElementStyle): CSSProperties {
  const css: CSSProperties = {
    fontFamily: style.fontFamily ? `${style.fontFamily}, sans-serif` : undefined,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    textAlign: style.textAlign,
    textTransform: style.textTransform,
    fontStyle: style.italic ? 'italic' : undefined,
    textDecoration: style.textDecoration,
    color: style.color,
    borderRadius: dim(style.borderRadius),
    boxShadow: style.boxShadow,
    backdropFilter: style.backdropFilter,
    padding: dim(style.padding),
    opacity: style.opacity,
    overflow: style.overflow,
  };
  if (style.borderWidth) {
    css.border = `${style.borderWidth}px ${style.borderStyle ?? 'solid'} ${style.borderColor ?? '#000'}`;
  }
  return css;
}

/** Posição/caixa absoluta do elemento no canvas (inclui rotação e visibilidade). */
export function positionStyle(el: ElementNode): CSSProperties {
  const b = el.bounds;
  return {
    position: 'absolute',
    left: Math.round(b?.x ?? 0),
    top: Math.round(b?.y ?? 0),
    width: Math.round(b?.width ?? 0),
    height: Math.round(b?.height ?? 0),
    zIndex: el.zIndex ?? 1,
    transform: b?.rotation ? `rotate(${b.rotation}deg)` : undefined,
    display: el.visible === false ? 'none' : undefined,
  };
}

/**
 * Camadas de fundo do slide, na ordem. O compilador emite divs absolutos em z-index 0
 * (fundo + overlay opcional) ATRÁS dos elementos — não um `background` no container,
 * senão o overlay não teria como existir.
 */
export function backgroundLayers(bg: BackgroundDef | undefined): CSSProperties[] {
  if (!bg) return [];
  const base: CSSProperties = { position: 'absolute', inset: 0, zIndex: 0 };
  const layers: CSSProperties[] = [];

  if (bg.type === 'solid' && bg.color) {
    layers.push({ ...base, background: bg.color });
  } else if (bg.type === 'gradient' && bg.gradient) {
    layers.push({ ...base, background: bg.gradient });
  } else if (bg.type === 'image') {
    const src = safeUrl(bg.src);
    if (src) {
      layers.push({
        ...base,
        backgroundImage: `url("${src}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      });
    } else if (bg.color) {
      layers.push({ ...base, background: bg.color });
    }
  }

  if (bg.overlay) layers.push({ ...base, background: bg.overlay });
  return layers;
}

/** Caixa externa de um elemento de TEXTO: posição + flex + fundo + raio. */
export function textWrapperStyle(el: ElementNode): CSSProperties {
  const style = el.style ?? {};
  return {
    ...positionStyle(el),
    display: el.visible === false ? 'none' : 'flex',
    alignItems: style.alignItems ?? 'flex-start',
    justifyContent: style.justifyContent ?? 'flex-start',
    background: style.background || style.backgroundColor || undefined,
    borderRadius: dim(style.borderRadius),
  };
}

export function imageWrapperStyle(el: ElementNode): CSSProperties {
  const style = el.style ?? {};
  return {
    ...positionStyle(el),
    overflow: 'hidden',
    borderRadius: dim(style.borderRadius),
    opacity: style.opacity,
  };
}

/** Um shape é um div com fundo + o recorte da sua forma. */
export function shapeStyle(el: ElementNode): CSSProperties {
  const style = el.style ?? {};
  const color = style.background || style.backgroundColor || style.color || '#000000';
  const css: CSSProperties = {
    ...positionStyle(el),
    background: color,
    opacity: style.opacity,
    boxShadow: style.boxShadow,
  };

  switch (el.shapeType) {
    case 'circle':
      css.borderRadius = '50%';
      break;
    case 'triangle':
      css.clipPath = 'polygon(50% 0, 100% 100%, 0 100%)';
      break;
    case 'line':
      break; // usa a própria altura como espessura
    default:
      css.borderRadius = dim(style.borderRadius);
  }
  return css;
}

/**
 * Achata os grupos: os filhos têm bounds em coordenadas do canvas, então renderizá-los
 * dentro de um container do grupo daria offset duplo. O compilador faz o mesmo.
 */
export function flattenElements(elements: ElementNode[] | undefined): ElementNode[] {
  const saida: ElementNode[] = [];
  for (const el of elements ?? []) {
    if (!el) continue;
    if (el.type === 'group') saida.push(...flattenElements(el.children));
    else saida.push(el);
  }
  return saida;
}

/** Elementos prontos para desenhar: grupos achatados e ordenados por zIndex. */
export function drawableElements(elements: ElementNode[] | undefined): ElementNode[] {
  return flattenElements(elements).sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
}
