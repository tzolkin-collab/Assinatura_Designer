import { buildSlideDocument } from './htmlDesign.js';
import { compileSlideToDocument } from './designIR/compiler.js';
import type { SlideNode as IRSlideNode } from './designIR/types.js';

// Normaliza um post (html-design OU ir-design) para um "deck renderizável": um
// jeito único de obter width/height/fonts e o documento HTML completo de cada
// slide (compilando o IR quando necessário). É o que destrava export/Canva para
// html-design, o formato principal gerado hoje. IR é um motor legado mantido para
// compatibilidade com posts antigos, mas não é mais gerado pelo pipeline.
//
// Vive em lib/ (e não em routes/) porque o worker de export do Canva também
// precisa dele — duas cópias divergiriam na primeira mudança de formato.
export interface RenderableDeck {
  width: number;
  height: number;
  count: number;
  docAt: (idx: number) => string;
}

export function resolveRenderableDeck(content: unknown): RenderableDeck | null {
  if (!content || typeof content !== 'object') return null;
  const c = content as {
    kind?: string;
    width?: number;
    height?: number;
    fonts?: string[];
    slides?: Array<{ html: string; css?: string }>;
    ir?: { width?: number; height?: number; fonts?: string[]; slides?: unknown[] };
  };

  if (c.kind === 'html-design' && Array.isArray(c.slides) && c.slides.length > 0) {
    const width = typeof c.width === 'number' ? c.width : 1080;
    const height = typeof c.height === 'number' ? c.height : 1080;
    const fonts = Array.isArray(c.fonts) ? c.fonts : ['Inter'];
    const slides = c.slides;
    return { width, height, count: slides.length, docAt: (i) => buildSlideDocument(slides[i]!, fonts, width, height) };
  }

  if (c.kind === 'ir-design' && c.ir && Array.isArray(c.ir.slides) && c.ir.slides.length > 0) {
    const width = typeof c.ir.width === 'number' ? c.ir.width : (typeof c.width === 'number' ? c.width : 1080);
    const height = typeof c.ir.height === 'number' ? c.ir.height : (typeof c.height === 'number' ? c.height : 1080);
    const fonts = Array.isArray(c.ir.fonts) ? c.ir.fonts : (Array.isArray(c.fonts) ? c.fonts : ['Inter']);
    const slides = c.ir.slides;
    return { width, height, count: slides.length, docAt: (i) => compileSlideToDocument(slides[i] as IRSlideNode, fonts, width, height) };
  }

  return null;
}
