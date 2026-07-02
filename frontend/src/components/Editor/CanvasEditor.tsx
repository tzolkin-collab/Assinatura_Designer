'use client';

import React, { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import Image from 'next/image';
import { Rnd } from 'react-rnd';
import type { Layer } from '@/components/Fabrica/DesignRenderer';
import { useLatestRef } from '@/hooks/useLatestRef';
import { computeLayerStyle } from '@/lib/layerStyle';
import ZoomControls from './ZoomControls';
import { calculateSnapLines, type SnapLine, type Guide } from './SnapEngine';
import Ruler from './Ruler';
import GuideLayer from './GuideLayer';

// Maps to @keyframes in globals.css — mirrors AnimatedLayerView
const ANIM_KEYFRAME: Partial<Record<NonNullable<Layer['animationIn']>, string>> = {
  'fade':        'lyrFade',
  'slide-up':    'lyrSlideUp',
  'slide-down':  'lyrSlideDown',
  'slide-left':  'lyrSlideLeft',
  'slide-right': 'lyrSlideRight',
  'zoom-in':     'lyrZoomIn',
  'zoom-out':    'lyrZoomOut',
  'blur-in':     'lyrBlurIn',
};

// ── Zoom config ──────────────────────────────────────────────────────────────
// userZoom is a multiplier relative to the auto-computed fit scale.
// 1 = fit (canvas fills the container), >1 = zoomed in, <1 = zoomed out.
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const MIN_ZOOM = ZOOM_STEPS[0];
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];
const EPS = 1e-3;

function nextZoomStep(z: number): number {
  for (const s of ZOOM_STEPS) if (s > z + EPS) return s;
  return MAX_ZOOM;
}
function prevZoomStep(z: number): number {
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) if (ZOOM_STEPS[i] < z - EPS) return ZOOM_STEPS[i];
  return MIN_ZOOM;
}
function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** True when focus is on an element that should keep native Space behaviour. */
function isInteractiveTarget(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  return (
    ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(el.tagName) || el.isContentEditable
  );
}

export interface CanvasEditorHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  /** Reset to fit-to-screen (userZoom = 1). */
  zoomFit: () => void;
  /** Zoom to 1:1 actual pixel size (effectiveScale = 1). */
  zoomActual: () => void;
}

interface CanvasEditorProps {
  layers: Layer[];
  backgroundColor?: string;
  backgroundImage?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  selectedLayerIds?: string[];
  onLayerSelect?: (layer: Layer | null, e?: React.MouseEvent) => void;
  onLayersChange?: (layers: Layer[]) => void;
  onMarqueeSelect?: (ids: string[]) => void;
  /** Layer id currently playing a preview animation */
  previewLayerId?: string | null;
  /** Increments each time a preview is triggered for the same layer */
  previewKey?: number;
  snapEnabled?: boolean;
  guides?: Guide[];
}

function rectsIntersect(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeLayerForCanvas(layer: Layer, index: number, canvasWidth: number, canvasHeight: number): Layer {
  const rawX = finiteNumber(layer.x, 0);
  const rawY = finiteNumber(layer.y, 0);
  const x = Math.max(0, Math.min(Math.round(rawX), canvasWidth - 1));
  const y = Math.max(0, Math.min(Math.round(rawY), canvasHeight - 1));
  const width = Math.max(1, Math.min(Math.round(finiteNumber(layer.width, Math.round(canvasWidth * 0.3))), canvasWidth - x));
  const height = Math.max(1, Math.min(Math.round(finiteNumber(layer.height, Math.round(canvasHeight * 0.12))), canvasHeight - y));

  return {
    ...layer,
    id: layer.id || `layer-${index}`,
    x,
    y,
    width,
    height,
    zIndex: finiteNumber(layer.zIndex, index),
  };
}

function CanvasEditor({
  layers,
  backgroundColor = '#ffffff',
  backgroundImage,
  canvasWidth = 1080,
  canvasHeight = 1080,
  selectedLayerIds = [],
  onLayerSelect,
  onLayersChange,
  onMarqueeSelect,
  previewLayerId,
  previewKey = 0,
  snapEnabled = true,
  guides = [],
}: CanvasEditorProps, ref: React.Ref<CanvasEditorHandle>) {
  const outerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // fitScale: auto-computed so the canvas fills the container width.
  // userZoom: user multiplier on top of fitScale. effectiveScale = fitScale * userZoom.
  const [fitScale, setFitScale] = useState(0);
  const [userZoom, setUserZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const effectiveScale = fitScale * userZoom;

  const fitScaleRef = useLatestRef(fitScale);
  const userZoomRef = useLatestRef(userZoom);
  const panRef = useLatestRef(pan);
  const effScaleRef = useLatestRef(effectiveScale);

  // Space-to-pan
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const spaceHeldRef = useLatestRef(spaceHeld);
  const panStartRef = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);

  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  
  const [activeSnapLines, setActiveSnapLines] = useState<SnapLine[]>([]);
  const [internalGuides, setInternalGuides] = useState<Guide[]>(guides);
  const [showRulers, setShowRulers] = useState(false);
  const [showGuides, setShowGuides] = useState(true);

  // Sync internal guides if prop changes (optional)
  useEffect(() => {
    setInternalGuides(guides);
  }, [guides]);

  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const isMarqueeActiveRef = useRef(false);

  const safeLayers = layers
    .filter((layer): layer is Layer => Boolean(layer))
    .map((layer, index) => normalizeLayerForCanvas(layer, index, canvasWidth, canvasHeight));

  // Multi-drag: capture start positions when drag begins
  const dragStartPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const layersRef = useLatestRef(safeLayers);
  const selectedLayerIdsRef = useLatestRef(selectedLayerIds);
  const onMarqueeSelectRef = useLatestRef(onMarqueeSelect);

  // Keep pan within bounds: centre the canvas on any axis where it is smaller
  // than the container, otherwise clamp so its edges can't pull past the viewport.
  const clampPan = useCallback((p: { x: number; y: number }, eff: number) => {
    const el = outerRef.current;
    if (!el) return p;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const sw = canvasWidth * eff;
    const sh = canvasHeight * eff;
    const clampAxis = (v: number, scaled: number, container: number) =>
      scaled <= container ? (container - scaled) / 2 : Math.min(0, Math.max(container - scaled, v));
    return { x: clampAxis(p.x, sw, cw), y: clampAxis(p.y, sh, ch) };
  }, [canvasWidth, canvasHeight]);

  // Apply a zoom level, keeping the point under (focalX, focalY) — container-local
  // coords, defaulting to the centre — fixed on screen.
  const applyZoom = useCallback((targetZoom: number, focalX?: number, focalY?: number) => {
    const el = outerRef.current;
    const fit = fitScaleRef.current;
    if (!el || fit <= 0) return;
    const z = clampZoom(targetZoom);
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const fx = focalX ?? cw / 2;
    const fy = focalY ?? ch / 2;
    const e0 = fit * userZoomRef.current;
    const e1 = fit * z;
    const p0 = panRef.current;
    const cx = (fx - p0.x) / e0;
    const cy = (fy - p0.y) / e0;
    setUserZoom(z);
    setPan(clampPan({ x: fx - cx * e1, y: fy - cy * e1 }, e1));
  }, [clampPan, fitScaleRef, userZoomRef, panRef]);

  const zoomFit = useCallback(() => {
    setUserZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  useImperativeHandle(ref, () => ({
    zoomIn: () => applyZoom(nextZoomStep(userZoomRef.current)),
    zoomOut: () => applyZoom(prevZoomStep(userZoomRef.current)),
    zoomFit,
    zoomActual: () => {
      const fit = fitScaleRef.current;
      if (fit > 0) applyZoom(1 / fit);
    },
  }), [applyZoom, zoomFit, userZoomRef, fitScaleRef]);

  // Fit scale tracks the container width; reclamp pan when it changes.
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const nextFit = entry.contentRect.width / canvasWidth;
      setFitScale(nextFit);
      setPan((p) => clampPan(p, nextFit * userZoomRef.current));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [canvasWidth, clampPan, userZoomRef]);

  // Ctrl+wheel / pinch to zoom toward the cursor.
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0015);
      applyZoom(userZoomRef.current * factor, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyZoom, userZoomRef]);

  // Space held → pan mode (cursor + intercept canvas mousedown).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isInteractiveTarget()) return;
      if (!spaceHeldRef.current) setSpaceHeld(true);
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [spaceHeldRef]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const start = panStartRef.current;
      if (!start) return;
      setPan(clampPan(
        { x: start.px + (e.clientX - start.mx), y: start.py + (e.clientY - start.my) },
        effScaleRef.current,
      ));
    };
    const onUp = () => {
      if (panStartRef.current) {
        panStartRef.current = null;
        setIsPanning(false);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [clampPan, effScaleRef]);

  const handleOuterMouseDownCapture = (e: React.MouseEvent) => {
    if (!spaceHeldRef.current) return;
    // Intercept before Rnd / canvas handlers so panning never starts a drag or marquee.
    e.preventDefault();
    e.stopPropagation();
    panStartRef.current = { mx: e.clientX, my: e.clientY, px: panRef.current.x, py: panRef.current.y };
    setIsPanning(true);
  };

  const toCanvasPos = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / effScaleRef.current,
      y: (clientY - rect.top) / effScaleRef.current,
    };
  }, [effScaleRef]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!marqueeStartRef.current) return;
      isMarqueeActiveRef.current = true;
      const pos = toCanvasPos(e.clientX, e.clientY);
      setMarquee({ x1: marqueeStartRef.current.x, y1: marqueeStartRef.current.y, x2: pos.x, y2: pos.y });
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!marqueeStartRef.current) return;
      if (isMarqueeActiveRef.current) {
        const pos = toCanvasPos(e.clientX, e.clientY);
        const x1 = Math.min(marqueeStartRef.current.x, pos.x);
        const y1 = Math.min(marqueeStartRef.current.y, pos.y);
        const x2 = Math.max(marqueeStartRef.current.x, pos.x);
        const y2 = Math.max(marqueeStartRef.current.y, pos.y);
        if (x2 - x1 > 4 && y2 - y1 > 4) {
          const hit = layersRef.current
            .filter(l => rectsIntersect(x1, y1, x2 - x1, y2 - y1, l.x, l.y, l.width, l.height))
            .map(l => l.id);
          onMarqueeSelectRef.current?.(hit);
        }
      }
      marqueeStartRef.current = null;
      isMarqueeActiveRef.current = false;
      setMarquee(null);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [toCanvasPos, layersRef, onMarqueeSelectRef]);

  const updateLayer = (id: string, overrides: Partial<Layer>) => {
    onLayersChange?.(safeLayers.map(l => l.id === id ? { ...l, ...overrides } : l));
  };

  const updateLayers = (updates: Map<string, Partial<Layer>>) => {
    onLayersChange?.(safeLayers.map(l => {
      const ov = updates.get(l.id);
      return ov ? { ...l, ...ov } : l;
    }));
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (spaceHeldRef.current) return; // panning handled at the outer container
    if (e.target !== e.currentTarget) return;
    const pos = toCanvasPos(e.clientX, e.clientY);
    marqueeStartRef.current = pos;
    isMarqueeActiveRef.current = false;
    setMarquee(null);
    onLayerSelect?.(null, e);
  };

  // Keyboard shortcuts for rulers and guides
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isInteractiveTarget()) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        setShowRulers(v => !v);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ';') {
        e.preventDefault();
        setShowGuides(v => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const sortedLayers = [...safeLayers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

  const marqueeDisplay = marquee && effectiveScale > 0
    ? {
        left: pan.x + Math.min(marquee.x1, marquee.x2) * effectiveScale,
        top: pan.y + Math.min(marquee.y1, marquee.y2) * effectiveScale,
        width: Math.abs(marquee.x2 - marquee.x1) * effectiveScale,
        height: Math.abs(marquee.y2 - marquee.y1) * effectiveScale,
      }
    : null;

  const selLayers = safeLayers.filter(l => selectedLayerIds.includes(l.id));
  const selBBox = selLayers.length > 1
    ? {
        x: Math.min(...selLayers.map(l => l.x)),
        y: Math.min(...selLayers.map(l => l.y)),
        x2: Math.max(...selLayers.map(l => l.x + l.width)),
        y2: Math.max(...selLayers.map(l => l.y + l.height)),
      }
    : null;

  const zoomPercent = Math.round(userZoom * 100);

  return (
    <div
      ref={outerRef}
      onMouseDownCapture={handleOuterMouseDownCapture}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        cursor: isPanning ? 'grabbing' : spaceHeld ? 'grab' : 'default',
      }}
    >
      {/* Marquee selection overlay (outer/screen coords) */}
      {marqueeDisplay && (
        <div
          style={{
            position: 'absolute',
            pointerEvents: 'none',
            zIndex: 9999,
            left: marqueeDisplay.left,
            top: marqueeDisplay.top,
            width: marqueeDisplay.width,
            height: marqueeDisplay.height,
            border: '1px solid #6366f1',
            background: 'rgba(99,102,241,0.08)',
          }}
        />
      )}

      {/* Rulers */}
      {showRulers && fitScale > 0 && (
        <>
          <Ruler
            axis="horizontal"
            size={outerRef.current?.clientWidth ?? 0}
            canvasSize={canvasWidth}
            pan={pan.x}
            scale={effectiveScale}
            onAddGuide={(pos) => setInternalGuides(g => [...g, { id: `guide-h-${Date.now()}`, axis: 'horizontal', position: pos, type: 'guide' }])}
          />
          <Ruler
            axis="vertical"
            size={outerRef.current?.clientHeight ?? 0}
            canvasSize={canvasHeight}
            pan={pan.y}
            scale={effectiveScale}
            onAddGuide={(pos) => setInternalGuides(g => [...g, { id: `guide-v-${Date.now()}`, axis: 'vertical', position: pos, type: 'guide' }])}
          />
        </>
      )}

      {fitScale > 0 && (
        <div
          ref={canvasRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: canvasWidth,
            height: canvasHeight,
            backgroundColor,
            backgroundImage: backgroundImage ? `url(${backgroundImage})` : 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${effectiveScale})`,
            transformOrigin: 'top left',
          }}
          onMouseDown={handleCanvasMouseDown}
        >
          {/* Multi-select bounding box (canvas coords) */}
          {selBBox && (
            <div
              style={{
                position: 'absolute',
                left: selBBox.x - 2,
                top: selBBox.y - 2,
                width: selBBox.x2 - selBBox.x + 4,
                height: selBBox.y2 - selBBox.y + 4,
                border: '1px dashed #6366f1',
                background: 'rgba(99,102,241,0.03)',
                pointerEvents: 'none',
                zIndex: 9000,
              }}
            />
          )}

          {/* GuideLayer */}
          {showGuides && (
            <GuideLayer
              guides={internalGuides}
              canvasWidth={canvasWidth}
              canvasHeight={canvasHeight}
              scale={effectiveScale}
              onUpdateGuide={(id, pos) => setInternalGuides(gs => gs.map(g => g.id === id ? { ...g, position: pos } : g))}
              onRemoveGuide={(id) => setInternalGuides(gs => gs.filter(g => g.id !== id))}
            />
          )}

          {/* Snap lines */}
          {activeSnapLines.map(line => {
            const isH = line.axis === 'horizontal';
            return (
              <div
                key={line.id}
                style={{
                  position: 'absolute',
                  pointerEvents: 'none',
                  zIndex: 9999,
                  backgroundColor: line.type === 'guide' ? '#06b6d4' : '#ef4444',
                  ...(isH
                    ? { left: 0, right: 0, top: line.position, height: 1 }
                    : { top: 0, bottom: 0, left: line.position, width: 1 }),
                }}
              />
            );
          })}

          {sortedLayers.map((layer, index) => {
            if (layer.visible === false) return null;
            
            const isSelected = selectedLayerIds.includes(layer.id);
            const { outer, inner } = computeLayerStyle(layer);
            const isPreview = previewLayerId === layer.id && previewKey > 0;
            const animKf = isPreview && layer.animationIn ? ANIM_KEYFRAME[layer.animationIn] : null;
            const animStyle = animKf
              ? { animation: `${animKf} ${layer.animationDuration ?? 0.5}s cubic-bezier(0.16,1,0.3,1) ${layer.animationDelay ?? 0}s both` }
              : undefined;

            // Extract boxShadow separately so we can compose it with the selection ring
            const layerBoxShadow = outer.boxShadow as string | undefined;
            const selectionRing = isSelected ? '0 0 0 4px rgba(99,102,241,0.25)' : undefined;
            const composedBoxShadow = selectionRing
              ? layerBoxShadow ? `${selectionRing}, ${layerBoxShadow}` : selectionRing
              : layerBoxShadow;

            return (
              <Rnd
                key={`${layer.id ?? 'layer'}-${index}`}
                size={{ width: layer.width, height: layer.height }}
                position={{ x: layer.x, y: layer.y }}
                scale={effectiveScale}
                bounds="parent"
                lockAspectRatio={layer.lockAspectRatio ?? false}
                disableDragging={spaceHeld || layer.locked}
                enableResizing={!spaceHeld && !layer.locked}
                dragGrid={snapEnabled ? [8, 8] : undefined}
                onDragStart={() => {
                  dragStartPositionsRef.current = new Map(
                    layersRef.current
                      .filter(l => selectedLayerIdsRef.current.includes(l.id))
                      .map(l => [l.id, { x: l.x, y: l.y }])
                  );
                }}
                onDrag={(e, d) => {
                  if (snapEnabled && !e.altKey) {
                    const others = layersRef.current.filter(l => l.id !== layer.id);
                    const lines = calculateSnapLines(
                      { x: d.x, y: d.y, w: layer.width, h: layer.height },
                      others,
                      showGuides ? internalGuides : [],
                      effectiveScale
                    );
                    setActiveSnapLines(lines);
                  } else if (activeSnapLines.length > 0) {
                    setActiveSnapLines([]);
                  }
                }}
                onDragStop={(_, d) => {
                  setActiveSnapLines([]);
                  if (isSelected && selectedLayerIdsRef.current.length > 1) {
                    const startPos = dragStartPositionsRef.current.get(layer.id);
                    if (startPos) {
                      const dx = d.x - startPos.x;
                      const dy = d.y - startPos.y;
                      const updates = new Map<string, Partial<Layer>>();
                      for (const [id, start] of dragStartPositionsRef.current) {
                        updates.set(id, { x: start.x + dx, y: start.y + dy });
                      }
                      updateLayers(updates);
                    }
                    return;
                  }

                  updateLayer(layer.id, { x: d.x, y: d.y });
                }}
                onResizeStop={(_, __, ref, ___, position) =>
                  updateLayer(layer.id, {
                    width: parseInt(ref.style.width, 10),
                    height: parseInt(ref.style.height, 10),
                    ...position,
                  })
                }
                style={{
                  ...outer,
                  // Override size-related fields (controlled by Rnd)
                  width: undefined,
                  height: undefined,
                  zIndex: layer.zIndex ?? index,
                  outline: isSelected ? '2px solid #6366f1' : 'none',
                  boxShadow: composedBoxShadow ?? 'none',
                  cursor: spaceHeld ? 'inherit' : 'move',
                  pointerEvents: layer.locked ? 'none' : 'auto',
                }}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  onLayerSelect?.(layer, e);
                }}
              >
                {/* key forces remount to restart CSS animation on preview trigger */}
                <div
                  key={isPreview ? `anim-${previewKey}` : 'static'}
                  style={{ width: '100%', height: '100%', ...animStyle }}
                >
                  {layer.type === 'text' && (
                    <div style={inner}>
                      {layer.content ?? ''}
                    </div>
                  )}
                  {layer.type === 'image' && layer.url && (
                    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                      <Image
                        src={layer.url}
                        alt=""
                        fill
                        sizes="100vw"
                        style={{ objectFit: 'cover', pointerEvents: 'none' }}
                        unoptimized
                      />
                    </div>
                  )}
                  {layer.type === 'image' && !layer.url && (
                    <div style={{
                      width: '100%',
                      height: '100%',
                      border: '1px dashed #555',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#666',
                      fontSize: 12,
                    }}>
                      img
                    </div>
                  )}
                </div>
              </Rnd>
            );
          })}
        </div>
      )}

      {fitScale > 0 && (
        <ZoomControls
          percent={zoomPercent}
          onZoomIn={() => applyZoom(nextZoomStep(userZoomRef.current))}
          onZoomOut={() => applyZoom(prevZoomStep(userZoomRef.current))}
          onFit={zoomFit}
          canZoomIn={userZoom < MAX_ZOOM - EPS}
          canZoomOut={userZoom > MIN_ZOOM + EPS}
        />
      )}
    </div>
  );
}

export default forwardRef<CanvasEditorHandle, CanvasEditorProps>(CanvasEditor);
