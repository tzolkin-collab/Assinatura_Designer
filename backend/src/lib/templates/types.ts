export type SemanticZoneType = 'text' | 'image' | 'chart' | 'shape';
export type ImageFit = 'cover' | 'contain' | 'fill';

export interface SemanticZone {
  id: string;
  type: SemanticZoneType;
  // Constraints e Behaviors (aplicados pelo Worker Designer ao interagir com Canva API)
  maxChars?: number;
  minFontSize?: number;
  fit?: ImageFit;
  aspectRatio?: string;
  // metadata
  role?: string;      // "headline" | "body" | "caption" | "author" | "event-title" | "cta" | "background" | "overlay" ...
  optional?: boolean;
  contrastBackground?: boolean;            // indica necessidade de overlay de contraste
  typographyTokens?: 'display' | 'heading' | 'body'; // para hierarquia visual
  behaviors?: string[];                    // 'auto-fit-text', 'balance-lines', 'smart-contrast', 'no-overlap'
}

export interface CanvaTemplate {
  id: string;
  label: string;
  category: 'presentation' | 'carousel' | 'social-media';
  dimensions: { width: number; height: number };
  semanticZones: SemanticZone[]; // Zonas semânticas que serão mapeadas para elementos do Canva
  canvaTemplateId: string; // ID do template correspondente no Canva
}

// Aliases para compatibilidade com código existente
export type SlideTemplate = CanvaTemplate;
export type SlideZone = SemanticZone;
export type ZoneType = SemanticZoneType;
