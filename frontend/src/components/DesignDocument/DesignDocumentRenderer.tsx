'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  focalPointToObjectPosition,
  isDesignDocument,
  layoutToStyle,
  safeBackgroundColor,
  safeBackgroundImage,
  sanitizeImageUrl,
  textToStyle,
  tokenVars,
  visualToStyle,
  type ContainerNode,
  type DesignDocument,
  type DesignNode,
  type DesignPageNode,
  type DesignTokens,
  type ImageNode,
  type ShapeNode,
  type TextNode,
} from '@/lib/designDocument';
import styles from './DesignDocumentRenderer.module.css';

export interface DesignDocumentRendererProps {
  document: DesignDocument | unknown;
  className?: string;
  activeSlide?: number;
  onSlideChange?: (index: number) => void;
  hideNav?: boolean;
  mode?: 'contain' | 'cover';
}

interface SlideFrameProps {
  page: DesignPageNode;
  tokens: DesignTokens;
  canvasWidth: number;
  canvasHeight: number;
  mode: 'contain' | 'cover';
}

interface NodeViewProps {
  node: DesignNode;
  tokens: DesignTokens;
}

function SlideFrame({ page, tokens, canvasWidth, canvasHeight, mode }: SlideFrameProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      setScale(mode === 'cover' ? Math.max(width / canvasWidth, height / canvasHeight) : width / canvasWidth);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [canvasWidth, canvasHeight, mode]);

  const pageStyle: CSSProperties = {
    backgroundColor: safeBackgroundColor(page.background, tokens) ?? 'var(--dd-color-background)',
    backgroundImage: safeBackgroundImage(page.background, tokens),
  };

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
          <PageNodeView page={page} tokens={tokens} style={pageStyle} />
        </div>
      )}
    </div>
  );
}

function PageNodeView({ page, tokens, style }: { page: DesignPageNode; tokens: DesignTokens; style: CSSProperties }) {
  const className = [styles.page, tokens.effects?.grain ? styles.pageGrain : ''].filter(Boolean).join(' ');

  return (
    <div className={className} style={style} aria-label={page.name ?? 'Design page'}>
      {page.children.map((node) => (
        <NodeView key={node.id} node={node} tokens={tokens} />
      ))}
    </div>
  );
}

function NodeView({ node, tokens }: NodeViewProps) {
  if (node.type === 'container') return <ContainerNodeView node={node} tokens={tokens} />;
  if (node.type === 'text') return <TextNodeView node={node} tokens={tokens} />;
  if (node.type === 'image') return <ImageNodeView node={node} tokens={tokens} />;
  if (node.type === 'shape') return <ShapeNodeView node={node} tokens={tokens} />;
  return null;
}

function ContainerNodeView({ node, tokens }: { node: ContainerNode; tokens: DesignTokens }) {
  const style: CSSProperties = {
    ...layoutToStyle(node.layout),
    ...visualToStyle(node.style, tokens),
  };

  return (
    <div className={`${styles.node} ${styles.container}`} style={style} data-role={node.role}>
      {node.children.map((child) => (
        <NodeView key={child.id} node={child} tokens={tokens} />
      ))}
    </div>
  );
}

function TextNodeView({ node, tokens }: { node: TextNode; tokens: DesignTokens }) {
  if (!node.content) return null;

  const className = [
    styles.node,
    styles.text,
    node.role ? styles[node.role] : '',
    node.behaviors?.some((behavior) => behavior.type === 'balance-lines') ? styles.balanceLines : '',
  ].filter(Boolean).join(' ');

  const style: CSSProperties = {
    ...layoutToStyle(node.layout),
    ...textToStyle(node.style, tokens, node.behaviors),
  };

  return <div className={className} style={style}>{node.content}</div>;
}

function ImageNodeView({ node, tokens }: { node: ImageNode; tokens: DesignTokens }) {
  const src = sanitizeImageUrl(node.src);
  const frameStyle: CSSProperties = {
    ...layoutToStyle(node.layout),
    ...visualToStyle(node.style, tokens),
  };

  if (!src) {
    return (
      <div className={`${styles.node} ${styles.imageFrame}`} style={frameStyle}>
        <div className={styles.imagePlaceholder}>Imagem bloqueada</div>
      </div>
    );
  }

  return (
    <div className={`${styles.node} ${styles.imageFrame}`} style={frameStyle}>
      <img
        src={src}
        alt={node.alt ?? ''}
        className={styles.image}
        style={{
          objectFit: node.style?.objectFit ?? 'cover',
          objectPosition: focalPointToObjectPosition(node.behaviors),
        }}
      />
    </div>
  );
}

function ShapeNodeView({ node, tokens }: { node: ShapeNode; tokens: DesignTokens }) {
  const className = [
    styles.node,
    styles.shape,
    node.style?.shape === 'circle' ? styles.circle : '',
    node.style?.shape === 'pill' ? styles.pill : '',
  ].filter(Boolean).join(' ');

  const style: CSSProperties = {
    ...layoutToStyle(node.layout),
    ...visualToStyle(node.style, tokens),
  };

  return <div className={className} style={style} aria-hidden />;
}

export default function DesignDocumentRenderer({
  document,
  className,
  activeSlide: controlledSlide,
  onSlideChange,
  hideNav = false,
  mode = 'contain',
}: DesignDocumentRendererProps) {
  const [internalIdx, setInternalIdx] = useState(0);

  if (!isDesignDocument(document)) {
    return <div className={`${styles.invalid} ${className ?? ''}`}>DesignDocument inválido ou inseguro</div>;
  }

  const rawIdx = controlledSlide ?? internalIdx;
  const activeIdx = Math.min(Math.max(rawIdx, 0), document.pages.length - 1);
  const cssVars = tokenVars(document.tokens);

  const handleChange = (i: number) => {
    if (controlledSlide === undefined) setInternalIdx(i);
    onSlideChange?.(i);
  };

  return (
    <div className={`${styles.renderer} ${mode === 'cover' ? styles.rendererCover : ''} ${className ?? ''}`} style={cssVars}>
      <SlideFrame
        page={document.pages[activeIdx]}
        tokens={document.tokens}
        canvasWidth={document.width}
        canvasHeight={document.height}
        mode={mode}
      />
      {!hideNav && document.pages.length > 1 && (
        <div className={styles.nav}>
          {document.pages.map((page, i) => (
            <button
              key={page.id}
              type="button"
              className={`${styles.dot} ${i === activeIdx ? styles.dotActive : ''}`}
              onClick={() => handleChange(i)}
              title={`Slide ${i + 1}`}
              aria-label={`Ver slide ${i + 1}`}
            />
          ))}
        </div>
      )}
      {!hideNav && <div className={styles.meta}>Slide {activeIdx + 1} / {document.pages.length}</div>}
    </div>
  );
}
