'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

export interface HtmlSlide {
  html: string;
  css?: string;
}

export interface HtmlDesignContentLike {
  kind?: string;
  width: number;
  height: number;
  fonts: string[];
  slides: HtmlSlide[];
}

export interface HtmlSlideRendererProps {
  content: HtmlDesignContentLike | unknown;
  activeSlide?: number;
  onSlideChange?: (index: number) => void;
  hideNav?: boolean;
  mode?: 'contain' | 'cover';
  className?: string;
  inspectorMode?: boolean;
}

function isHtmlDesign(value: unknown): value is HtmlDesignContentLike {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.slides) && typeof v.width === 'number' && typeof v.height === 'number';
}

function sanitize(s: string): string {
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?(?:iframe|object|embed|link|meta)[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

function fontsHref(fonts: string[]): string {
  const fam = (Array.isArray(fonts) ? fonts : [])
    .filter((f) => typeof f === 'string' && /^[\w\s]+$/.test(f.trim()))
    .slice(0, 4)
    .map((f) => `family=${encodeURIComponent(f.trim())}:wght@300;400;500;600;700;800;900`);
  if (fam.length === 0) fam.push('family=Inter:wght@400;500;700;800');
  return `https://fonts.googleapis.com/css2?${fam.join('&')}&display=swap`;
}

function buildSlideDoc(slide: HtmlSlide, fonts: string[], width: number, height: number, inspectorMode?: boolean): string {
  const css = sanitize(slide.css ?? '');
  const html = sanitize(slide.html ?? '');
  
  const inspectorScript = inspectorMode ? `
<script>
  document.addEventListener('mouseover', (e) => {
    if (e.target === document.body || e.target.classList.contains('slide-root')) return;
    e.target.dataset.originalOutline = e.target.style.outline || '';
    e.target.dataset.originalCursor = e.target.style.cursor || '';
    e.target.style.outline = '2px solid #FF6B35';
    e.target.style.cursor = 'crosshair';
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target === document.body || e.target.classList.contains('slide-root')) return;
    e.target.style.outline = e.target.dataset.originalOutline || '';
    e.target.style.cursor = e.target.dataset.originalCursor || '';
  });
  document.addEventListener('click', (e) => {
    if (e.target === document.body || e.target.classList.contains('slide-root')) return;
    e.preventDefault();
    e.stopPropagation();
    
    const target = e.target;
    let identifier = target.tagName.toLowerCase();
    if (target.id) {
      identifier += '#' + target.id;
    } else if (target.className && typeof target.className === 'string') {
      identifier += '.' + target.className.split(' ').join('.');
    }
    
    const data = {
      tagName: target.tagName.toLowerCase(),
      id: target.id,
      className: typeof target.className === 'string' ? target.className : '',
      text: target.textContent?.slice(0, 50).trim(),
      src: target.src,
      href: target.href,
      identifier
    };
    
    window.parent.postMessage({ type: 'ELEMENT_SELECTED', data }, '*');
  }, true);
</script>
` : '';

  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${fontsHref(fonts)}" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box;}html,body{width:${width}px;height:${height}px;overflow:hidden;}.slide-root{width:${width}px;height:${height}px;position:relative;overflow:hidden;}${css}</style>
</head><body><div class="slide-root">${html}</div>${inspectorScript}</body></html>`;
}

export default function HtmlSlideRenderer({
  content,
  activeSlide: controlledSlide,
  onSlideChange,
  hideNav = false,
  mode = 'contain',
  className,
  inspectorMode,
}: HtmlSlideRendererProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [internalIdx, setInternalIdx] = useState(0);

  const valid = isHtmlDesign(content);
  const width = valid ? content.width : 1080;
  const height = valid ? content.height : 1080;

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

  const slides = valid ? content.slides : [];
  const rawIdx = controlledSlide ?? internalIdx;
  const activeIdx = Math.min(Math.max(rawIdx, 0), Math.max(0, slides.length - 1));

  const srcDoc = useMemo(() => {
    if (!valid || !slides[activeIdx]) return '';
    return buildSlideDoc(slides[activeIdx], content.fonts, width, height, inspectorMode);
  }, [valid, slides, activeIdx, content, width, height, inspectorMode]);

  if (!valid) {
    return <div className={className} style={{ display: 'grid', placeItems: 'center', color: '#888', fontSize: 12 }}>Design inválido</div>;
  }

  const handleChange = (i: number) => {
    if (controlledSlide === undefined) setInternalIdx(i);
    onSlideChange?.(i);
  };

  const innerStyle: CSSProperties = {
    width,
    height,
    border: 0,
    transform: `scale(${scale})`,
    transformOrigin: mode === 'cover' ? 'center center' : 'top left',
    ...(mode === 'cover'
      ? { position: 'absolute', top: '50%', left: '50%', marginTop: -height / 2, marginLeft: -width / 2 }
      : {}),
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
          <iframe
            title={`Slide ${activeIdx + 1}`}
            sandbox={inspectorMode ? "allow-scripts allow-same-origin" : ""}
            srcDoc={srcDoc}
            scrolling="no"
            style={innerStyle}
          />
        )}
      </div>
      {!hideNav && slides.length > 1 && (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 8 }}>
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleChange(i)}
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
