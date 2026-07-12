import { randomUUID } from 'crypto';
import { getTemplate } from '../../lib/templates/index.js';
import type { SemanticZone, CanvaTemplate } from '../../lib/templates/types.js';
import type { DesignPage, DesignLayer } from '../../lib/designTypes.js';
import type { PlannerOutput } from '../planner/index.js';
import type { ContentOutput } from '../content/index.js';
import type { ImageOutput } from '../image/index.js';


// ── Font size defaults by role ─────────────────────────────────────────────────

const FONT_SIZE: Record<string, number> = {
  title: 72, eyebrow: 28, subtitle: 36, body: 28, caption: 22,
  author: 24, quote: 52, cta: 56, contact: 26, 'col-title': 36,
  'col-body': 26, 'section-number': 90, 'event-date': 22,
  'event-title': 32, 'event-body': 22, brand: 24, 'swipe-indicator': 20,
};

const FONT_WEIGHT: Record<string, string> = {
  title: 'bold', eyebrow: '500', subtitle: '400', body: '400',
  cta: 'bold', quote: '600', 'section-number': '900', 'col-title': '600',
  'event-title': '600', brand: '500',
};

// ── Zone → Layer ───────────────────────────────────────────────────────────────

function zoneToLayer(
  zone: SemanticZone,
  zIndex: number,
  content: string | undefined,
  imageUrl: string | undefined,
  plan: PlannerOutput,
  previousLayers: DesignLayer[] = [],
  template?: CanvaTemplate,
): DesignLayer | null {
  const baseLayer = {
    id: `${zone.id}-${randomUUID().slice(0, 8)}`,
    zIndex,
  };

  const tpl = template?.id || 'default';
  const cw = plan.dimensions.width;
  const ch = plan.dimensions.height;
  const isContentHeavy = tpl.includes('split') || tpl.includes('carousel-content') || tpl.includes('carousel-data') || tpl.includes('quote');

  // ── Layout Engine: Define bounding boxes based on template and zone role ──
  let x = Math.round(cw * 0.1); // Default 10% margin
  let w = Math.round(cw * 0.8);
  let align: 'left' | 'center' | 'right' = 'left';
  let startY = Math.round(ch * 0.15); // Default start Y
  const isImage = zone.type === 'image';
  const imageFit: 'cover' | 'contain' | 'fill' = 'cover';

  // Strategy map for template layouts to avoid if/else chains
  const layoutStrategies: Record<string, () => void> = {
    'hero': () => {
      align = 'center';
      startY = Math.round(ch * 0.35);
    },
    'full-bleed': () => {
      align = 'center';
      startY = Math.round(ch * 0.35);
      if (isImage || zone.type === 'shape') { x = 0; w = cw; startY = 0; }
    },
    'quote': () => {
      align = 'center';
      startY = Math.round(ch * 0.35);
    },
    'split-left': () => {
      if (isImage) { x = Math.round(cw * 0.5); w = Math.round(cw * 0.5); startY = 0; }
      if (!isImage) { x = Math.round(cw * 0.08); w = Math.round(cw * 0.38); startY = Math.round(ch * 0.3); }
    },
    'split-right': () => {
      if (isImage) { x = 0; w = Math.round(cw * 0.5); startY = 0; }
      if (!isImage) { x = Math.round(cw * 0.54); w = Math.round(cw * 0.38); startY = Math.round(ch * 0.3); }
    },
    'carousel-content': () => {
      if (isImage) { x = 0; w = cw; startY = Math.round(ch * 0.2); }
      if (zone.role === 'title') { startY = Math.round(ch * 0.08); }
      if (zone.role === 'caption') { startY = Math.round(ch * 0.85); }
    },
    'carousel-data': () => {
      if (zone.type === 'chart') { x = Math.round(cw * 0.05); w = Math.round(cw * 0.9); startY = Math.round(ch * 0.25); }
      if (zone.role === 'caption') { startY = Math.round(ch * 0.18); }
    }
  };

  // Find matching strategy (handling partial matches like hero-1, hero-2)
  const strategyKey = Object.keys(layoutStrategies).find(key => tpl.includes(key));
  if (strategyKey) {
    layoutStrategies[strategyKey]();
  }

  // Calcular posição y baseada em layers anteriores para evitar sobreposição
  const calculateYPosition = (fontSize: number, role: string, isFullHeight: boolean = false): number => {
    if (isFullHeight) return startY;
    
    // Filtra layers anteriores que estão na mesma coluna (interseção no X)
    const columnLayers = previousLayers.filter(l => {
       if (l.type === 'image' && (l.width === cw || l.height === ch)) return false; // Ignora backgrounds
       if (l.type === 'shape') return false; // Ignora overlays
       // Checa interseção no eixo X
       return (x < (l.x ?? 0) + (l.width ?? 0)) && ((x + w) > (l.x ?? 0));
    });

    if (columnLayers.length === 0) {
      return startY;
    }
    
    const lastLayer = columnLayers[columnLayers.length - 1];
    if (!lastLayer.y || !lastLayer.height) return startY;
    
    const lastFontSize = lastLayer.fontSize || fontSize;
    const gapMin = Math.max(20, lastFontSize * 0.5); // Respiro proporcional
    
    return lastLayer.y + lastLayer.height + gapMin;
  };

  // Estimativa de altura para texto com base na quebra de linha
  const estimateTextHeight = (text: string, fontSize: number, lineHeight: number, boxWidth: number): number => {
    // Um caractere médio ocupa ~0.55 do fontSize em largura
    const charsPerLine = Math.max(1, Math.floor(boxWidth / (fontSize * 0.55)));
    const lines = Math.ceil(text.length / charsPerLine);
    return lines * fontSize * lineHeight;
  };

  if (zone.type === 'text') {
    if (!content && zone.optional) return null;
    const role = zone.role ?? zone.id;
    const fontSize = FONT_SIZE[role] ?? 28;
    const lineHeight = role === 'body' || role === 'col-body' || role === 'event-body' ? 1.6 : 1.2;
    
    // Atualiza x e w se a role for de duas colunas (ex: col-title)
    if (role.startsWith('col-')) {
      x = Math.round(cw * 0.1);
      w = Math.round(cw * 0.35); // TODO: suporte a colunas múltiplas
    }
    
    const h = estimateTextHeight(content ?? '', fontSize, lineHeight, w);
    const y = calculateYPosition(fontSize, role);
    
    // Sobrescreve alinhamento se for específico do role
    if (role === 'title' || role === 'cta' || role === 'quote' || role === 'section-number') align = 'center';
    else if (role === 'caption' || role === 'brand') align = 'left';
    
    const shouldUseWhiteSurface = zone.contrastBackground || isContentHeavy;

    return {
      ...baseLayer,
      type: 'text',
      content: content ?? '',
      fontFamily: plan.fonts[0] ?? 'Inter',
      fontSize,
      fontWeight: FONT_WEIGHT[role] ?? '400',
      color: '#000000',
      textAlign: align,
      lineHeight,
      contrastBackground: shouldUseWhiteSurface,
      contrastBackgroundColor: shouldUseWhiteSurface ? '#ffffff' : undefined,
      contrastBackgroundOpacity: shouldUseWhiteSurface ? 0.96 : undefined,
      contrastBackgroundRadius: shouldUseWhiteSurface ? Math.max(12, Math.round(fontSize * 0.4)) : undefined,
      typographyTokens: zone.typographyTokens,
      behaviors: zone.behaviors,
      y,
      x,
      width: w,
      height: h,
    };
  }

  if (zone.type === 'image') {
    if (!imageUrl && zone.optional) return null;
    
    const isBackground = tpl === 'full-bleed' || tpl.includes('hero');
    const y = calculateYPosition(0, 'image', isBackground);
    
    // Se for split, a altura deve ser total
    let h = ch;
    if (tpl === 'carousel-content') h = Math.round(ch * 0.6);
    
    return {
      ...baseLayer,
      type: 'image',
      url: imageUrl ?? '',
      fit: zone.fit || imageFit,
      aspectRatio: zone.aspectRatio,
      behaviors: zone.behaviors,
      y,
      x,
      width: w,
      height: h,
    };
  }

  if (zone.type === 'chart') {
    const y = calculateYPosition(0, 'chart', false);
    
    return {
      ...baseLayer,
      type: 'image', // Charts are represented as images in DesignLayer
      url: '', // URL will be filled by Graphics Agent
      color: '#f0f0f0',
      behaviors: zone.behaviors,
      y,
      x,
      width: w,
      height: Math.round(ch * 0.5),
    };
  }

  if (zone.type === 'shape') {
    const y = calculateYPosition(0, 'shape', true);
    
    return {
      ...baseLayer,
      type: 'shape',
      shapeType: 'rectangle',
      color: 'rgba(255,255,255,0.96)',
      behaviors: zone.behaviors,
      y,
      x,
      width: w,
      height: ch,
    };
  }

  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function runDesign(params: {
  plan: PlannerOutput;
  content: ContentOutput;
  images: ImageOutput;
}): DesignPage[] {
  const { plan, content, images } = params;
  const pages: DesignPage[] = [];

  for (const slide of plan.slides) {
    const template = getTemplate(slide.templateId) as CanvaTemplate; // Cast to CanvaTemplate
    if (!template) {
      // Fallback: página em branco com mensagem de erro
      pages.push({ backgroundColor: '#ffffff', width: plan.dimensions.width, height: plan.dimensions.height, layers: [] });
      continue;
    }

    const slideContent = content[slide.index] ?? {};
    const slideImages = images[slide.index] ?? {};
    const layers: DesignLayer[] = [];

    for (let i = 0; i < template.semanticZones.length; i++) { // Iterate over semanticZones
      const zone = template.semanticZones[i]!;
      const layer = zoneToLayer(
        zone,
        i + 10, // Base zIndex for template zones
        zone.type === 'text' ? slideContent[zone.id] : undefined,
        zone.type === 'image' ? slideImages[zone.id] : undefined,
        plan,
        layers, // Pass previous layers to calculate y position
        template, // Pass template for layout engine
      );
      if (layer) layers.push(layer);
    }

    // Adiciona as formas decorativas geradas pela IA
    if (slide.decorativeShapes && Array.isArray(slide.decorativeShapes)) {
      slide.decorativeShapes.forEach((shape: any, idx: number) => {
        layers.push({
          ...shape,
          id: `ai-shape-${randomUUID().slice(0, 8)}`,
          zIndex: shape.zIndex ?? idx, // Pode ficar atrás ou na frente
        });
      });
    }

    const isContentHeavy = template.id.includes('split') || template.id.includes('carousel-content') || template.id.includes('carousel-data') || template.id.includes('quote');
    const bg = isContentHeavy 
      ? '#ffffff' 
      : (plan.colors[0] && slide.index === 0 ? plan.colors[0] : plan.colors[1] ?? '#ffffff');

    pages.push({
      backgroundColor: bg,
      width: template.dimensions.width,
      height: template.dimensions.height,
      layers: layers, // Layers are now directly from semantic zones
    });
  }

  return pages;
}
