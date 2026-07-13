import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { type DesignIR, type IRPatch, type IRPatchOp } from '../../lib/designIR/types';

export interface IRCanvasEditorHandle {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export interface IRCanvasEditorProps {
  ir: DesignIR;
  activeSlideIndex: number;
  selectedElementIds: string[];
  onSelect: (id: string | null, multi: boolean) => void;
  onPatch: (patch: IRPatch) => void;
}

const IRCanvasEditor = forwardRef<IRCanvasEditorHandle, IRCanvasEditorProps>(({
  ir,
  activeSlideIndex,
  selectedElementIds,
  onSelect,
  onPatch,
}, ref) => {
  const slide = ir.slides[activeSlideIndex];

  useImperativeHandle(ref, () => ({
    undo: () => {},
    redo: () => {},
    canUndo: false,
    canRedo: false,
  }));

  // Escala responsiva (contain): mede o container e ajusta pra caber, em vez do
  // scale(0.5) fixo anterior — que estourava/encolhia o canvas e descalibrava a
  // seleção fora de telas ~metade do design.
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0 || !ir.width || !ir.height) return;
      setScale(Math.min(width / ir.width, height / ir.height));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [ir.width, ir.height]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="application"
      aria-label="Canvas de Edição"
      style={{
        width: '100%',
        height: '100%',
        background: slide?.background?.color || '#ffffff',
        position: 'relative',
        overflow: 'hidden',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelect(null, false);
      }}
      onKeyDown={(e) => {
        if (selectedElementIds.length === 0 || !slide) return;

        const moveAmount = e.shiftKey ? 10 : 1;
        let dx = 0;
        let dy = 0;

        switch (e.key) {
          case 'ArrowLeft': dx = -moveAmount; break;
          case 'ArrowRight': dx = moveAmount; break;
          case 'ArrowUp': dy = -moveAmount; break;
          case 'ArrowDown': dy = moveAmount; break;
          case 'Delete':
          case 'Backspace':
            onPatch({
              ops: selectedElementIds.map(id => ({
                op: 'remove-element',
                slideId: slide.id,
                elementId: id,
              }))
            });
            onSelect(null, false);
            return;
          default:
            return;
        }

        if (dx !== 0 || dy !== 0) {
          e.preventDefault();
          const ops: IRPatchOp[] = selectedElementIds.map(id => {
            const el = slide.elements.find(e => e.id === id);
            return el ? {
              op: 'update-bounds',
              slideId: slide.id,
              elementId: id,
              bounds: { x: el.bounds.x + dx, y: el.bounds.y + dy }
            } : null;
          }).filter(Boolean) as IRPatchOp[];

          if (ops.length > 0) {
            onPatch({ ops });
          }
        }
      }}
    >
      {!slide ? (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>Slide não encontrado.</div>
      ) : scale > 0 && (
        <div
          style={{
            width: ir.width,
            height: ir.height,
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: `translate(-50%, -50%) scale(${scale})`,
            transformOrigin: 'center',
            background: 'transparent',
          }}
        >
          {slide.elements.map(el => {
            const isSelected = selectedElementIds.includes(el.id);
            return (
              <div
                key={el.id}
                role="button"
                aria-label={`Elemento ${el.type}: ${el.name || el.content || 'sem nome'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(el.id, e.shiftKey);
                }}
                style={{
                  position: 'absolute',
                  left: el.bounds.x,
                  top: el.bounds.y,
                  width: el.bounds.width,
                  height: el.bounds.height,
                  zIndex: el.zIndex,
                  outline: isSelected ? '2px solid #4f46e5' : 'none',
                  cursor: 'pointer',
                  fontFamily: el.style.fontFamily,
                  fontSize: el.style.fontSize,
                  fontWeight: el.style.fontWeight,
                  color: el.style.color,
                  textAlign: el.style.textAlign,
                  display: el.style.display || 'flex',
                  alignItems: el.style.alignItems || (el.type === 'text' ? 'flex-start' : 'center'),
                  justifyContent: el.style.justifyContent || (el.type === 'text' ? 'flex-start' : 'center'),
                  background: el.style.background || el.style.backgroundColor || 'transparent',
                  borderRadius: el.style.borderRadius,
                }}
              >
                {el.type === 'text' && <div>{el.content}</div>}
                {el.type === 'image' && <img src={el.src} style={{ width: '100%', height: '100%', objectFit: el.style.objectFit || 'cover' }} alt="" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

IRCanvasEditor.displayName = 'IRCanvasEditor';

export default IRCanvasEditor;
