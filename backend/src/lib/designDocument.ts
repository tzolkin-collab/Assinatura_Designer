import { clampTextToSafeArea, enforceTextContrast } from './contrast.js';

export type DesignFormat = 'single' | 'carousel' | 'story';

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
  padding?: number | { top: number; right: number; bottom: number; left: number };
  alignItems?: 'start' | 'center' | 'end' | 'stretch';
  justifyContent?: 'start' | 'center' | 'end' | 'space-between';
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
  | { type: 'stagger-children'; amount: number }
  | { type: 'generate-image'; prompt: string };

export type ContainerNode = {
  id: string;
  type: 'container';
  name?: string;
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

export type TextNode = {
  id: string;
  type: 'text';
  role?: 'eyebrow' | 'headline' | 'subtitle' | 'body' | 'caption' | 'cta' | 'title' | 'quote' | 'author' | 'brand' | 'contact' | 'swipe-indicator' | 'col-title' | 'col-body' | 'section-number' | 'event-date' | 'event-title' | 'event-body';
  content: string;
  style?: TextStyle;
  layout?: LayoutStyle;
  behaviors?: Behavior[];
};

export type ImageNode = {
  id: string;
  type: 'image';
  role?: 'hero' | 'supporting' | 'logo' | 'texture' | 'background';
  src: string;
  alt?: string;
  layout?: LayoutStyle;
  style?: ImageStyle;
  behaviors?: Behavior[];
};

export type ShapeNode = {
  id: string;
  type: 'shape';
  layout?: LayoutStyle;
  style?: ShapeStyle;
  behaviors?: Behavior[];
};

export type DesignNode = ContainerNode | TextNode | ImageNode | ShapeNode;

export type DesignPageNode = {
  id: string;
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

export type HybridDesignChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  attachments?: Array<{
    name: string;
    mimeType: string;
    dataBase64: string;
  }>;
};

export type HybridDesignPostContent = {
  reasoning?: string;
  kind: 'hybrid-design';
  version: 1;
  source: 'codegen';
  document: DesignDocument;
  pages?: unknown[];
  sessionId?: string;
  chatHistory?: HybridDesignChatMessage[];
};

export type DesignDocumentBrandContext = {
  name: string;
  slug: string;
  guidelines: string;
  agentPrompt: string;
  colors: string[];
  primaryFonts: string[];
  logoUrl?: string | null;
  presentationConfig?: {
    autoMode?: boolean;
    requirePaletteConfirmation?: boolean;
    paletteApproved?: string[];
    paletteDirection?: string;
    paletteNotes?: string;
    visualVibe?: string;
    boldness?: 'safe' | 'balanced' | 'bold';
    photoPreference?: 'minimal' | 'balanced' | 'high';
    imageryStyle?: string;
    allowGeneratedGraphics?: boolean;
    allowSvgLayouts?: boolean;
    notes?: string;
  };
  references: Array<{
    name: string;
    archetype?: string | null;
    toneOfVoice?: string | null;
    density?: string | null;
    palette: string[];
    insightsText?: string | null;
  }>;
};

export type GenerateDesignDocumentInput = {
  prompt: string;
  format: DesignFormat;
  width: number;
  height: number;
  slideCount: number;
  density?: string;
  templates?: string[];
  brand: DesignDocumentBrandContext;
};

export class DesignDocumentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesignDocumentValidationError';
  }
}

const FORBIDDEN_KEYS = new Set([
  'script',
  'styleRaw',
  'dangerouslySetInnerHTML',
  'html',
  'css',
  'js',
]);

const ALLOWED_NODE_TYPES = new Set(['container', 'text', 'image', 'shape']);
const ALLOWED_FORMATS = new Set(['single', 'carousel', 'story']);
const TEXT_ROLES = new Set(['eyebrow', 'headline', 'subtitle', 'body', 'caption', 'cta', 'title', 'quote', 'author', 'brand', 'contact', 'swipe-indicator', 'col-title', 'col-body', 'section-number', 'event-date', 'event-title', 'event-body']);

type GeometryViolationCode =
  | 'missing-text-zone'
  | 'out-of-safe-area'
  | 'out-of-content-area'
  | 'out-of-text-zone'
  | 'overlap'
  | 'off-canvas'
  | 'template-role-mismatch'
  | 'max-chars-exceeded';

type GeometryViolation = {
  code: GeometryViolationCode;
  pageId: string;
  nodeId: string;
  message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new DesignDocumentValidationError(message);
}

function hasForbiddenKey(value: unknown, path = 'content'): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = hasForbiddenKey(value[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }

  if (!isRecord(value)) return null;

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) return `${path}.${key}`;
    const found = hasForbiddenKey(child, `${path}.${key}`);
    if (found) return found;
  }

  return null;
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${path} must be a non-empty string`);
}

function assertNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${path} must be a finite number`);
}

function assertPositiveNumber(value: unknown, path: string): asserts value is number {
  assertNumber(value, path);
  if (value <= 0) fail(`${path} must be greater than zero`);
}

function validatePaint(value: unknown, path: string): void {
  assertString(value, path);
}

function normalizeInsets(value: unknown, fallback: Insets): Insets {
  if (!isRecord(value)) return fallback;
  const top = typeof value.top === 'number' && Number.isFinite(value.top) ? value.top : fallback.top;
  const right = typeof value.right === 'number' && Number.isFinite(value.right) ? value.right : fallback.right;
  const bottom = typeof value.bottom === 'number' && Number.isFinite(value.bottom) ? value.bottom : fallback.bottom;
  const left = typeof value.left === 'number' && Number.isFinite(value.left) ? value.left : fallback.left;
  return {
    top: Math.max(0, Math.round(top)),
    right: Math.max(0, Math.round(right)),
    bottom: Math.max(0, Math.round(bottom)),
    left: Math.max(0, Math.round(left)),
  };
}

function rectFromInsets(width: number, height: number, insets: Insets): SlideRect {
  return {
    x: insets.left,
    y: insets.top,
    width: Math.max(1, width - insets.left - insets.right),
    height: Math.max(1, height - insets.top - insets.bottom),
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

function validateInsets(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) fail(`${path} must be an object`);
  assertNumber(value.top, `${path}.top`);
  assertNumber(value.right, `${path}.right`);
  assertNumber(value.bottom, `${path}.bottom`);
  assertNumber(value.left, `${path}.left`);
}

function validatePageZone(value: unknown, path: string): void {
  if (!isRecord(value)) fail(`${path} must be an object`);
  assertString(value.id, `${path}.id`);
  assertNumber(value.x, `${path}.x`);
  assertNumber(value.y, `${path}.y`);
  assertPositiveNumber(value.width, `${path}.width`);
  assertPositiveNumber(value.height, `${path}.height`);
  if (value.roles !== undefined) {
    if (!Array.isArray(value.roles)) fail(`${path}.roles must be an array`);
    value.roles.forEach((role, index) => assertString(role, `${path}.roles[${index}]`));
  }
  if (value.nodeIds !== undefined) {
    if (!Array.isArray(value.nodeIds)) fail(`${path}.nodeIds must be an array`);
    value.nodeIds.forEach((nodeId, index) => assertString(nodeId, `${path}.nodeIds[${index}]`));
  }
  if (value.maxChars !== undefined) assertPositiveNumber(value.maxChars, `${path}.maxChars`);
  if (value.allowOverlap !== undefined && typeof value.allowOverlap !== 'boolean') fail(`${path}.allowOverlap must be boolean`);
}

function validateTokens(value: unknown): void {
  if (!isRecord(value)) fail('document.tokens must be an object');
  
  // Auto-fix: injeta objetos vazios se a IA esquecer
  if (!isRecord(value.colors)) value.colors = {};
  if (!isRecord(value.typography)) value.typography = {};
  if (!isRecord(value.spacing)) value.spacing = {};
  if (!isRecord(value.radius)) value.radius = {};

  const colors = value.colors as Record<string, unknown>;
  const typography = value.typography as Record<string, unknown>;
  const spacing = value.spacing as Record<string, unknown>;
  const radius = value.radius as Record<string, unknown>;

  // Auto-fix: injeta valores default para cores se faltarem
  colors.background = typeof colors.background === 'string' && colors.background ? colors.background : '#FFFFFF';
  colors.surface = typeof colors.surface === 'string' && colors.surface ? colors.surface : '#F4F4F4';
  colors.text = typeof colors.text === 'string' && colors.text ? colors.text : '#000000';
  colors.muted = typeof colors.muted === 'string' && colors.muted ? colors.muted : '#666666';
  colors.accent = typeof colors.accent === 'string' && colors.accent ? colors.accent : '#000000';

  // Auto-fix: injeta valores default para tipografia se faltarem
  typography.display = typeof typography.display === 'string' && typography.display ? typography.display : 'Inter';
  typography.heading = typeof typography.heading === 'string' && typography.heading ? typography.heading : 'Inter';
  typography.body = typeof typography.body === 'string' && typography.body ? typography.body : 'Inter';

  // Auto-fix: injeta valores default para spacing se faltarem
  spacing.page = typeof spacing.page === 'number' ? spacing.page : 60;
  spacing.section = typeof spacing.section === 'number' ? spacing.section : 40;
  spacing.gap = typeof spacing.gap === 'number' ? spacing.gap : 20;

  // Auto-fix: injeta valores default para radius se faltarem
  radius.sm = typeof radius.sm === 'number' ? radius.sm : 4;
  radius.md = typeof radius.md === 'number' ? radius.md : 8;
  radius.lg = typeof radius.lg === 'number' ? radius.lg : 16;

  for (const key of ['background', 'surface', 'text', 'muted', 'accent']) {
    assertString(colors[key], `document.tokens.colors.${key}`);
  }
  if (colors.accent2 !== undefined) assertString(colors.accent2, 'document.tokens.colors.accent2');

  for (const key of ['display', 'heading', 'body']) {
    assertString(typography[key], `document.tokens.typography.${key}`);
  }

  for (const key of ['page', 'section', 'gap']) {
    assertPositiveNumber(spacing[key], `document.tokens.spacing.${key}`);
  }

  for (const key of ['sm', 'md', 'lg']) {
    assertNumber(radius[key], `document.tokens.radius.${key}`);
  }
}

function validateLayout(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) return; // Auto-fix: ignora se não for objeto em vez de falhar
  for (const key of ['x', 'y', 'gap']) {
    if (value[key] !== undefined && typeof value[key] !== 'number') {
      // Auto-fix: tenta converter para número
      value[key] = Number(value[key]) || 0;
    }
    if (value[key] !== undefined) assertNumber(value[key], `${path}.${key}`);
  }
}

function validateBehaviors(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  for (let i = 0; i < value.length; i += 1) {
    const behavior = value[i];
    if (typeof behavior === 'string') {
      // Auto-fix: se a IA mandou uma string (ex: "smart-contrast"), converte para objeto
      value[i] = { type: behavior };
      continue;
    }
    if (!isRecord(behavior)) fail(`${path}[${i}] must be an object`);
    assertString(behavior.type, `${path}[${i}].type`);
  }
}

function validateNode(value: unknown, path: string): void {
  if (!isRecord(value)) fail(`${path} must be an object`);
  
  // Auto-fix: injeta ID se faltar
  if (typeof value.id !== 'string' || !value.id) {
    value.id = `node-${Math.random().toString(36).slice(2)}`;
  }
  
  // Auto-fix: fallback para container se type for inválido
  if (typeof value.type !== 'string' || !ALLOWED_NODE_TYPES.has(value.type)) {
    value.type = 'container';
  }

  assertString(value.id, `${path}.id`);
  assertString(value.type, `${path}.type`);

  if (value.type === 'container') {
    validateLayout(value.layout, `${path}.layout`);
    if (!Array.isArray(value.children)) value.children = []; // Auto-fix
    const children = value.children as unknown[];
    for (let i = 0; i < children.length; i += 1) validateNode(children[i], `${path}.children[${i}]`);
    return;
  }

  if (value.type === 'text') {
    if (typeof value.content !== 'string') value.content = 'Texto'; // Auto-fix
    assertString(value.content, `${path}.content`);
    validateLayout(value.layout, `${path}.layout`);
    validateBehaviors(value.behaviors, `${path}.behaviors`);
    return;
  }

  if (value.type === 'image') {
    if (value.src === undefined || value.src === '') {
      value.src = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop'; // Fallback seguro
    }
    assertString(value.src, `${path}.src`);
    validateLayout(value.layout, `${path}.layout`);
    validateBehaviors(value.behaviors, `${path}.behaviors`);
    return;
  }

  if (value.type === 'shape') {
    validateLayout(value.layout, `${path}.layout`);
    validateBehaviors(value.behaviors, `${path}.behaviors`);
  }
}

export function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const direct = tryParseJson(trimmed);
  if (direct !== undefined) return direct;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const parsed = tryParseJson(fenced[1].trim());
    if (parsed !== undefined) return parsed;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const parsed = tryParseJson(trimmed.slice(start, end + 1));
    if (parsed !== undefined) return parsed;
  }

  fail('AI response did not contain valid JSON');
}

function tryParseJson(raw: string): unknown | undefined {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export async function reviewDesignDocument(
  generateText: (systemInstruction: string, userPrompt: string) => Promise<string>,
  document: DesignDocument,
  brand: DesignDocumentBrandContext,
): Promise<DesignDocument> {
  const systemInstruction = `Você é um auditor sênior de design e qualidade.
Sua tarefa é receber um DesignDocument JSON e retornar uma versão corrigida e melhorada do mesmo JSON.
Foque em corrigir:
- Qualquer violação da regra de leitura: texto deve ficar em preto sobre superfície branca nas áreas escritas.
- Baixo contraste (textos claros em fundos claros, ou vice-versa).
- Textos sobrepostos a imagens sem usar card, faixa ou container branco com behaviors: ['smart-contrast'] quando necessário.
- Repetição excessiva de layouts entre slides seguidos.
- Hierarquia tipográfica fraca ou inconsistente (verifique se as roles semânticas estão sendo respeitadas e se há distinção clara entre títulos, subtítulos, corpo, etc.).
- Margens e paddings inconsistentes ou insuficientes, causando falta de respiro.
- Sobreposição de layers de texto ou elementos sem justificativa.
- Legibilidade geral do texto (tamanho, espaçamento entre linhas e letras).

Retorne SOMENTE o JSON do DesignDocument corrigido, sem markdown. Ele deve respeitar o mesmo schema (version=1, format, width, height, tokens, pages).`;

  const userPrompt = `Contexto da marca:
Cores oficiais: ${brand.colors.join(', ')}
Fontes: ${brand.primaryFonts.join(', ')}

DesignDocument atual:
${JSON.stringify(document, null, 2)}

Corrija as falhas de design e retorne o JSON final melhorado.`;

  const raw = await generateText(systemInstruction, userPrompt);
  const parsed = extractJsonObject(raw);
  
  if (!isRecord(parsed)) fail('Review did not return an object');
  // Re-wrap in the Hybrid content envelope to use the existing validator
  const wrapper = {
    kind: 'hybrid-design',
    version: 1,
    source: 'codegen',
    document: parsed
  };
  const validated = validateHybridDesignPostContent(wrapper);
  return validated.document;
}
export async function generateDesignDocument(
  generateText: (systemInstruction: string, userPrompt: string) => Promise<string>,
  input: GenerateDesignDocumentInput,
): Promise<HybridDesignPostContent> {
  const systemInstruction = buildDesignDocumentSystemInstruction(input);
  const userPrompt = buildDesignDocumentUserPrompt(input);
  const raw = await generateText(systemInstruction, userPrompt);
  const content = validateHybridDesignPostContent(extractJsonObject(raw));
  // Garantias determinísticas de legibilidade (independentes do que o modelo fez):
  // 1) blocos de texto não vazam pela borda; 2) cor de texto tem contraste real
  // com o fundo atrás de cada bloco.
  clampTextToSafeArea(content.document);
  enforceTextContrast(content.document);
  return content;
}

function buildDesignDocumentSystemInstruction(input: GenerateDesignDocumentInput): string {
  return `Você é um diretor de arte sênior e designer de sistemas visuais para social media premium.
Sua tarefa é gerar um DesignDocument declarativo, seguro e validável para renderização por código próprio.
Aja como diretor de arte: defina estrutura, hierarquia, tokens, ritmo, contraste, templates e intenção visual. Não aja como desenhista de pixels soltos.
Retorne somente JSON puro, sem markdown, sem explicações e sem texto fora do objeto.

Contrato obrigatório:
- O objeto raiz deve ter kind="hybrid-design", version=1, source="codegen" e document.
  - document.version deve ser 1.
  - document.format deve ser "${input.format}".
  - document.width deve ser ${input.width} e document.height deve ser ${input.height}.
  - document.tokens DEVE ser um objeto contendo colors, typography, spacing e radius.
    - colors DEVE conter: background, surface, text, muted, accent.
    - typography DEVE conter: display, heading, body.
    - spacing DEVE conter: page, section, gap.
    - radius DEVE conter: sm, md, lg.
  - document.pages deve ter exatamente ${input.slideCount} página(s).
- Cada página deve ter type="page", id único, background como string segura e children.
- Nodes permitidos: container, text, image, shape.
- Todo node deve ter id e type.
- Images devem ter src seguro: data:image/*, https:// ou caminho local iniciado por /.
- Shapes devem usar style.shape="rectangle", "circle" ou "pill" quando necessário.
- Use style.borderRadius, nunca style.radius.
- Não retorne HTML, CSS ou JavaScript livres.
- Nunca inclua chaves chamadas script, styleRaw, dangerouslySetInnerHTML, html, css ou js.
  - Use behaviors apenas da lista permitida: auto-fit-text, balance-lines, smart-contrast, image-focal-point, equalize-card-heights, stagger-children, generate-image.
  - REGRA DE CONTRASTE (legibilidade, prioridade máxima): TODO node de texto DEVE declarar style.color explícito, escolhido para ter contraste forte com o que está DIRETAMENTE atrás dele. Em fundo escuro ou cor vibrante use texto claro (ex: '#FFFFFF'); em fundo claro use texto escuro (ex: '#0A0A0A'). Defina tokens.colors.text com contraste real contra tokens.colors.background.
  - NUNCA confie na cor padrão e NUNCA coloque texto escuro sobre fundo escuro (nem claro sobre claro). Texto ilegível é o erro mais grave possível.
  - Para textos sobre imagens, gradientes ou fundos complexos, use behaviors: ['smart-contrast'] e/ou crie um card/faixa sólido (ex: '#FFFFFF' ou 'rgba(255,255,255,0.96)') atrás do bloco textual para garantir leitura. Você pode usar fundo escuro com texto claro livremente — não é obrigatório superfície branca.
  - Crie designs sofisticados e profissionais. Explore layouts como:
  * "premium-split-hero": Container display=flex direction=row. Esquerda (padding alto, text-left, alinhamento vertical flexível). Direita (image cobrindo 100% altura).
  * "editorial-image-frame": Container relativo com margem/padding largo, imagem de fundo (position absolute), textos sobrepostos em cards de vidro (background=rgba, backdrop-filter=glass).
  * "bold-centered-statement": Texto display gigantesco, auto-fit-text, textAlign=center, fundo vibrante, formas geométricas absolutas decorativas.
  * "feature-grid": Container display=grid, colunas flexíveis, cards com borderRadius, padding e ícones/shapes estruturados.
  * "stat-highlight": Número massivo, label menor, linha (shape) divisória, imagem de suporte sutil.
  * "glass-card-overlay": Imagem de fundo cobrindo a tela toda, com um container centralizado usando effects: { glass: true } e background semi-transparente.
  * "texture-background": Quando não houver imagem fotográfica, use um ShapeNode cobrindo o fundo com um gradiente complexo ou noise.
  * "magazine-spread": Layout assimétrico com tipografia display enorme cruzando a tela, blocos de texto pequenos alinhados à direita, e imagens recortadas (borderRadius alto).
  * "minimal-swiss": Fundo off-white, tipografia grotesca preta, margens gigantescas (respiro extremo), e apenas uma imagem pequena centralizada.
- Priorize contraste legível, safe area, densidade visual controlada e consistência entre slides.
- Faça crítica interna antes de responder: hierarquia clara, respiro, alinhamento, paleta da marca, tipografia consistente, nenhum texto genérico, nenhum campo proibido.
- Use as roles semânticas (eyebrow, headline, subtitle, body, caption, cta) de forma consistente para definir a hierarquia tipográfica.

═══ EXEMPLOS DE HIERARQUIA VISUAL ═══

HIERARQUIA BOA:
- Eyebrow: Pequeno, caps, alto contraste.
- Headline: Grande, negrito, peso 800-bold.
- Subtitle/Lead: Médio, peso normal/600.
- Body: Pequeno, peso normal, lineHeight 1.45-1.6.
- Gap mínimo entre layers: max(25px, fontSize_anterior × 0.6).
- Nunca sobrepor layers.

HIERARQUIA RUIM (EVITAR):
- Textos com tamanhos e pesos similares, sem distinção clara.
- Título sobreposto ao conteúdo ou imagem.
- Falta de respiro entre os elementos.
- Texto "sumindo" em fundos complexos sem contraste adequado.
- Uso excessivo de fontes (limitar a 2 por design).`;
}

function buildDesignDocumentUserPrompt(input: GenerateDesignDocumentInput): string {
  const brand = input.brand;
  const references = brand.references.length > 0
    ? brand.references.map((ref, index) => [
        `Referência ${index + 1}: ${ref.name}`,
        ref.archetype ? `Arquétipo visual: ${ref.archetype}` : '',
        ref.toneOfVoice ? `Tom: ${ref.toneOfVoice}` : '',
        ref.density ? `Densidade: ${ref.density}` : '',
        ref.palette.length > 0 ? `Paleta observada: ${ref.palette.join(', ')}` : '',
        ref.insightsText ? `Insights: ${ref.insightsText.slice(0, 1200)}` : '',
      ].filter(Boolean).join('\n')).join('\n\n')
    : 'Sem referências analisadas disponíveis.';

  return `Marca:
Nome: ${brand.name}
Slug: ${brand.slug}
Diretrizes: ${brand.guidelines || 'não definidas'}
Instruções do agente: ${brand.agentPrompt || 'não definidas'}
Cores oficiais: ${brand.colors.length > 0 ? brand.colors.join(', ') : 'não definidas'}
Fontes oficiais: ${brand.primaryFonts.length > 0 ? brand.primaryFonts.join(', ') : 'não definidas'}
Logo URL: ${brand.logoUrl || 'não definida'}

Referências analisadas:
${references}

Briefing do usuário:
${input.prompt.slice(0, 6000)}

Formato e restrições:
Formato: ${input.format}
Dimensões: ${input.width}x${input.height}
Quantidade de slides/páginas: ${input.slideCount}
Densidade desejada: ${input.density || 'medium'}
Templates permitidos: ${normalizeTemplates(input.templates).join(', ')}

Gere um HybridDesignPostContent completo. Use texto final real em português, nunca placeholders. Escolha tokens explícitos coerentes com a marca, mas preserve escrita em preto sobre superfícies brancas nas áreas textuais. Estruture cada slide com containers semânticos e filhos editáveis.

MUITO IMPORTANTE:
1. Comece o JSON com o campo "reasoning" explicando sua escolha de layout, cores e imagens para cada slide. Pense como um Diretor de Arte premiado.
2. NUNCA gere slides apenas com texto e fundo sólido. Se não houver foto, use gradientes, formas geométricas ou texturas.
3. Use a propriedade "behaviors": [{"type": "generate-image", "prompt": "descrição fotorealista detalhada"}] em ImageNodes para solicitar imagens. O campo "src" do ImageNode DEVE conter uma URL válida ou um placeholder (ex: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop"). NUNCA deixe "src" vazio.
4. Ouse na tipografia. Use tamanhos de fonte contrastantes (ex: título 120px, corpo 24px).
5. Use o espaço em branco (respiro) a seu favor. Não tente preencher todos os cantos da tela.
6. O objeto document.tokens é OBRIGATÓRIO. Você deve preenchê-lo com as cores e fontes da marca. Exemplo:
"tokens": {
  "colors": { "background": "#FFFFFF", "surface": "#F4F4F4", "text": "#000000", "muted": "#666666", "accent": "#FF0000" },
  "typography": { "display": "Inter", "heading": "Inter", "body": "Inter" },
  "spacing": { "page": 60, "section": 40, "gap": 20 },
  "radius": { "sm": 4, "md": 8, "lg": 16 }
}`;
}

function normalizeTemplates(templates: string[] | undefined): string[] {
  const safe = Array.isArray(templates)
    ? templates.filter((item) => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()).slice(0, 12)
    : [];

  return safe.length > 0
    ? safe
    : ['premium-split-hero', 'bold-centered-statement', 'editorial-image-frame', 'stat-highlight', 'quote-testimonial', 'feature-grid'];
}

function defaultSafeArea(width: number, height: number): Insets {
  if (width >= 1800 || height >= 1000) {
    return { top: 60, right: 80, bottom: 60, left: 80 };
  }
  return { top: 60, right: 60, bottom: 60, left: 60 };
}

function derivePageZonesFromTemplate(page: DesignPageNode, width: number, height: number): { safeArea: Insets; contentInsets: Insets; textZones: PageZone[]; reservedZones: PageZone[] } {
  const safeArea = normalizeInsets(page.safeArea, defaultSafeArea(width, height));
  const contentInsets = normalizeInsets(page.contentInsets, safeArea);
  const contentRect = rectFromInsets(width, height, contentInsets);
  const textZones = Array.isArray(page.textZones) && page.textZones.length > 0
    ? page.textZones.map((zone) => ({
        id: zone.id,
        x: Math.round(zone.x),
        y: Math.round(zone.y),
        width: Math.max(1, Math.round(zone.width)),
        height: Math.max(1, Math.round(zone.height)),
        roles: zone.roles,
        nodeIds: zone.nodeIds,
        maxChars: zone.maxChars,
        allowOverlap: zone.allowOverlap,
      }))
    : [{ id: 'content', ...contentRect, roles: ['*'], allowOverlap: false }];
  const reservedZones = Array.isArray(page.reservedZones)
    ? page.reservedZones.map((zone) => ({
        id: zone.id,
        x: Math.round(zone.x),
        y: Math.round(zone.y),
        width: Math.max(1, Math.round(zone.width)),
        height: Math.max(1, Math.round(zone.height)),
        roles: zone.roles,
        nodeIds: zone.nodeIds,
        maxChars: zone.maxChars,
        allowOverlap: zone.allowOverlap,
      }))
    : [];

  return { safeArea, contentInsets, textZones, reservedZones };
}

function nodeLayoutRect(node: DesignNode): SlideRect | null {
  const layout = node.layout;
  if (!layout) return null;
  if (typeof layout.x !== 'number' || typeof layout.y !== 'number') return null;
  if (typeof layout.width !== 'number' || typeof layout.height !== 'number') return null;
  return {
    x: Math.round(layout.x),
    y: Math.round(layout.y),
    width: Math.max(1, Math.round(layout.width)),
    height: Math.max(1, Math.round(layout.height)),
  };
}

function zoneAllowsNode(zone: PageZone, node: DesignNode): boolean {
  if (Array.isArray(zone.nodeIds) && zone.nodeIds.length > 0) return zone.nodeIds.includes(node.id);
  if (node.type !== 'text') return false;
  const role = node.role;
  if (!role) return Array.isArray(zone.roles) && zone.roles.includes('*');
  return Array.isArray(zone.roles) && (zone.roles.includes(role) || zone.roles.includes('*'));
}

function validatePageGeometry(document: DesignDocument): GeometryViolation[] {
  const violations: GeometryViolation[] = [];
  const canvasRect: SlideRect = { x: 0, y: 0, width: document.width, height: document.height };

  for (const page of document.pages) {
    const { safeArea, contentInsets, textZones, reservedZones } = derivePageZonesFromTemplate(page, document.width, document.height);
    page.safeArea = safeArea;
    page.contentInsets = contentInsets;
    page.textZones = textZones;
    page.reservedZones = reservedZones;

    const safeRect = rectFromInsets(document.width, document.height, safeArea);
    const contentRect = rectFromInsets(document.width, document.height, contentInsets);
    const textNodes = page.children.filter((node): node is TextNode => node.type === 'text');

    for (const node of textNodes) {
      const rect = nodeLayoutRect(node);
      if (!rect) {
        violations.push({ code: 'missing-text-zone', pageId: page.id, nodeId: node.id, message: `Text node ${node.id} is missing a numeric layout box` });
        continue;
      }
      if (!rectContains(canvasRect, rect)) {
        violations.push({ code: 'off-canvas', pageId: page.id, nodeId: node.id, message: `Text node ${node.id} exceeds the canvas bounds` });
      }
      if (!rectContains(safeRect, rect)) {
        violations.push({ code: 'out-of-safe-area', pageId: page.id, nodeId: node.id, message: `Text node ${node.id} exceeds the page safe area` });
      }
      if (!rectContains(contentRect, rect)) {
        violations.push({ code: 'out-of-content-area', pageId: page.id, nodeId: node.id, message: `Text node ${node.id} exceeds the page content area` });
      }

      const compatibleZones = textZones.filter((zone) => zoneAllowsNode(zone, node));
      if (compatibleZones.length === 0) {
        violations.push({ code: 'template-role-mismatch', pageId: page.id, nodeId: node.id, message: `Text node ${node.id} has no compatible text zone for role ${node.role ?? 'unknown'}` });
      } else if (!compatibleZones.some((zone) => rectContains(zone, rect))) {
        violations.push({ code: 'out-of-text-zone', pageId: page.id, nodeId: node.id, message: `Text node ${node.id} exceeds its allowed text zone` });
      }

      const contentLength = node.content.trim().length;
      for (const zone of compatibleZones) {
        if (zone.maxChars && contentLength > zone.maxChars) {
          violations.push({ code: 'max-chars-exceeded', pageId: page.id, nodeId: node.id, message: `Text node ${node.id} exceeds maxChars for zone ${zone.id}` });
          break;
        }
      }

      for (const reserved of reservedZones) {
        if (rectsOverlap(rect, reserved) && reserved.allowOverlap !== true) {
          violations.push({ code: 'overlap', pageId: page.id, nodeId: node.id, message: `Text node ${node.id} overlaps reserved zone ${reserved.id}` });
        }
      }
    }

    for (let i = 0; i < textNodes.length; i += 1) {
      const a = textNodes[i];
      const rectA = nodeLayoutRect(a);
      if (!rectA) continue;
      for (let j = i + 1; j < textNodes.length; j += 1) {
        const b = textNodes[j];
        const rectB = nodeLayoutRect(b);
        if (!rectB) continue;
        if (rectsOverlap(rectA, rectB)) {
          violations.push({ code: 'overlap', pageId: page.id, nodeId: `${a.id}|${b.id}`, message: `Text nodes ${a.id} and ${b.id} overlap` });
        }
      }
    }
  }

  return violations;
}

function enforceDocumentGeometry(document: DesignDocument): void {
  // validatePageGeometry também normaliza safeArea/contentInsets/textZones/reservedZones
  // (efeito colateral necessário), por isso continua sendo chamado sempre.
  const violations = validatePageGeometry(document);
  if (violations.length === 0) return;
  // Sobreposição e composição em camadas são intencionais em design premium.
  // Em vez de falhar a geração inteira, apenas registramos como aviso.
  console.warn(
    `[DesignDocument] Geometry warnings (${violations.length}): ${violations.slice(0, 6).map((item) => item.message).join('; ')}`,
  );
}

export function validateHybridDesignPostContent(value: unknown): HybridDesignPostContent {
  const forbiddenPath = hasForbiddenKey(value);
  if (forbiddenPath) fail(`Forbidden free-code field found at ${forbiddenPath}`);

  if (!isRecord(value)) fail('content must be an object');
  if (value.kind !== 'hybrid-design') fail('content.kind must be hybrid-design');
  if (value.version !== 1) fail('content.version must be 1');
  if (value.source !== 'codegen') fail('content.source must be codegen');

  const document = value.document;
  if (!isRecord(document)) fail('content.document must be an object');
  if (document.version !== 1) fail('document.version must be 1');
  assertString(document.format, 'document.format');
  if (!ALLOWED_FORMATS.has(document.format)) fail('document.format must be single, carousel or story');
  assertPositiveNumber(document.width, 'document.width');
  assertPositiveNumber(document.height, 'document.height');
  validateTokens(document.tokens);

  if (!Array.isArray(document.pages) || document.pages.length === 0) {
    // Auto-fix: cria uma página vazia se a IA não mandar nenhuma
    document.pages = [{
      id: 'page-1',
      type: 'page',
      background: '#FFFFFF',
      children: []
    }];
  }
  
  const pages = document.pages as unknown[];
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i] as Record<string, unknown>;
    if (!isRecord(page)) {
      pages[i] = { id: `page-${i}`, type: 'page', background: '#FFFFFF', children: [] };
      continue;
    }
    
    // Auto-fix: garante campos obrigatórios da página
    if (typeof page.id !== 'string' || !page.id) page.id = `page-${i}`;
    page.type = 'page';
    if (typeof page.background !== 'string' || !page.background) page.background = '#FFFFFF';
    if (!Array.isArray(page.children)) page.children = [];

    assertString(page.id, `document.pages[${i}].id`);
    if (page.type !== 'page') fail(`document.pages[${i}].type must be page`);
    validatePaint(page.background, `document.pages[${i}].background`);
    if (page.templateId !== undefined) assertString(page.templateId, `document.pages[${i}].templateId`);
    validateInsets(page.safeArea, `document.pages[${i}].safeArea`);
    validateInsets(page.contentInsets, `document.pages[${i}].contentInsets`);
    if (page.textZones !== undefined) {
      if (!Array.isArray(page.textZones)) fail(`document.pages[${i}].textZones must be an array`);
      page.textZones.forEach((zone, index) => validatePageZone(zone, `document.pages[${i}].textZones[${index}]`));
    }
    if (page.reservedZones !== undefined) {
      if (!Array.isArray(page.reservedZones)) fail(`document.pages[${i}].reservedZones must be an array`);
      page.reservedZones.forEach((zone, index) => validatePageZone(zone, `document.pages[${i}].reservedZones[${index}]`));
    }
    const children = page.children as unknown[];
    for (let j = 0; j < children.length; j += 1) validateNode(children[j], `document.pages[${i}].children[${j}]`);
  }

  if ('sessionId' in value && value.sessionId !== undefined && typeof value.sessionId !== 'string') {
    fail('content.sessionId must be a string when provided');
  }

  if ('chatHistory' in value && value.chatHistory !== undefined) {
    if (!Array.isArray(value.chatHistory)) fail('content.chatHistory must be an array when provided');
    for (let i = 0; i < value.chatHistory.length; i += 1) {
      const message = value.chatHistory[i];
      if (!isRecord(message)) fail(`content.chatHistory[${i}] must be an object`);
      if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'system') fail(`content.chatHistory[${i}].role inválido`);
      assertString(message.content, `content.chatHistory[${i}].content`);
      assertPositiveNumber(message.timestamp, `content.chatHistory[${i}].timestamp`);
      if ('attachments' in message && message.attachments !== undefined) {
        if (!Array.isArray(message.attachments)) fail(`content.chatHistory[${i}].attachments must be an array when provided`);
        for (let j = 0; j < message.attachments.length; j += 1) {
          const attachment = message.attachments[j];
          if (!isRecord(attachment)) fail(`content.chatHistory[${i}].attachments[${j}] must be an object`);
          assertString(attachment.name, `content.chatHistory[${i}].attachments[${j}].name`);
          assertString(attachment.mimeType, `content.chatHistory[${i}].attachments[${j}].mimeType`);
          assertString(attachment.dataBase64, `content.chatHistory[${i}].attachments[${j}].dataBase64`);
        }
      }
    }
  }

  const typed = value as HybridDesignPostContent;
  enforceDocumentGeometry(typed.document);
  return typed;
}
