'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './DesignRenderer.module.css';
import AnimatedLayerView from '@/components/shared/AnimatedLayerView';

export interface Layer {
  id: string;
  type: 'text' | 'image' | 'shape';
  name?: string;
  content?: string;
  url?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  textAlign?: 'left' | 'center' | 'right';
  lineHeight?: number;
  opacity?: number;
  borderRadius?: number;
  zIndex: number;
  rotation?: number;
  visible?: boolean;
  locked?: boolean;
  lockAspectRatio?: boolean;
  // Visual effects
  borderWidth?: number;
  borderColor?: string;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  gradientType?: 'linear' | 'radial' | 'none';
  gradientColor2?: string;
  gradientAngle?: number;
  letterSpacing?: number;
  verticalAlign?: 'top' | 'middle' | 'bottom';
  italic?: boolean;
  textDecoration?: 'none' | 'underline' | 'line-through';
  // Advanced shapes
  shapeType?: 'rectangle' | 'triangle' | 'polygon' | 'line' | 'star';
  // Animation
  animationIn?: 'none' | 'fade' | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right' | 'zoom-in' | 'zoom-out' | 'blur-in';
  animationDelay?: number;    // seconds
  animationDuration?: number; // seconds
  contrastBackground?: boolean;
  contrastBackgroundColor?: string;
  contrastBackgroundOpacity?: number;
  contrastBackgroundRadius?: number;
}

export interface DesignPage {
  backgroundColor?: string;
  backgroundImage?: string;
  layers?: Layer[];
  width?: number;
  height?: number;
  safeArea?: { top: number; right: number; bottom: number; left: number };
  contentInsets?: { top: number; right: number; bottom: number; left: number };
  textZones?: Array<{ id: string; x: number; y: number; width: number; height: number; roles?: string[]; nodeIds?: string[]; maxChars?: number; allowOverlap?: boolean }>;
  reservedZones?: Array<{ id: string; x: number; y: number; width: number; height: number; roles?: string[]; nodeIds?: string[]; maxChars?: number; allowOverlap?: boolean }>;
}

interface SlideFrameProps {
  page: DesignPage;
  canvasWidth: number;
  canvasHeight: number;
  mode?: 'contain' | 'cover';
}

function SlideFrame({ page, canvasWidth, canvasHeight, mode = 'contain' }: SlideFrameProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (mode === 'cover') {
        setScale(Math.max(width / canvasWidth, height / canvasHeight));
        return;
      }
      
      setScale(width / canvasWidth);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [canvasWidth, canvasHeight, mode]);

  const layers = [...(page.layers ?? [])].filter(Boolean).sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

  return (
    <div
      ref={outerRef}
      className={`${styles.slideOuter} ${mode === 'cover' ? styles.slideOuterCover : ''}`}
      style={mode === 'contain' ? { aspectRatio: `${canvasWidth} / ${canvasHeight}` } : undefined}
    >
      {scale > 0 && (
        <div
          className={styles.slideInner}
          style={{
            width: canvasWidth,
            height: canvasHeight,
            backgroundColor: page.backgroundColor ?? '#ffffff',
            backgroundImage: page.backgroundImage ? `url(${page.backgroundImage})` : 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            ...(mode === 'cover'
              ? {
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: `translate(-50%, -50%) scale(${scale})`,
                  transformOrigin: 'center center',
                }
              : {
                  transform: `scale(${scale})`,
                }),
          }}
        >
          {layers.map((layer, i) => (
            <AnimatedLayerView
              key={`${layer.id ?? 'layer'}-${i}`}
              layer={layer}
              index={i}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export interface DesignRendererProps {
  pages: DesignPage[];
  canvasWidth: number;
  canvasHeight: number;
  className?: string;
  activeSlide?: number;
  onSlideChange?: (index: number) => void;
  hideNav?: boolean;
  mode?: 'contain' | 'cover';
}

export default function DesignRenderer({
  pages,
  canvasWidth,
  canvasHeight,
  className,
  activeSlide: controlledSlide,
  onSlideChange,
  hideNav = false,
  mode = 'contain',
}: DesignRendererProps) {
  const [internalIdx, setInternalIdx] = useState(0);
  const isControlled = controlledSlide !== undefined;
  const activeIdx = isControlled ? controlledSlide : internalIdx;

  const handleChange = (i: number) => {
    if (!isControlled) setInternalIdx(i);
    onSlideChange?.(i);
  };

  if (!pages || pages.length === 0) return null;

  return (
    <div className={`${styles.renderer} ${mode === 'cover' ? styles.rendererCover : ''} ${className ?? ''}`}>
      <SlideFrame page={pages[activeIdx]} canvasWidth={canvasWidth} canvasHeight={canvasHeight} mode={mode} />
      {!hideNav && pages.length > 1 && (
        <div className={styles.nav}>
          {pages.map((_, i) => (
            <button
              key={i}
              className={`${styles.dot} ${i === activeIdx ? styles.dotActive : ''}`}
              onClick={() => handleChange(i)}
              title={`Slide ${i + 1}`}
            />
          ))}
        </div>
      )}
      {!hideNav && <div className={styles.meta}>Slide {activeIdx + 1} / {pages.length}</div>}
    </div>
  );
}
