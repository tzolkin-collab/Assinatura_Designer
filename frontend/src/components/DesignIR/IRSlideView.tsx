'use client';

import React from 'react';
import type { SlideNode, ElementNode } from '@/lib/designIR/types';
import {
  backgroundLayers,
  drawableElements,
  imageWrapperStyle,
  safeUrl,
  shapeStyle,
  textWrapperStyle,
  typographyAndBox,
} from '@/lib/designIR/style';

/**
 * O renderizador ÚNICO de um slide IR.
 *
 * Antes existiam três, divergentes: o canvas do editor (`IRCanvasEditor`), o preview da
 * Fábrica (`IRSlideRenderer`) e o compilador do backend (que gera o PNG). Só o
 * compilador era fiel — os outros dois desenhavam um subconjunto do estilo. O efeito
 * prático era a IA parecer mentirosa: ela aplicava uma sombra, o IR guardava a sombra,
 * o PNG exportado tinha a sombra, e a tela não mudava nada.
 *
 * Este componente espelha o compilador (via `lib/designIR/style.ts`). Ele é read-only:
 * quem precisa de interação (o editor) desenha a seleção como OVERLAY por cima, em vez
 * de injetar estilo nos elementos — assim a arte que se vê é exatamente a arte que sai.
 */

function IRElement({ el }: { el: ElementNode }) {
  if (el.visible === false) return null;

  if (el.type === 'text') {
    return (
      <div style={textWrapperStyle(el)}>
        <div style={{ width: '100%', whiteSpace: 'pre-wrap', wordBreak: 'break-word', ...typographyAndBox(el.style ?? {}) }}>
          {el.content ?? ''}
        </div>
      </div>
    );
  }

  if (el.type === 'image') {
    const src = safeUrl(el.src);
    // Sem src válido: bloco neutro, igual ao compilador (o assetValidator já deveria
    // ter corrigido). Mostrar um <img> quebrado seria pior que um placeholder.
    if (!src) return <div style={{ ...imageWrapperStyle(el), background: '#e5e7eb' }} />;

    return (
      <div style={imageWrapperStyle(el)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: el.style?.objectFit ?? 'cover', display: 'block' }}
        />
      </div>
    );
  }

  if (el.type === 'shape') {
    return <div style={shapeStyle(el)} />;
  }

  return null;
}

export interface IRSlideViewProps {
  slide: SlideNode;
  /** Desenhado por cima da arte (o editor usa para a moldura de seleção). */
  overlay?: React.ReactNode;
}

export default function IRSlideView({ slide, overlay }: IRSlideViewProps) {
  if (!slide) return null;

  return (
    <>
      {backgroundLayers(slide.background).map((css, i) => (
        <div key={`bg-${i}`} style={css} />
      ))}

      {drawableElements(slide.elements).map((el) => (
        <IRElement key={el.id} el={el} />
      ))}

      {overlay}
    </>
  );
}
