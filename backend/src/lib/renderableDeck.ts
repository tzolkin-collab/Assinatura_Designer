import { buildSlideDocument } from './htmlDesign.js';

// Normaliza um post html-design para um "deck renderizável": um jeito único de obter
// width/height/fonts e o documento HTML completo de cada slide. É o que destrava
// export/Canva para html-design, o formato principal gerado pelo pipeline.
//
// Nota: posts legados com ir-design não podem mais ser renderizados (o compilador foi deletado).
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
  };

  if (c.kind === 'html-design' && Array.isArray(c.slides) && c.slides.length > 0) {
    const width = typeof c.width === 'number' ? c.width : 1080;
    const height = typeof c.height === 'number' ? c.height : 1080;
    const fonts = Array.isArray(c.fonts) ? c.fonts : ['Inter'];
    const slides = c.slides;
    return { width, height, count: slides.length, docAt: (i) => buildSlideDocument(slides[i]!, fonts, width, height) };
  }

  return null;
}
