'use client';

import { memo, useMemo } from 'react';
import HtmlSlideRenderer, { type HtmlSlide } from './HtmlSlideRenderer';

interface SlideThumbProps {
  /** Mesmo formato do documento do editor: medidas e fontes são opcionais, com os mesmos padrões do editor. */
  content: { kind?: string; width?: number; height?: number; fonts?: string[]; fontFaces?: unknown; slides: HtmlSlide[] };
  index: number;
  className?: string;
}

const EMPTY_FONTS: string[] = [];

/**
 * Miniatura de UM slide: o mesmo renderizador do palco, num quadro pequeno. O conteúdo é recortado para
 * só aquele slide e memorizado pelo próprio slide, então editar um slide não refaz as outras miniaturas.
 * O iframe fica sem clique (o botão que envolve a miniatura é quem recebe o toque).
 */
function SlideThumb({ content, index, className }: SlideThumbProps) {
  const slide = content.slides[index];
  const width = content.width ?? 1080;
  const height = content.height ?? 1080;
  const fonts = content.fonts ?? EMPTY_FONTS;
  const { fontFaces } = content;
  const single = useMemo(
    () => ({ kind: content.kind, width, height, fonts, fontFaces, slides: slide ? [slide] : [] }),
    [content.kind, width, height, fonts, fontFaces, slide],
  );

  return (
    <div className={className} style={{ position: 'relative', aspectRatio: `${width} / ${height}`, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden="true">
        <HtmlSlideRenderer content={single} hideNav />
      </div>
    </div>
  );
}

export default memo(SlideThumb);
