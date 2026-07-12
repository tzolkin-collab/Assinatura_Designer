'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { DesignIR, SlideNode, ElementNode, BackgroundDef } from '@/lib/designIR/types';

// Renderer read-only e leve de um envelope `ir-design`. Espelha o layout do
// HtmlSlideRenderer/DesignRenderer (auto-scale via ResizeObserver, aspect-ratio
// no wrapper), mas desenha a árvore IR diretamente em divs — sem lógica de
// edição/drag. Usado no preview da Fábrica durante e após a geração.

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

function backgroundStyle(bg: BackgroundDef | undefined): CSSProperties {
  if (!bg) return { background: '#ffffff' };
  if (bg.type === 'gradient' && bg.gradient) return { background: bg.gradient };
  if (bg.type === 'image' && bg.src) {
    return { backgroundImage: `url(${bg.src})`, backgroundSize: 'cover', backgroundPosition: 'center' };
  }
  return { background: bg.color ?? '#ffffff' };
}

function clipPathFor(shapeType: ElementNode['shapeType']): string | undefined {
  switch (shapeType) {
    case 'triangle': return 'polygon(50% 0%, 0% 100%, 100% 100%)';
    case 'polygon':  return 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)';
    default: return undefined;
  }
}

function elementStyle(el: ElementNode): CSSProperties {
  const s = el.style ?? {};
  const isCircle = el.type === 'shape' && el.shapeType === 'circle';
  const css: CSSProperties = {
    position: 'absolute',
    left: el.bounds.x,
    top: el.bounds.y,
    width: el.bounds.width,
    height: el.bounds.height,
    zIndex: el.zIndex,
    opacity: s.opacity,
    transform: el.bounds.rotation ? `rotate(${el.bounds.rotation}deg)` : undefined,
    // Typography
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    fontWeight: s.fontWeight as CSSProperties['fontWeight'],
    lineHeight: s.lineHeight,
    letterSpacing: s.letterSpacing,
    textAlign: s.textAlign,
    textTransform: s.textTransform,
    fontStyle: s.italic ? 'italic' : undefined,
    textDecoration: s.textDecoration,
    color: s.color,
    // Box / appearance
    background: s.background ?? s.backgroundColor,
    borderRadius: isCircle ? '50%' : s.borderRadius,
    borderWidth: s.borderWidth,
    borderColor: s.borderColor,
    borderStyle: s.borderStyle ?? (s.borderWidth ? 'solid' : undefined),
    boxShadow: s.boxShadow,
    backdropFilter: s.backdropFilter,
    padding: s.padding,
    overflow: s.overflow ?? 'hidden',
    clipPath: clipPathFor(el.shapeType),
    // Flex (defaults faithful to IRCanvasEditor)
    display: s.display ?? 'flex',
    flexDirection: s.flexDirection as CSSProperties['flexDirection'],
    alignItems: s.alignItems ?? (el.type === 'text' ? 'flex-start' : 'center'),
    justifyContent: s.justifyContent ?? (el.type === 'text' ? 'flex-start' : 'center'),
    gap: s.gap,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  };
  return css;
}

function SlideView({ slide }: { slide: SlideNode }) {
  const elements = useMemo(
    () => [...(slide.elements ?? [])].filter(Boolean).sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)),
    [slide.elements],
  );
  const overlay = slide.background?.overlay;
  return (
    <>
      {overlay && (
        <div style={{ position: 'absolute', inset: 0, background: overlay, zIndex: 0, pointerEvents: 'none' }} />
      )}
      {elements.map((el) => {
        if (el.visible === false) return null;
        return (
          <div key={el.id} style={elementStyle(el)}>
            {el.type === 'text' && <span>{el.content}</span>}
            {el.type === 'image' && el.src && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={el.src}
                alt={el.name ?? ''}
                style={{ width: '100%', height: '100%', objectFit: el.style?.objectFit ?? 'cover', display: 'block' }}
              />
            )}
          </div>
        );
      })}
    </>
  );
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
    ...backgroundStyle(slide.background),
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
            <SlideView slide={slide} />
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
