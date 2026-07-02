import type { CSSProperties } from 'react';
import type { Behavior, DesignTokens, LayoutStyle, Paint, TextStyle, VisualStyle } from './types';

const NAMED_TOKEN_COLORS = new Set(['background', 'surface', 'text', 'muted', 'accent', 'accent2']);
const SYSTEM_FONT_KEYS = new Set(['display', 'heading', 'body']);
const CSS_LENGTH_PATTERN = /^(\d+(\.\d+)?)(px|%|rem|em|vh|vw|vmin|vmax|fr)$/;
const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_COLOR_PATTERN = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(\s*,\s*(0|1|0?\.\d+))?\s*\)$/i;
const HSL_COLOR_PATTERN = /^hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(\s*,\s*(0|1|0?\.\d+))?\s*\)$/i;

const SHADOWS = {
  none: 'none',
  soft: '0 18px 48px rgba(23, 19, 14, 0.12)',
  premium: '0 28px 80px rgba(20, 16, 12, 0.2)',
  dramatic: '0 36px 110px rgba(0, 0, 0, 0.34)',
} satisfies Record<string, string>;

const ALIGN_ITEMS = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
} satisfies Record<string, CSSProperties['alignItems']>;

const JUSTIFY_CONTENT = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  'space-between': 'space-between',
} satisfies Record<string, CSSProperties['justifyContent']>;

export function sanitizeImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('data:image/')) return trimmed;
  if (lower.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  return null;
}

export function resolvePaint(value: unknown, tokens: DesignTokens): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (NAMED_TOKEN_COLORS.has(trimmed)) return tokens.colors[trimmed as keyof DesignTokens['colors']];
  if (HEX_COLOR_PATTERN.test(trimmed) || RGB_COLOR_PATTERN.test(trimmed) || HSL_COLOR_PATTERN.test(trimmed)) return trimmed;
  if (trimmed.startsWith('linear-gradient(') && !trimmed.includes('url(') && !trimmed.includes(';')) return trimmed;
  return undefined;
}

export function safeBackgroundImage(value: Paint | undefined, tokens: DesignTokens): CSSProperties['backgroundImage'] {
  const paint = resolvePaint(value, tokens);
  if (!paint) return undefined;
  if (paint.startsWith('linear-gradient(')) return paint;
  return undefined;
}

export function safeBackgroundColor(value: Paint | undefined, tokens: DesignTokens): CSSProperties['backgroundColor'] {
  const paint = resolvePaint(value, tokens);
  if (!paint || paint.startsWith('linear-gradient(')) return undefined;
  return paint;
}

export function layoutToStyle(layout: LayoutStyle | undefined): CSSProperties {
  if (!layout) return {};
  const style: CSSProperties = {};

  if (layout.position === 'absolute') {
    style.position = 'absolute';
    if (typeof layout.x === 'number' && Number.isFinite(layout.x)) style.left = layout.x;
    if (typeof layout.y === 'number' && Number.isFinite(layout.y)) style.top = layout.y;
  }
  if (layout.position === 'relative') {
    style.position = 'relative';
  }

  const width = safeSize(layout.width);
  const height = safeSize(layout.height);
  if (width !== undefined) style.width = width;
  if (height !== undefined) style.height = height;

  if (layout.display === 'flex') {
    style.display = 'flex';
    if (layout.direction === 'row' || layout.direction === 'column') style.flexDirection = layout.direction;
    if (layout.alignItems) style.alignItems = ALIGN_ITEMS[layout.alignItems];
    if (layout.justifyContent) style.justifyContent = JUSTIFY_CONTENT[layout.justifyContent];
  }
  if (layout.display === 'grid') {
    style.display = 'grid';
    if (Array.isArray(layout.columns) && layout.columns.length > 0) style.gridTemplateColumns = layout.columns.map(safeTrack).filter(Boolean).join(' ');
    if (Array.isArray(layout.rows) && layout.rows.length > 0) style.gridTemplateRows = layout.rows.map(safeTrack).filter(Boolean).join(' ');
    if (layout.alignItems) style.alignItems = ALIGN_ITEMS[layout.alignItems];
    if (layout.justifyContent) style.justifyContent = JUSTIFY_CONTENT[layout.justifyContent];
  }
  if (layout.display === 'block') {
    style.display = 'block';
  }

  if (typeof layout.gap === 'number' && Number.isFinite(layout.gap) && layout.gap >= 0) style.gap = layout.gap;
  const padding = safePadding(layout.padding);
  if (padding !== undefined) style.padding = padding;

  return style;
}

export function visualToStyle(style: VisualStyle | undefined, tokens: DesignTokens): CSSProperties {
  if (!style) return {};
  const result: CSSProperties = {};
  const backgroundColor = safeBackgroundColor(style.background, tokens);
  const backgroundImage = safeBackgroundImage(style.background, tokens);
  const color = resolvePaint(style.color, tokens);
  const borderColor = resolvePaint(style.borderColor, tokens);

  if (backgroundColor) result.backgroundColor = backgroundColor;
  if (backgroundImage) result.backgroundImage = backgroundImage;
  if (color) result.color = color;
  if (borderColor && typeof style.borderWidth === 'number' && style.borderWidth >= 0) {
    result.borderWidth = `${style.borderWidth}px`;
    result.borderStyle = 'solid';
    result.borderColor = borderColor;
  }
  if (typeof style.borderRadius === 'number' && Number.isFinite(style.borderRadius) && style.borderRadius >= 0) result.borderRadius = style.borderRadius;
  if (typeof style.opacity === 'number' && Number.isFinite(style.opacity)) result.opacity = Math.max(0, Math.min(1, style.opacity));
  if (style.shadow && style.shadow in SHADOWS) result.boxShadow = SHADOWS[style.shadow];

  return result;
}

export function textToStyle(style: TextStyle | undefined, tokens: DesignTokens, behaviors: Behavior[] | undefined): CSSProperties {
  const result: CSSProperties = {
    ...visualToStyle(style, tokens),
  };

  if (style?.fontFamily) result.fontFamily = safeFont(style.fontFamily, tokens);
  if (typeof style?.fontSize === 'number' && style.fontSize > 0) result.fontSize = style.fontSize;
  if (typeof style?.fontWeight === 'number' || typeof style?.fontWeight === 'string') result.fontWeight = style.fontWeight;
  if (typeof style?.lineHeight === 'number' && style.lineHeight > 0) result.lineHeight = style.lineHeight;
  if (typeof style?.letterSpacing === 'number' && Number.isFinite(style.letterSpacing)) result.letterSpacing = style.letterSpacing;
  if (style?.textAlign) result.textAlign = style.textAlign;
  if (style?.textTransform) result.textTransform = style.textTransform;

  const fit = behaviors?.find((behavior) => behavior.type === 'auto-fit-text');
  if (fit?.type === 'auto-fit-text') {
    const min = Math.max(8, Math.min(120, fit.min));
    const max = Math.max(min, Math.min(180, fit.max));
    result.fontSize = `clamp(${min}px, 7.8vw, ${max}px)`;
  }

  if (behaviors?.some((behavior) => behavior.type === 'balance-lines')) result.textWrap = 'balance';

  return result;
}

export function focalPointToObjectPosition(behaviors: Behavior[] | undefined): CSSProperties['objectPosition'] {
  const focal = behaviors?.find((behavior) => behavior.type === 'image-focal-point');
  if (focal?.type !== 'image-focal-point') return 'center';
  const x = Math.max(0, Math.min(100, focal.x));
  const y = Math.max(0, Math.min(100, focal.y));
  return `${x}% ${y}%`;
}

export function tokenVars(tokens: DesignTokens): CSSProperties {
  return {
    '--dd-color-background': resolvePaint(tokens.colors.background, tokens) ?? '#f7f0e8',
    '--dd-color-surface': resolvePaint(tokens.colors.surface, tokens) ?? '#ffffff',
    '--dd-color-text': resolvePaint(tokens.colors.text, tokens) ?? '#000000',
    '--dd-color-muted': resolvePaint(tokens.colors.muted, tokens) ?? '#6f665c',
    '--dd-color-accent': resolvePaint(tokens.colors.accent, tokens) ?? '#b95e3d',
    '--dd-color-accent-2': resolvePaint(tokens.colors.accent2, tokens) ?? resolvePaint(tokens.colors.accent, tokens) ?? '#b95e3d',
    '--dd-font-display': safeFont(tokens.typography.display, tokens),
    '--dd-font-heading': safeFont(tokens.typography.heading, tokens),
    '--dd-font-body': safeFont(tokens.typography.body, tokens),
    '--dd-space-page': `${Math.max(0, tokens.spacing.page)}px`,
    '--dd-space-section': `${Math.max(0, tokens.spacing.section)}px`,
    '--dd-space-gap': `${Math.max(0, tokens.spacing.gap)}px`,
    '--dd-radius-sm': `${Math.max(0, tokens.radius.sm)}px`,
    '--dd-radius-md': `${Math.max(0, tokens.radius.md)}px`,
    '--dd-radius-lg': `${Math.max(0, tokens.radius.lg)}px`,
  } as CSSProperties;
}

function safeSize(value: LayoutStyle['width'] | LayoutStyle['height']): CSSProperties['width'] | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return undefined;
    return value;
  }
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === 'auto' || trimmed === '100%' || CSS_LENGTH_PATTERN.test(trimmed)) return trimmed;
  return undefined;
}

function safeTrack(value: string): string {
  const trimmed = value.trim();
  if (trimmed === 'auto') return trimmed;
  if (CSS_LENGTH_PATTERN.test(trimmed)) return trimmed;
  if (/^minmax\((\d+(\.\d+)?)(px|%|rem|em|fr),\s*(\d+(\.\d+)?)(px|%|rem|em|fr)\)$/.test(trimmed)) return trimmed;
  return '';
}

function safePadding(value: LayoutStyle['padding']): CSSProperties['padding'] | undefined {
  if (typeof value === 'number') return value >= 0 ? value : undefined;
  if (!value) return undefined;
  const { top, right, bottom, left } = value;
  if ([top, right, bottom, left].every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0)) {
    return `${top}px ${right}px ${bottom}px ${left}px`;
  }
  return undefined;
}

function safeFont(value: string, tokens: DesignTokens) {
  const trimmed = value.trim();
  if (SYSTEM_FONT_KEYS.has(trimmed)) return tokens.typography[trimmed as keyof DesignTokens['typography']];
  if (/^[\w\s,'-]+$/.test(trimmed)) return trimmed;
  return 'var(--font-sans)';
}
