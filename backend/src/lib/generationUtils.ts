import type { Layer } from './nanoBanana.js';

export function deduplicateLayerIds(layers: Layer[]): Layer[] {
  const seen = new Map<string, number>();
  return layers.map(layer => {
    const base = layer.id ?? 'layer';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? layer : { ...layer, id: `${base}-${count}` };
  });
}

function normalizeHex(hex: unknown): string | null {
  if (typeof hex !== 'string') return null;
  const clean = hex.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(clean)) return clean;
  if (/^#[0-9a-fA-F]{3}$/.test(clean)) {
    const chars = clean.slice(1).split('');
    return `#${chars.map((c) => c + c).join('')}`;
  }
  return null;
}

function luminance(hex: string): number {
  const normalized = normalizeHex(hex) ?? '#ffffff';
  const n = parseInt(normalized.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);
}

function contrastRatio(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function ensureTextContrast(layers: Layer[], backgroundColor: unknown): Layer[] {
  const bg = normalizeHex(backgroundColor) ?? '#ffffff';
  const hasPhotoOrImage = layers.some((layer) => layer?.type === 'image');

  return layers.map((layer) => {
    if (!layer || layer.type !== 'text') return layer;

    const shouldUseWhiteSurface = hasPhotoOrImage
      || layer.contrastBackground === true
      || contrastRatio('#000000', bg) < 4.5;

    return {
      ...layer,
      color: '#000000',
      contrastBackground: shouldUseWhiteSurface,
      contrastBackgroundColor: shouldUseWhiteSurface ? '#ffffff' : layer.contrastBackgroundColor,
      contrastBackgroundOpacity: shouldUseWhiteSurface ? 0.96 : layer.contrastBackgroundOpacity,
      contrastBackgroundRadius: shouldUseWhiteSurface
        ? Math.max(12, Math.round((layer.fontSize ?? 24) * 0.4))
        : layer.contrastBackgroundRadius,
      shadowColor: shouldUseWhiteSurface ? 'rgba(0,0,0,0.08)' : layer.shadowColor,
      shadowBlur: shouldUseWhiteSurface ? Math.max(layer.shadowBlur ?? 0, 10) : layer.shadowBlur,
    };
  });
}

export function finalizeSlideContrast<T extends { backgroundColor?: unknown; layers?: Layer[] }>(slide: T): T {
  return {
    ...slide,
    layers: ensureTextContrast(slide.layers ?? [], slide.backgroundColor),
  };
}
