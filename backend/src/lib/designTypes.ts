// Tipos canônicos do sistema de design — espelham o frontend DesignRenderer

export interface DesignLayer {
  id: string;
  type: 'text' | 'image' | 'shape';
  content?: string;
  url?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  textAlign?: 'left' | 'center' | 'right';
  lineHeight?: number;
  opacity?: number;
  borderRadius?: number;
  zIndex: number;
  rotation?: number;
  borderWidth?: number;
  borderColor?: string;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  gradientType?: 'linear' | 'radial' | 'none';
  gradientColor2?: string;
  gradientAngle?: number;
  letterSpacing?: number;
  italic?: boolean;
  textDecoration?: 'none' | 'underline' | 'line-through';
  shapeType?: 'rectangle' | 'triangle' | 'polygon' | 'line' | 'star';
  animationIn?: 'none' | 'fade' | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right' | 'zoom-in' | 'zoom-out' | 'blur-in';
  animationDelay?: number;
  animationDuration?: number;
  contrastBackground?: boolean;
  contrastBackgroundColor?: string;
  contrastBackgroundOpacity?: number;
  contrastBackgroundRadius?: number;
  typographyTokens?: 'display' | 'heading' | 'body';
  fit?: 'cover' | 'contain' | 'fill';
  aspectRatio?: string;
  behaviors?: string[];
}

export interface DesignPage {
  backgroundColor?: string;
  backgroundImage?: string;
  layers?: DesignLayer[];
  width?: number;
  height?: number;
  safeArea?: { top: number; right: number; bottom: number; left: number };
  contentInsets?: { top: number; right: number; bottom: number; left: number };
  textZones?: Array<{ id: string; x: number; y: number; width: number; height: number; roles?: string[]; nodeIds?: string[]; maxChars?: number; allowOverlap?: boolean }>;
  reservedZones?: Array<{ id: string; x: number; y: number; width: number; height: number; roles?: string[]; nodeIds?: string[]; maxChars?: number; allowOverlap?: boolean }>;
}
