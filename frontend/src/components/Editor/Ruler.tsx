'use client';

import React, { useEffect, useRef } from 'react';

interface RulerProps {
  axis: 'horizontal' | 'vertical';
  size: number;
  canvasSize: number;
  pan: number;
  scale: number;
  onAddGuide?: (position: number) => void;
}

const RULER_THICKNESS = 20;

export default function Ruler({ axis, size, canvasSize, pan, scale, onAddGuide }: RulerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI displays
    const dpr = window.devicePixelRatio || 1;
    const isH = axis === 'horizontal';
    
    const width = isH ? size : RULER_THICKNESS;
    const height = isH ? RULER_THICKNESS : size;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#555';
    ctx.fillStyle = '#888';
    ctx.font = '9px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = isH ? 'center' : 'right';

    // Draw ticks
    // We want ticks every 10 canvas-pixels if zoomed in, or larger if zoomed out
    const step = scale > 0.5 ? 10 : (scale > 0.2 ? 50 : 100);
    
    // Calculate visible range in canvas coordinates
    const startCanvasPos = -pan / scale;
    const endCanvasPos = (size - pan) / scale;

    const firstTick = Math.floor(startCanvasPos / step) * step;

    for (let pos = firstTick; pos <= endCanvasPos; pos += step) {
      const viewportPos = pan + pos * scale;
      if (viewportPos < 0 || viewportPos > size) continue;

      const isMajor = pos % (step * 5) === 0;
      const isOrigin = pos === 0 || pos === canvasSize;

      ctx.beginPath();
      if (isH) {
        const y = isMajor ? 0 : RULER_THICKNESS - 5;
        ctx.moveTo(viewportPos, y);
        ctx.lineTo(viewportPos, RULER_THICKNESS);
        if (isMajor) {
          ctx.fillText(pos.toString(), viewportPos + 2, RULER_THICKNESS / 2);
        }
      } else {
        const x = isMajor ? 0 : RULER_THICKNESS - 5;
        ctx.moveTo(x, viewportPos);
        ctx.lineTo(RULER_THICKNESS, viewportPos);
        if (isMajor) {
          // Rotate text for vertical ruler
          ctx.save();
          ctx.translate(RULER_THICKNESS / 2 - 2, viewportPos + 2);
          ctx.rotate(-Math.PI / 2);
          ctx.fillText(pos.toString(), 0, 0);
          ctx.restore();
        }
      }
      
      if (isOrigin) {
        ctx.strokeStyle = '#06b6d4'; // Cyan for canvas bounds
        ctx.stroke();
        ctx.strokeStyle = '#555';
      } else {
        ctx.stroke();
      }
    }
  }, [axis, size, canvasSize, pan, scale]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!onAddGuide) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const isH = axis === 'horizontal';
    
    // We want the position in canvas coordinates
    const clientPos = isH ? e.clientX - rect.left : e.clientY - rect.top;
    const canvasPos = (clientPos - pan) / scale;
    
    onAddGuide(Math.round(canvasPos));
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={handlePointerDown}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        cursor: axis === 'horizontal' ? 'ns-resize' : 'ew-resize',
        zIndex: 9998,
        borderBottom: axis === 'horizontal' ? '1px solid #333' : 'none',
        borderRight: axis === 'vertical' ? '1px solid #333' : 'none',
      }}
    />
  );
}
