export type DesignFormat = 'single' | 'carousel' | 'story' | 'presentation';

export type Paint = string;

export type DesignTokens = {
  colors: {
    background: string;
    surface: string;
    text: string;
    muted: string;
    accent: string;
    accent2?: string;
  };
  typography: {
    display: string;
    heading: string;
    body: string;
  };
  spacing: {
    page: number;
    section: number;
    gap: number;
  };
  radius: {
    sm: number;
    md: number;
    lg: number;
  };
  effects?: {
    shadow?: 'none' | 'soft' | 'premium' | 'dramatic';
    grain?: boolean;
    glass?: boolean;
    gradient?: boolean;
  };
};

export type PaddingValue = number | {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type Insets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type SlideRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PageZone = SlideRect & {
  id: string;
  roles?: string[];
  nodeIds?: string[];
  maxChars?: number;
  allowOverlap?: boolean;
};

export type LayoutStyle = {
  position?: 'relative' | 'absolute';
  x?: number;
  y?: number;
  width?: number | string;
  height?: number | string;
  display?: 'block' | 'flex' | 'grid';
  direction?: 'row' | 'column';
  columns?: string[];
  rows?: string[];
  gap?: number;
  padding?: PaddingValue;
  alignItems?: 'start' | 'center' | 'end' | 'stretch';
  justifyContent?: 'start' | 'center' | 'end' | 'space-between';
};

export type VisualStyle = {
  background?: Paint;
  color?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  opacity?: number;
  shadow?: 'none' | 'soft' | 'premium' | 'dramatic';
};

export type TextStyle = VisualStyle & {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: 'left' | 'center' | 'right';
  textTransform?: 'none' | 'uppercase' | 'lowercase';
};

export type ImageStyle = VisualStyle & {
  objectFit?: 'cover' | 'contain';
};

export type ShapeStyle = VisualStyle & {
  shape?: 'rectangle' | 'circle' | 'pill';
};

export type Behavior =
  | { type: 'auto-fit-text'; min: number; max: number }
  | { type: 'balance-lines'; maxLines: number }
  | { type: 'smart-contrast' }
  | { type: 'image-focal-point'; x: number; y: number }
  | { type: 'equalize-card-heights' }
  | { type: 'stagger-children'; amount: number };

export type BaseNode = {
  id: string;
  name?: string;
};

export type ContainerNode = BaseNode & {
  type: 'container';
  role?: 'hero' | 'content' | 'footer' | 'card' | 'imageGroup' | 'decorativeGroup';
  layout: LayoutStyle;
  style?: VisualStyle;
  children: DesignNode[];
  editable?: {
    lockStructure?: boolean;
    allowUngroup?: boolean;
    allowChildrenEdit?: boolean;
  };
};

export type TextNode = BaseNode & {
  type: 'text';
  role?: 'eyebrow' | 'headline' | 'subtitle' | 'body' | 'caption' | 'cta' | 'title' | 'quote' | 'author' | 'brand' | 'contact' | 'swipe-indicator' | 'col-title' | 'col-body' | 'section-number' | 'event-date' | 'event-title' | 'event-body';
  content: string;
  style?: TextStyle;
  layout?: LayoutStyle;
  behaviors?: Behavior[];
};

export type ImageNode = BaseNode & {
  type: 'image';
  src: string;
  alt?: string;
  style?: ImageStyle;
  layout?: LayoutStyle;
  behaviors?: Behavior[];
};

export type ShapeNode = BaseNode & {
  type: 'shape';
  style?: ShapeStyle;
  layout?: LayoutStyle;
};

export type DesignNode = ContainerNode | TextNode | ImageNode | ShapeNode;

export type DesignPageNode = BaseNode & {
  type: 'page';
  name?: string;
  background: Paint;
  templateId?: string;
  safeArea?: Insets;
  contentInsets?: Insets;
  textZones?: PageZone[];
  reservedZones?: PageZone[];
  children: DesignNode[];
};

export type DesignDocument = {
  version: 1;
  format: DesignFormat;
  width: number;
  height: number;
  tokens: DesignTokens;
  pages: DesignPageNode[];
};
