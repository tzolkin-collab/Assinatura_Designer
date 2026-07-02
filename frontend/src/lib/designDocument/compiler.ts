import type { DesignPage, Layer } from '@/components/Fabrica/DesignRenderer';
import type { DesignNode, DesignPageNode, DesignTokens, ImageNode, Insets, LayoutStyle, PageZone, ShapeNode, SlideRect, TextNode, VisualStyle } from './types';
import { isDesignDocument } from './guards';
import { resolvePaint, sanitizeImageUrl } from './styles';

type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PageGeometry = {
  safeArea: Insets;
  contentInsets: Insets;
  textZones: PageZone[];
  reservedZones: PageZone[];
};

type CompileContext = {
  tokens: DesignTokens;
  pageWidth: number;
  pageHeight: number;
  zIndex: number;
  warnings: string[];
  pageGeometry: PageGeometry;
};

export type CompileDesignDocumentResult = {
  pages: DesignPage[];
  warnings: string[];
};

const MIN_LAYER_SIZE = 1;
const DEFAULT_TEXT_HEIGHT = 96;
const DEFAULT_NODE_HEIGHT = 180;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeInsets(value: Insets | undefined, fallback: Insets): Insets {
  if (!value) return fallback;
  return {
    top: Math.max(0, Math.round(value.top ?? fallback.top)),
    right: Math.max(0, Math.round(value.right ?? fallback.right)),
    bottom: Math.max(0, Math.round(value.bottom ?? fallback.bottom)),
    left: Math.max(0, Math.round(value.left ?? fallback.left)),
  };
}

function rectFromInsets(width: number, height: number, insets: Insets): SlideRect {
  return {
    x: insets.left,
    y: insets.top,
    width: Math.max(MIN_LAYER_SIZE, width - insets.left - insets.right),
    height: Math.max(MIN_LAYER_SIZE, height - insets.top - insets.bottom),
  };
}

function rectContains(outer: SlideRect, inner: SlideRect): boolean {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

function rectsOverlap(a: SlideRect, b: SlideRect): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

function defaultSafeArea(width: number, height: number): Insets {
  if (width >= 1800 || height >= 1000) return { top: 60, right: 80, bottom: 60, left: 80 };
  return { top: 60, right: 60, bottom: 60, left: 60 };
}

function derivePageGeometry(page: DesignPageNode, pageWidth: number, pageHeight: number): PageGeometry {
  const safeArea = normalizeInsets(page.safeArea, defaultSafeArea(pageWidth, pageHeight));
  const contentInsets = normalizeInsets(page.contentInsets, safeArea);
  const contentRect = rectFromInsets(pageWidth, pageHeight, contentInsets);
  return {
    safeArea,
    contentInsets,
    textZones: page.textZones?.length
      ? page.textZones.map((zone) => ({ ...zone }))
      : [{ id: 'content', ...contentRect, roles: ['*'], allowOverlap: false }],
    reservedZones: page.reservedZones?.map((zone) => ({ ...zone })) ?? [],
  };
}

function zoneAllowsNode(zone: PageZone, node: TextNode): boolean {
  if (Array.isArray(zone.nodeIds) && zone.nodeIds.length > 0) return zone.nodeIds.includes(node.id);
  if (!Array.isArray(zone.roles) || zone.roles.length === 0) return false;
  if (!node.role) return zone.roles.includes('*');
  return zone.roles.includes(node.role) || zone.roles.includes('*');
}

function resolveTextParent(node: TextNode, parent: Box, ctx: CompileContext): Box {
  const compatibleZone = ctx.pageGeometry.textZones.find((zone) => zoneAllowsNode(zone, node) && rectContains(parent, zone))
    ?? ctx.pageGeometry.textZones.find((zone) => zoneAllowsNode(zone, node));
  if (!compatibleZone) return parent;
  return {
    x: compatibleZone.x,
    y: compatibleZone.y,
    width: compatibleZone.width,
    height: compatibleZone.height,
  };
}

function resolveSize(value: LayoutStyle['width'] | LayoutStyle['height'], parentSize: number, fallback: number) {
  if (isFiniteNumber(value)) return Math.max(MIN_LAYER_SIZE, value);
  if (typeof value !== 'string') return Math.max(MIN_LAYER_SIZE, fallback);

  const trimmed = value.trim();
  if (trimmed === '100%') return parentSize;
  if (trimmed.endsWith('%')) {
    const ratio = Number(trimmed.slice(0, -1));
    return Number.isFinite(ratio) ? Math.max(MIN_LAYER_SIZE, parentSize * (ratio / 100)) : Math.max(MIN_LAYER_SIZE, fallback);
  }
  if (trimmed.endsWith('px')) {
    const px = Number(trimmed.slice(0, -2));
    return Number.isFinite(px) ? Math.max(MIN_LAYER_SIZE, px) : Math.max(MIN_LAYER_SIZE, fallback);
  }

  return Math.max(MIN_LAYER_SIZE, fallback);
}

function getPadding(layout?: LayoutStyle) {
  const padding = layout?.padding;
  if (isFiniteNumber(padding)) return { top: padding, right: padding, bottom: padding, left: padding };
  if (padding && typeof padding === 'object') return padding;
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

function layoutToBox(layout: LayoutStyle | undefined, parent: Box, fallbackHeight = DEFAULT_NODE_HEIGHT): Box {
  const padding = getPadding(layout);
  const availableWidth = Math.max(MIN_LAYER_SIZE, parent.width - padding.left - padding.right);
  const availableHeight = Math.max(MIN_LAYER_SIZE, parent.height - padding.top - padding.bottom);
  const width = resolveSize(layout?.width, availableWidth, availableWidth);
  const height = resolveSize(layout?.height, availableHeight, fallbackHeight);
  const x = parent.x + padding.left + (isFiniteNumber(layout?.x) ? layout.x : 0);
  const y = parent.y + padding.top + (isFiniteNumber(layout?.y) ? layout.y : 0);

  return {
    x: clamp(Math.round(x), 0, Math.max(0, parent.x + parent.width - MIN_LAYER_SIZE)),
    y: clamp(Math.round(y), 0, Math.max(0, parent.y + parent.height - MIN_LAYER_SIZE)),
    width: Math.round(clamp(width, MIN_LAYER_SIZE, Math.max(MIN_LAYER_SIZE, parent.x + parent.width - x))),
    height: Math.round(clamp(height, MIN_LAYER_SIZE, Math.max(MIN_LAYER_SIZE, parent.y + parent.height - y))),
  };
}

function applyVisualStyle(layer: Layer, style: VisualStyle | undefined, tokens: DesignTokens): Layer {
  const background = resolvePaint(style?.background, tokens);
  const borderColor = resolvePaint(style?.borderColor, tokens);
  const next: Layer = { ...layer };

  if (background && !background.startsWith('linear-gradient(')) next.color = background;
  if (isFiniteNumber(style?.borderRadius)) next.borderRadius = Math.max(0, style.borderRadius);
  if (isFiniteNumber(style?.opacity)) next.opacity = clamp(style.opacity, 0, 1);
  if (borderColor && isFiniteNumber(style?.borderWidth)) {
    next.borderColor = borderColor;
    next.borderWidth = Math.max(0, style.borderWidth);
    next.strokeStyle = 'solid';
  }
  if (style?.shadow === 'soft') {
    next.shadowColor = 'rgba(23, 19, 14, 0.18)';
    next.shadowBlur = 24;
  }
  if (style?.shadow === 'premium') {
    next.shadowColor = 'rgba(20, 16, 12, 0.24)';
    next.shadowBlur = 38;
  }
  if (style?.shadow === 'dramatic') {
    next.shadowColor = 'rgba(0, 0, 0, 0.34)';
    next.shadowBlur = 52;
  }

  return next;
}

function nextZ(ctx: CompileContext) {
  ctx.zIndex += 1;
  return ctx.zIndex;
}

function compileTextNode(node: TextNode, parent: Box, ctx: CompileContext): Layer[] {
  const resolvedParent = resolveTextParent(node, parent, ctx);
  const box = layoutToBox(node.layout, resolvedParent, DEFAULT_TEXT_HEIGHT);
  const roleFontSize = node.role === 'headline' ? 72 : node.role === 'subtitle' ? 38 : node.role === 'caption' || node.role === 'eyebrow' ? 22 : 30;
  const fontFamily = node.style?.fontFamily === 'display'
    ? ctx.tokens.typography.display
    : node.style?.fontFamily === 'heading'
      ? ctx.tokens.typography.heading
      : node.style?.fontFamily === 'body'
        ? ctx.tokens.typography.body
        : node.style?.fontFamily ?? ctx.tokens.typography.body;

  const layer: Layer = {
    id: node.id,
    type: 'text',
    content: node.content,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    color: '#000000',
    fontFamily,
    fontSize: node.style?.fontSize ?? roleFontSize,
    fontWeight: String(node.style?.fontWeight ?? (node.role === 'headline' ? 800 : node.role === 'eyebrow' ? 700 : 400)),
    lineHeight: node.style?.lineHeight ?? 1.12,
    letterSpacing: node.style?.letterSpacing,
    textAlign: node.style?.textAlign ?? 'left',
    zIndex: nextZ(ctx),
  };

  const nextLayer = applyVisualStyle(layer, node.style, ctx.tokens);
  const layerRect: SlideRect = { x: nextLayer.x, y: nextLayer.y, width: nextLayer.width, height: nextLayer.height };
  const safeRect = rectFromInsets(ctx.pageWidth, ctx.pageHeight, ctx.pageGeometry.safeArea);
  const contentRect = rectFromInsets(ctx.pageWidth, ctx.pageHeight, ctx.pageGeometry.contentInsets);
  if (!rectContains(safeRect, layerRect)) ctx.warnings.push(`text-out-of-safe-area:${node.id}`);
  if (!rectContains(contentRect, layerRect)) ctx.warnings.push(`text-out-of-content-area:${node.id}`);
  for (const reserved of ctx.pageGeometry.reservedZones) {
    if (rectsOverlap(layerRect, reserved) && reserved.allowOverlap !== true) {
      ctx.warnings.push(`text-overlaps-reserved-zone:${node.id}:${reserved.id}`);
    }
  }

  const needsContrast = node.behaviors?.some((behavior) => behavior.type === 'smart-contrast') === true;
  // Respeita a cor de texto escolhida pelo modelo/marca. Só força preto quando o
  // smart-contrast exige uma superfície branca atrás do texto (garantia de leitura).
  const resolvedTextColor = resolvePaint(node.style?.color, ctx.tokens);
  const textColor = resolvedTextColor && !resolvedTextColor.startsWith('linear-gradient(')
    ? resolvedTextColor
    : (ctx.tokens.colors.text || '#000000');
  return [{
    ...nextLayer,
    color: needsContrast ? '#000000' : textColor,
    contrastBackground: needsContrast,
    contrastBackgroundColor: needsContrast ? '#ffffff' : undefined,
    contrastBackgroundOpacity: needsContrast ? 0.96 : undefined,
    contrastBackgroundRadius: needsContrast ? Math.max(12, Math.round((nextLayer.fontSize ?? roleFontSize) * 0.4)) : undefined,
    shadowColor: needsContrast ? 'rgba(0,0,0,0.08)' : nextLayer.shadowColor,
    shadowBlur: needsContrast ? Math.max(nextLayer.shadowBlur ?? 0, 10) : nextLayer.shadowBlur,
  }];
}

function compileImageNode(node: ImageNode, parent: Box, ctx: CompileContext): Layer[] {
  const src = sanitizeImageUrl(node.src);
  if (!src) {
    ctx.warnings.push(`Imagem bloqueada ou ausente: ${node.id}`);
    return [];
  }

  const box = layoutToBox(node.layout, parent, DEFAULT_NODE_HEIGHT);
  const layer: Layer = {
    id: node.id,
    type: 'image',
    url: src,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    zIndex: nextZ(ctx),
  };

  return [applyVisualStyle(layer, node.style, ctx.tokens)];
}

function compileShapeNode(node: ShapeNode, parent: Box, ctx: CompileContext): Layer[] {
  const box = layoutToBox(node.layout, parent, DEFAULT_NODE_HEIGHT);
  const layer: Layer = {
    id: node.id,
    type: 'shape',
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    color: resolvePaint(node.style?.background, ctx.tokens) ?? ctx.tokens.colors.accent,
    zIndex: nextZ(ctx),
  };

  if (node.style?.shape === 'circle') layer.borderRadius = 9999;
  if (node.style?.shape === 'pill') layer.borderRadius = Math.max(box.height / 2, ctx.tokens.radius.lg);

  return [applyVisualStyle(layer, node.style, ctx.tokens)];
}

function compileContainerNode(node: Extract<DesignNode, { type: 'container' }>, parent: Box, ctx: CompileContext): Layer[] {
  const box = layoutToBox(node.layout, parent, Math.max(DEFAULT_NODE_HEIGHT, parent.height));
  const layers: Layer[] = [];
  const background = resolvePaint(node.style?.background, ctx.tokens);
  const hasVisibleBox = background || isFiniteNumber(node.style?.borderWidth) || node.style?.shadow;

  if (hasVisibleBox) {
    const baseLayer: Layer = {
      id: `${node.id}-frame`,
      type: 'shape',
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      color: background && !background.startsWith('linear-gradient(') ? background : ctx.tokens.colors.surface,
      zIndex: nextZ(ctx),
    };
    layers.push(applyVisualStyle(baseLayer, node.style, ctx.tokens));
  }

  const childParent = applyInnerPadding(box, node.layout);
  const flowBoxes = createFlowBoxes(node.children, childParent, node.layout);

  node.children.forEach((child, index) => {
    layers.push(...compileNode(child, flowBoxes[index] ?? childParent, ctx));
  });

  return layers;
}

function applyInnerPadding(box: Box, layout?: LayoutStyle): Box {
  const padding = getPadding(layout);
  return {
    x: box.x + padding.left,
    y: box.y + padding.top,
    width: Math.max(MIN_LAYER_SIZE, box.width - padding.left - padding.right),
    height: Math.max(MIN_LAYER_SIZE, box.height - padding.top - padding.bottom),
  };
}

function createFlowBoxes(children: DesignNode[], parent: Box, layout?: LayoutStyle): Box[] {
  if (children.length === 0) return [];
  const gap = isFiniteNumber(layout?.gap) ? layout.gap : 0;
  const direction = layout?.display === 'flex' && layout.direction === 'row' ? 'row' : 'column';

  if (direction === 'row') {
    const width = Math.max(MIN_LAYER_SIZE, (parent.width - gap * (children.length - 1)) / children.length);
    return children.map((child, index) => {
      if (child.layout?.position === 'absolute') return parent;
      return { x: Math.round(parent.x + index * (width + gap)), y: parent.y, width: Math.round(width), height: parent.height };
    });
  }

  const height = Math.max(MIN_LAYER_SIZE, (parent.height - gap * (children.length - 1)) / children.length);
  return children.map((child, index) => {
    if (child.layout?.position === 'absolute') return parent;
    return { x: parent.x, y: Math.round(parent.y + index * (height + gap)), width: parent.width, height: Math.round(height) };
  });
}

function compileNode(node: DesignNode, parent: Box, ctx: CompileContext): Layer[] {
  if (node.type === 'container') return compileContainerNode(node, parent, ctx);
  if (node.type === 'text') return compileTextNode(node, parent, ctx);
  if (node.type === 'image') return compileImageNode(node, parent, ctx);
  if (node.type === 'shape') return compileShapeNode(node, parent, ctx);
  return [];
}

function compilePage(page: DesignPageNode, ctx: CompileContext): DesignPage {
  const geometry = derivePageGeometry(page, ctx.pageWidth, ctx.pageHeight);
  ctx.pageGeometry = geometry;
  const pageBox = { x: 0, y: 0, width: ctx.pageWidth, height: ctx.pageHeight };
  const background = resolvePaint(page.background, ctx.tokens);
  ctx.zIndex = 0;

  return {
    width: ctx.pageWidth,
    height: ctx.pageHeight,
    backgroundColor: background && !background.startsWith('linear-gradient(') ? background : ctx.tokens.colors.background,
    safeArea: geometry.safeArea,
    contentInsets: geometry.contentInsets,
    textZones: geometry.textZones,
    reservedZones: geometry.reservedZones,
    layers: page.children.flatMap((node) => compileNode(node, pageBox, ctx)),
  } as DesignPage;
}

export function compileDesignDocumentToPages(document: unknown): CompileDesignDocumentResult | null {
  if (!isDesignDocument(document)) return null;

  const warnings: string[] = [];
  const defaultGeometry = derivePageGeometry(document.pages[0], document.width, document.height);
  const ctx: CompileContext = {
    tokens: document.tokens,
    pageWidth: document.width,
    pageHeight: document.height,
    zIndex: 0,
    warnings,
    pageGeometry: defaultGeometry,
  };

  const pages = document.pages.map((page) => compilePage(page, ctx));
  if (pages.length === 0) return null;

  return { pages, warnings };
}
