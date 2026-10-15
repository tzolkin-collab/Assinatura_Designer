// Dimensões do canvas por formato. Antes viviam dentro do pipeline; o conector MCP precisa delas sem
// importar o pipeline inteiro (Gemini, filas, Puppeteer).

// Antes todo Design nascia 1080x1080 fixo — Stories/Reels/Pins pedem retrato e nunca havia como pedir
// isso. Apresentação continua sempre 16:9 (aspectRatio é ignorado pra ela). Dimensões em múltiplos de
// 1080 pra manter a resolução consistente com o que o resto do pipeline (raster, export) já espera.
export const CAROUSEL_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '3:4': { width: 1080, height: 1440 },
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
};

export function resolveCanvasSize(format: 'presentation' | 'carousel', aspectRatio?: string): { width: number; height: number } {
  if (format === 'presentation') return { width: 1920, height: 1080 };
  return CAROUSEL_DIMENSIONS[aspectRatio ?? '1:1'] ?? CAROUSEL_DIMENSIONS['1:1']!;
}
