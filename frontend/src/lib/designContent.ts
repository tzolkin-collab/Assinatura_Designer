import type { DesignPage, Layer } from '@/components/Fabrica/DesignRenderer';


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



export type FabricaDesignPostContent = {
  kind: 'fabrica-design';
  version: 1;
  sessionId: string;
  pages: DesignPage[];
  chatHistory?: FabricaChatHistoryMessage[];
};

export type EditablePagesResult =
  | { status: 'editable'; pages: DesignPage[]; source: 'legacy-pages' | 'image-post'; warnings?: string[] }
  | { status: 'html'; content: HtmlDesignPostContent }
  | { status: 'not-editable'; reason: 'empty' | 'invalid' | 'image-without-url' };

export type PreviewSource =
  | { kind: 'image'; url: string }
  | { kind: 'design'; pages: DesignPage[]; width: number; height: number; source: 'legacy-pages' }
  | { kind: 'html-design'; content: HtmlDesignPostContent }
  | null;

const DEFAULT_CANVAS_SIZE = 1080;

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

function isLayer(value: unknown): value is Layer {
  if (!isRecord(value)) return false;
  return value.type === 'text' || value.type === 'image' || value.type === 'shape';
}

function isFabricaChatAttachment(value: unknown): value is FabricaChatAttachment {
  if (!isRecord(value)) return false;
  return typeof value.name === 'string'
    && typeof value.mimeType === 'string'
    && typeof value.dataBase64 === 'string';
}

function isFabricaChatHistoryMessage(value: unknown): value is FabricaChatHistoryMessage {
  if (!isRecord(value)) return false;
  return (value.role === 'user' || value.role === 'assistant' || value.role === 'system')
    && typeof value.content === 'string'
    && isFiniteNumber(value.timestamp)
    && (value.attachments === undefined || (Array.isArray(value.attachments) && value.attachments.every(isFabricaChatAttachment)));
}

function isDesignPage(value: unknown): value is DesignPage {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.layers)) return false;
  return value.layers.every(isLayer);
}

function imagePostToDesignPage(content: unknown): DesignPage[] | null {
  const imageUrl = extractImageUrlFromContent(content);
  if (!imageUrl) return null;

  return [{
    width: DEFAULT_CANVAS_SIZE,
    height: DEFAULT_CANVAS_SIZE,
    backgroundColor: '#ffffff',
    layers: [{
      id: 'generated-image-layer',
      type: 'image',
      url: imageUrl,
      x: 0,
      y: 0,
      width: DEFAULT_CANVAS_SIZE,
      height: DEFAULT_CANVAS_SIZE,
      zIndex: 1,
    }],
  }];
}

export function isLegacyDesignPages(content: unknown): content is DesignPage[] {
  return Array.isArray(content) && content.length > 0 && content.every(isDesignPage);
}

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
};

export function isHtmlDesignContent(content: unknown): content is HtmlDesignPostContent {
  if (!isRecord(content)) return false;
  return content.kind === 'html-design'
    && Array.isArray(content.slides)
    && typeof content.width === 'number'
    && typeof content.height === 'number';
}




export function isFabricaDesignContent(content: unknown): content is FabricaDesignPostContent {
  if (!isRecord(content)) return false;
  const pages = content.pages;
  const chatHistory = content.chatHistory;
  return content.kind === 'fabrica-design'
    && content.version === 1
    && typeof content.sessionId === 'string'
    && isLegacyDesignPages(pages)
    && (chatHistory === undefined || (Array.isArray(chatHistory) && chatHistory.every(isFabricaChatHistoryMessage)));
}

export function withUpdatedFabricaPages(content: FabricaDesignPostContent, pages: DesignPage[]): FabricaDesignPostContent {
  return {
    ...content,
    pages,
  };
}

export function extractEditablePages(content: unknown): EditablePagesResult {
  if (content === null || content === undefined || content === '') return { status: 'not-editable', reason: 'empty' };

  if (isHtmlDesignContent(content)) {
    return { status: 'html', content };
  }

  if (isFabricaDesignContent(content)) {
    return { status: 'editable', pages: content.pages, source: 'legacy-pages' };
  }

  if (isLegacyDesignPages(content)) {
    return { status: 'editable', pages: content, source: 'legacy-pages' };
  }



  if (isImageContent(normalizePostContent(content))) {
    const pages = imagePostToDesignPage(content);
    if (pages) return { status: 'editable', pages, source: 'image-post' };
    return { status: 'not-editable', reason: 'image-without-url' };
  }

  return { status: 'not-editable', reason: 'invalid' };
}

export function extractPreviewSource(content: unknown, previewUrl?: string | null): PreviewSource {
  // Prefer rich deck/design formats over static preview images, so that interactive
  // slide previews, full capabilities (exporting/editing), and multi-slide controls are preserved.
  if (isHtmlDesignContent(content)) return { kind: 'html-design', content };

  const editable = extractEditablePages(content);
  if (editable.status === 'editable' && editable.source !== 'image-post') {
    const firstPage = editable.pages[0];
    return {
      kind: 'design',
      pages: editable.pages,
      width: firstPage.width ?? DEFAULT_CANVAS_SIZE,
      height: firstPage.height ?? DEFAULT_CANVAS_SIZE,
      source: editable.source,
    };
  }

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
  if (isFabricaDesignContent(content) || isHtmlDesignContent(content)) {
    return content.chatHistory ?? [];
  }
  return [];
}

export function extractSessionId(content: unknown): string | null {
  if (isFabricaDesignContent(content)) {
    return content.sessionId;
  }
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

  if (isFabricaDesignContent(content)) {
    const firstPage = content.pages[0];
    if (firstPage) {
      return {
        width: isFiniteNumber(firstPage.width) ? firstPage.width : undefined,
        height: isFiniteNumber(firstPage.height) ? firstPage.height : undefined,
      };
    }
  }

  const editable = extractEditablePages(content);
  if (editable.status === 'editable' && editable.pages[0]) {
    const firstPage = editable.pages[0];
    return {
      width: isFiniteNumber(firstPage.width) ? firstPage.width : undefined,
      height: isFiniteNumber(firstPage.height) ? firstPage.height : undefined,
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
