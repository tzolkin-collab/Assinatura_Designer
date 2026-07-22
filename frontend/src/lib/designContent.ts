export type FabricaChatAttachment = {
  name: string;
  mimeType: string;
  dataBase64: string;
};

export type FabricaChatHistoryMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  attachments?: FabricaChatAttachment[];
};

export type EditablePagesResult =
  | { status: 'html'; content: HtmlDesignPostContent }
  | { status: 'not-editable'; reason: 'empty' | 'invalid' };

export type PreviewSource =
  | { kind: 'image'; url: string }
  | { kind: 'html-design'; content: HtmlDesignPostContent }
  | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizePostContent(content: unknown): unknown {
  if (Array.isArray(content) && content.length === 1 && isImageContent(content[0])) return content[0];
  return content;
}

function isImageContent(content: unknown): boolean {
  if (!isRecord(content)) return false;
  return content.type === 'image' || typeof content.dataUrl === 'string' || typeof content.url === 'string';
}

function extractImageUrlFromContent(content: unknown): string | null {
  const normalized = normalizePostContent(content);
  if (!isRecord(normalized)) return null;
  const url = normalized.dataUrl ?? normalized.url;
  return typeof url === 'string' && url.trim().length > 0 ? url : null;
}

export type UsedBrandAsset = {
  id: string;
  url: string;
  name: string;
};

export type HtmlDesignPostContent = {
  kind: 'html-design';
  version: 1;
  source?: string;
  width: number;
  height: number;
  format?: string;
  fonts: string[];
  slides: Array<{ html: string; css?: string }>;
  sessionId?: string;
  chatHistory?: FabricaChatHistoryMessage[];
  reasoning?: string;
  /** Assets da Biblioteca de Mídia que entraram de fato neste deck (detectado no
   *  HTML final + resolvidos pelo imageResolver) — ver pipeline.ts. */
  usedAssets?: UsedBrandAsset[];
};

export function extractUsedAssets(content: unknown): UsedBrandAsset[] {
  if (!isHtmlDesignContent(content)) return [];
  return Array.isArray(content.usedAssets) ? content.usedAssets : [];
}

export function isHtmlDesignContent(content: unknown): content is HtmlDesignPostContent {
  if (!isRecord(content)) return false;
  return content.kind === 'html-design'
    && Array.isArray(content.slides)
    && typeof content.width === 'number'
    && typeof content.height === 'number';
}

export function extractEditablePages(content: unknown): EditablePagesResult {
  if (content === null || content === undefined || content === '') return { status: 'not-editable', reason: 'empty' };

  if (isHtmlDesignContent(content)) {
    return { status: 'html', content };
  }

  return { status: 'not-editable', reason: 'invalid' };
}

export function extractPreviewSource(content: unknown, previewUrl?: string | null): PreviewSource {
  // Prefer rich deck/design formats over static preview images, so that interactive
  // slide previews, full capabilities (exporting/editing), and multi-slide controls are preserved.
  if (isHtmlDesignContent(content)) return { kind: 'html-design', content };

  // Fallback to static preview URL or image content URL
  if (typeof previewUrl === 'string' && previewUrl.trim().length > 0) {
    return { kind: 'image', url: previewUrl };
  }

  const imageUrl = extractImageUrlFromContent(content);
  if (imageUrl) return { kind: 'image', url: imageUrl };

  return null;
}

// O backend grava `sessionId` e `chatHistory` no envelope de todo deck (pipeline.ts).
export function extractChatHistory(content: unknown): FabricaChatHistoryMessage[] {
  if (isHtmlDesignContent(content)) {
    return content.chatHistory ?? [];
  }
  return [];
}

export function extractSessionId(content: unknown): string | null {
  if (isHtmlDesignContent(content)) {
    return content.sessionId ?? null;
  }
  return null;
}

export type AspectRatioTag = '1:1' | '3:4' | '4:5' | '16:9' | '9:16' | 'unknown';

export function extractDimensions(content: unknown): { width?: number; height?: number } {
  if (!isRecord(content)) return {};

  if (isHtmlDesignContent(content)) {
    const firstSlideRaw = Array.isArray(content.slides) ? content.slides[0] : undefined;
    const firstSlide = isRecord(firstSlideRaw) ? (firstSlideRaw as Record<string, unknown>) : undefined;
    if (firstSlide && (isFiniteNumber(firstSlide.width) || isFiniteNumber(firstSlide.height))) {
      return {
        width: isFiniteNumber(firstSlide.width) ? firstSlide.width : undefined,
        height: isFiniteNumber(firstSlide.height) ? firstSlide.height : undefined,
      };
    }
    return {
      width: isFiniteNumber(content.width) ? content.width : undefined,
      height: isFiniteNumber(content.height) ? content.height : undefined,
    };
  }

  const fallback = content as Record<string, unknown>;
  return {
    width: isFiniteNumber(fallback.width) ? fallback.width : undefined,
    height: isFiniteNumber(fallback.height) ? fallback.height : undefined,
  };
}

export function getAspectRatioTag(width?: number, height?: number): AspectRatioTag {
  if (!width || !height || width <= 0 || height <= 0) return 'unknown';
  const ratio = width / height;

  if (Math.abs(ratio - 1) < 0.15) return '1:1';
  if (ratio > 1.65) return '16:9';
  if (ratio < 0.5) return '9:16';
  if (ratio < 0.85) return '4:5';
  return '3:4';
}
