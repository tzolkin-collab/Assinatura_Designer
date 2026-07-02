import type { CSSProperties } from 'react';
import type { Layer } from '@/components/Fabrica/DesignRenderer';

function hexToRgba(hex: string, opacity: number): string {
  const clean = hex.replace('#', '').trim();
  const normalized = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean;
  const value = parseInt(normalized, 16);
  if (!Number.isFinite(value)) return `rgba(0, 0, 0, ${opacity})`;
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export interface LayerStyleResult {
  /** Visual styles: opacity, background, border, shadow, rotation, overflow.
   *  Applied to the direct child inside the animation/position wrapper. */
  outer: CSSProperties;
  /** Text-content styles. Only meaningful for type === 'text'. */
  inner: CSSProperties;
}

/** Compute CSS for any Layer. Pure function — no React, no side effects. */
export function computeLayerStyle(layer: Layer): LayerStyleResult {
  // ── Background / fill ──────────────────────────────────────────────────────
  const hasGradient =
    layer.type === 'shape' &&
    layer.gradientType != null &&
    layer.gradientType !== 'none' &&
    Boolean(layer.gradientColor2);

  let background: string | undefined;
  if (layer.type === 'shape') {
    background = hasGradient
      ? layer.gradientType === 'radial'
        ? `radial-gradient(circle, ${layer.color ?? '#ccc'} 0%, ${layer.gradientColor2} 100%)`
        : `linear-gradient(${layer.gradientAngle ?? 90}deg, ${layer.color ?? '#ccc'} 0%, ${layer.gradientColor2} 100%)`
      : (layer.color ?? '#cccccc');
  }

  // ── Shadow ─────────────────────────────────────────────────────────────────
  const hasShadow = Boolean(
    layer.shadowColor && (layer.shadowBlur || layer.shadowOffsetX || layer.shadowOffsetY),
  );
  const shadowStr = hasShadow
    ? `${layer.shadowOffsetX ?? 0}px ${layer.shadowOffsetY ?? 0}px ${layer.shadowBlur ?? 0}px ${layer.shadowColor}`
    : undefined;

  // ── Outer ──────────────────────────────────────────────────────────────────
  let clipPath: string | undefined;
  if (layer.type === 'shape') {
    if (layer.shapeType === 'triangle') clipPath = 'polygon(50% 0%, 0% 100%, 100% 100%)';
    if (layer.shapeType === 'polygon') clipPath = 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)';
    if (layer.shapeType === 'star') clipPath = 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)';
  }

  const outer: CSSProperties = {
    width: '100%',
    height: '100%',
    opacity: layer.opacity ?? 1,
    ...(layer.borderRadius != null ? { borderRadius: layer.borderRadius } : {}),
    ...(layer.borderWidth != null
      ? { 
          borderWidth: `${layer.borderWidth}px`,
          borderStyle: layer.strokeStyle ?? 'solid',
          borderColor: layer.borderColor ?? '#000'
        }
      : {}),
    ...(layer.rotation ? { transform: `rotate(${layer.rotation}deg)` } : {}),
    overflow: layer.type === 'image' ? 'hidden' : 'visible',
    ...(background !== undefined ? { background } : {}),
    ...(layer.type !== 'text' && shadowStr ? { boxShadow: shadowStr } : {}),
    ...(clipPath ? { clipPath, WebkitClipPath: clipPath } : {}),
  };

  // ── Inner (text only) ──────────────────────────────────────────────────────
  const normalizedTextBgOpacity = typeof layer.contrastBackgroundOpacity === 'number' && Number.isFinite(layer.contrastBackgroundOpacity)
    ? Math.max(0, Math.min(1, layer.contrastBackgroundOpacity))
    : 0.72;
  const textBgOpacity = normalizedTextBgOpacity;
  const textBgColor = layer.contrastBackgroundColor ?? '#000000';

  const inner: CSSProperties =
    layer.type === 'text'
      ? {
          width: '100%',
          height: '100%',
          color: layer.color ?? '#000000',
          fontFamily: layer.fontFamily ?? 'sans-serif',
          fontSize: layer.fontSize ?? 14,
          fontWeight: layer.fontWeight ?? 'normal',
          fontStyle: layer.italic ? 'italic' : 'normal',
          ...(layer.textDecoration && layer.textDecoration !== 'none'
            ? { textDecoration: layer.textDecoration }
            : {}),
          ...(layer.letterSpacing != null ? { letterSpacing: `${layer.letterSpacing}px` } : {}),
          lineHeight: layer.lineHeight ?? 1.3,
          textAlign: layer.textAlign ?? 'left',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflow: 'visible',
          display: 'flex',
          flexDirection: 'column',
          alignItems: (layer.textAlign === 'center') ? 'center' : (layer.textAlign === 'right' ? 'flex-end' : 'flex-start'),
          justifyContent: (layer.verticalAlign === 'middle') ? 'center' : (layer.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start'),
          ...(layer.contrastBackground
            ? {
                background: hexToRgba(textBgColor, textBgOpacity),
                borderRadius: layer.contrastBackgroundRadius ?? Math.max(10, Math.round((layer.fontSize ?? 14) * 0.35)),
                padding: `${Math.max(6, Math.round((layer.fontSize ?? 14) * 0.18))}px ${Math.max(10, Math.round((layer.fontSize ?? 14) * 0.32))}px`,
                boxSizing: 'border-box',
              }
            : {}),
          ...(shadowStr ? { textShadow: shadowStr } : {}),
        }
      : {};

  return { outer, inner };
}

/** Build the position + size styles (used alongside outer by consumers). */
export function layerPositionStyle(layer: Layer, index: number): CSSProperties {
  return {
    position: 'absolute',
    left: layer.x,
    top: layer.y,
    width: layer.width,
    height: layer.height,
    zIndex: layer.zIndex ?? index,
  };
}
