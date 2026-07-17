'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { DesignIR } from '@/lib/designIR/types';
import IRSlideView from '@/components/DesignIR/IRSlideView';

// Preview read-only de um envelope `ir-design`: cuida do enquadramento (auto-scale via
// ResizeObserver, aspect-ratio, navegação entre slides) e delega o DESENHO ao
// IRSlideView — o renderizador único, espelho do compilador que gera o PNG.
//
// Antes este arquivo tinha a própria cópia do desenho, e ela divergia do editor e do
// compilador. Três renderizadores, três resultados para o mesmo IR.

export interface IRDesignEnvelope {
  kind?: string;
  width?: number;
  height?: number;
  fonts?: string[];
  ir?: DesignIR;
}

export interface IRSlideRendererProps {
  content: IRDesignEnvelope | unknown;
  activeSlide?: number;
  hideNav?: boolean;
  mode?: 'contain' | 'cover';
  className?: string;
}

function isIrEnvelope(value: unknown): value is IRDesignEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const ir = (value as { ir?: unknown }).ir;
  if (typeof ir !== 'object' || ir === null) return false;
  return Array.isArray((ir as { slides?: unknown }).slides);
}

// Carrega as Google Fonts do design (uma vez por conjunto) injetando um <link>
// no head. Evita fallback visual de fonte no preview React (sem iframe).
function useGoogleFonts(fonts: string[] | undefined) {
  useEffect(() => {
    const fam = (Array.isArray(fonts) ? fonts : [])
      .filter((f) => typeof f === 'string' && /^[\w\s]+$/.test(f.trim()))
      .slice(0, 6)
      .map((f) => `family=${encodeURIComponent(f.trim())}:wght@300;400;500;600;700;800;900`);
    if (fam.length === 0) return;
    const href = `https://fonts.googleapis.com/css2?${fam.join('&')}&display=swap`;
    const id = `irfonts-${btoa(href).replace(/[^a-z0-9]/gi, '').slice(0, 24)}`;
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }, [fonts]);
}

export default function IRSlideRenderer({
  content,
  activeSlide: controlledSlide,
  hideNav = false,
  mode = 'contain',
  className,
}: IRSlideRendererProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [internalIdx, setInternalIdx] = useState(0);

  const valid = isIrEnvelope(content);
  const ir = valid ? (content as IRDesignEnvelope).ir! : undefined;
  const width = ir?.width ?? (valid ? (content as IRDesignEnvelope).width : undefined) ?? 1080;
  const height = ir?.height ?? (valid ? (content as IRDesignEnvelope).height : undefined) ?? 1080;
  const slides = ir?.slides ?? [];

  useGoogleFonts(ir?.fonts ?? (valid ? (content as IRDesignEnvelope).fonts : undefined));

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const { width: cw, height: ch } = entry.contentRect;
      if (cw <= 0 || ch <= 0) return;
      setScale(mode === 'cover' ? Math.max(cw / width, ch / height) : cw / width);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [width, height, mode]);

  const rawIdx = controlledSlide ?? internalIdx;
  const activeIdx = Math.min(Math.max(rawIdx, 0), Math.max(0, slides.length - 1));
  const slide = slides[activeIdx];

  if (!valid || !slide) {
    return (
      <div className={className} style={{ display: 'grid', placeItems: 'center', color: '#888', fontSize: 12 }}>
        Design ainda sendo montado…
      </div>
    );
  }

  const innerStyle: CSSProperties = {
    width,
    height,
    position: 'absolute',
    overflow: 'hidden',
    // O fundo NÃO vai aqui: o IRSlideView desenha as camadas (sólido/gradiente/imagem
    // + overlay) como o compilador faz. Aplicar o fundo no container mataria o overlay.
    background: '#ffffff',
    transform: `scale(${scale})`,
    transformOrigin: mode === 'cover' ? 'center center' : 'top left',
    ...(mode === 'cover'
      ? { top: '50%', left: '50%', marginTop: -height / 2, marginLeft: -width / 2 }
      : { top: 0, left: 0 }),
  };

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: mode === 'cover' ? '100%' : undefined }}>
      <div
        ref={outerRef}
        style={{
          position: 'relative',
          width: '100%',
          height: mode === 'cover' ? '100%' : undefined,
          aspectRatio: mode === 'contain' ? `${width} / ${height}` : undefined,
          overflow: 'hidden',
        }}
      >
        {scale > 0 && (
          <div style={innerStyle}>
            <IRSlideView slide={slide} />
          </div>
        )}
      </div>
      {!hideNav && slides.length > 1 && (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 8 }}>
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setInternalIdx(i)}
              aria-label={`Ver slide ${i + 1}`}
              style={{
                width: 8, height: 8, borderRadius: '50%', border: 0, cursor: 'pointer',
                background: i === activeIdx ? '#FF6B35' : 'rgba(0,0,0,0.2)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
