'use client';

import React from 'react';
import { Minus, Plus, Maximize2 } from 'lucide-react';

interface ZoomControlsProps {
  /** Current user zoom as a whole percentage relative to fit (100 = fit). */
  percent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** Reset to fit-to-screen (100%). */
  onFit: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
}

const btnBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: '#e5e7eb',
  cursor: 'pointer',
  transition: 'background 0.12s ease',
};

export default function ZoomControls({
  percent,
  onZoomIn,
  onZoomOut,
  onFit,
  canZoomIn,
  canZoomOut,
}: ZoomControlsProps) {
  return (
    <div
      style={{
        position: 'absolute',
        right: 12,
        bottom: 12,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: 3,
        borderRadius: 10,
        background: 'rgba(17,24,39,0.85)',
        backdropFilter: 'blur(6px)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
        userSelect: 'none',
      }}
      // Don't let clicks on the controls deselect the canvas / start marquee.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        style={{ ...btnBase, opacity: canZoomOut ? 1 : 0.4, cursor: canZoomOut ? 'pointer' : 'default' }}
        onClick={onZoomOut}
        disabled={!canZoomOut}
        title="Diminuir zoom (Ctrl −)"
        aria-label="Diminuir zoom"
      >
        <Minus size={15} />
      </button>

      <button
        onClick={onFit}
        title="Ajustar à tela (Ctrl 0)"
        aria-label="Ajustar à tela"
        style={{
          ...btnBase,
          width: 'auto',
          minWidth: 48,
          padding: '0 8px',
          fontSize: 12,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {percent}%
      </button>

      <button
        style={{ ...btnBase, opacity: canZoomIn ? 1 : 0.4, cursor: canZoomIn ? 'pointer' : 'default' }}
        onClick={onZoomIn}
        disabled={!canZoomIn}
        title="Aumentar zoom (Ctrl +)"
        aria-label="Aumentar zoom"
      >
        <Plus size={15} />
      </button>

      <button style={btnBase} onClick={onFit} title="Ajustar à tela (Ctrl 0)" aria-label="Ajustar à tela">
        <Maximize2 size={13} />
      </button>
    </div>
  );
}
