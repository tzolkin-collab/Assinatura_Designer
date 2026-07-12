// ═══════════════════════════════════════════════════════════════════════════════
// Design IR (Intermediate Representation) — Tipos
// ═══════════════════════════════════════════════════════════════════════════════

export type ElementType = 'text' | 'image' | 'shape' | 'group';

export type ElementRole = 'title' | 'subtitle' | 'body' | 'label' | 'button' | 'decoration' | 'background';

export interface ElementStyle {
  // Layout
  display?: string;
  flexDirection?: string;
  alignItems?: string;
  justifyContent?: string;
  gap?: number;
  padding?: number | string;
  overflow?: string;

  // Typography
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textTransform?: 'none' | 'capitalize' | 'uppercase' | 'lowercase';
  italic?: boolean;
  textDecoration?: 'none' | 'underline' | 'line-through';
  color?: string;

  // Appearance
  backgroundColor?: string;
  background?: string;
  opacity?: number;
  borderRadius?: number | string;
  borderWidth?: number;
  borderColor?: string;
  borderStyle?: string;
  boxShadow?: string;
  backdropFilter?: string;

  // Image specific
  objectFit?: 'cover' | 'contain' | 'fill';
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

export interface ElementNode {
  id: string;
  type: ElementType;
  role: ElementRole;
  name?: string;
  bounds: Bounds;
  zIndex: number;
  style: ElementStyle;
  
  // Content
  content?: string; // Text content
  src?: string; // Image URL
  shapeType?: 'rectangle' | 'circle' | 'triangle' | 'polygon' | 'line'; // Shape type
  children?: ElementNode[]; // Group children
  
  // Interactivity / State
  editable?: boolean;
  contentEditable?: boolean;
  draggable?: boolean;
  resizable?: boolean;
  locked?: boolean;
  visible?: boolean;

  // Animation
  animation?: {
    type: 'fade' | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right' | 'zoom-in' | 'blur-in' | 'none';
    duration?: number;
    delay?: number;
    easing?: string;
  };
}

export interface BackgroundDef {
  type: 'solid' | 'gradient' | 'image';
  color?: string;
  gradient?: string;
  src?: string;
  overlay?: string;
}

export interface SlideNode {
  id: string;
  background: BackgroundDef;
  elements: ElementNode[];
}

export interface DesignTokens {
  colors: Record<string, string>;
  fonts: Record<string, string>;
  spacing: Record<string, number>;
  borderRadius: Record<string, number>;
}

export interface DesignIR {
  version: 1;
  width: number;
  height: number;
  tokens: DesignTokens;
  fonts: string[];
  slides: SlideNode[];
}

// ── Patching Types ────────────────────────────────────────────────────────────

export type IRPatchOp = 
  | { op: 'update-element'; slideId: string; elementId: string; changes: Partial<ElementNode> }
  | { op: 'update-style'; slideId: string; elementId: string; style: Partial<ElementStyle> }
  | { op: 'update-content'; slideId: string; elementId: string; content: string }
  | { op: 'update-bounds'; slideId: string; elementId: string; bounds: Partial<Bounds> }
  | { op: 'update-background'; slideId: string; background: BackgroundDef }
  | { op: 'add-element'; slideId: string; element: ElementNode; afterElementId?: string }
  | { op: 'remove-element'; slideId: string; elementId: string }
  | { op: 'reorder-element'; slideId: string; elementId: string; newZIndex: number }
  | { op: 'add-slide'; slide: SlideNode; afterSlideId?: string }
  | { op: 'remove-slide'; slideId: string }
  | { op: 'update-tokens'; tokens: Partial<DesignTokens> };

export interface IRPatch {
  ops: IRPatchOp[];
}
