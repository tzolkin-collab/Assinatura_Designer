'use client';

import { useState } from 'react';
import {
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
} from 'lucide-react';
import type { Layer } from '@/components/Fabrica/DesignRenderer';
import { Section } from './shared';

interface Props {
  layers: Layer[];
  canvasWidth: number;
  canvasHeight: number;
  onChange: (updates: Map<string, Partial<Layer>>) => void;
}

// Bounding box helper
function getBBox(layers: Layer[]) {
  const minX = Math.min(...layers.map((l) => l.x));
  const minY = Math.min(...layers.map((l) => l.y));
  const maxX = Math.max(...layers.map((l) => l.x + l.width));
  const maxY = Math.max(...layers.map((l) => l.y + l.height));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, minX, minY, maxX, maxY };
}

const toolBtn = (active?: boolean): React.CSSProperties => ({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '6px 0',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  background: active ? 'var(--color-accent)' : 'var(--color-bg)',
  color: active ? '#fff' : 'var(--color-text-secondary)',
  cursor: 'pointer',
  transition: 'all 120ms',
});

export default function AlignPanel({ layers, canvasWidth, canvasHeight, onChange }: Props) {
  // If only 1 layer is selected, force 'canvas' mode. Otherwise default to 'selection'.
  const [mode, setMode] = useState<'selection' | 'canvas'>(layers.length === 1 ? 'canvas' : 'selection');

  // If layers.length changes (e.g. from 2 to 1), ensure mode resets to canvas if needed.
  if (layers.length === 1 && mode === 'selection') {
    setMode('canvas');
  }

  const handleAlign = (type: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom') => {
    const updates = new Map<string, Partial<Layer>>();
    const isCanvas = mode === 'canvas';
    const ref = isCanvas
      ? { minX: 0, maxX: canvasWidth, minY: 0, maxY: canvasHeight, centerX: canvasWidth / 2, centerY: canvasHeight / 2 }
      : (() => {
          const bbox = getBBox(layers);
          return { minX: bbox.minX, maxX: bbox.maxX, minY: bbox.minY, maxY: bbox.maxY, centerX: bbox.minX + bbox.w / 2, centerY: bbox.minY + bbox.h / 2 };
        })();

    for (const l of layers) {
      if (type === 'left') updates.set(l.id, { x: ref.minX });
      else if (type === 'centerH') updates.set(l.id, { x: ref.centerX - l.width / 2 });
      else if (type === 'right') updates.set(l.id, { x: ref.maxX - l.width });
      else if (type === 'top') updates.set(l.id, { y: ref.minY });
      else if (type === 'centerV') updates.set(l.id, { y: ref.centerY - l.height / 2 });
      else if (type === 'bottom') updates.set(l.id, { y: ref.maxY - l.height });
    }

    onChange(updates);
  };

  return (
    <Section title="Alinhar">
      {layers.length > 1 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 8, background: 'var(--color-bg-secondary)', padding: 2, borderRadius: 6 }}>
          <button
            onClick={() => setMode('selection')}
            style={{ flex: 1, padding: '4px 0', fontSize: 10, borderRadius: 4, border: 'none', background: mode === 'selection' ? 'var(--color-bg-primary)' : 'transparent', color: mode === 'selection' ? 'var(--color-text)' : 'var(--color-text-tertiary)', cursor: 'pointer', boxShadow: mode === 'selection' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none' }}
          >
            Seleção
          </button>
          <button
            onClick={() => setMode('canvas')}
            style={{ flex: 1, padding: '4px 0', fontSize: 10, borderRadius: 4, border: 'none', background: mode === 'canvas' ? 'var(--color-bg-primary)' : 'transparent', color: mode === 'canvas' ? 'var(--color-text)' : 'var(--color-text-tertiary)', cursor: 'pointer', boxShadow: mode === 'canvas' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none' }}
          >
            Canvas
          </button>
        </div>
      )}

      {/* Horizontal */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        <button style={toolBtn()} onClick={() => handleAlign('left')} title="Alinhar à esquerda">
          <AlignStartVertical size={13} />
        </button>
        <button style={toolBtn()} onClick={() => handleAlign('centerH')} title="Centralizar horizontalmente">
          <AlignCenterVertical size={13} />
        </button>
        <button style={toolBtn()} onClick={() => handleAlign('right')} title="Alinhar à direita">
          <AlignEndVertical size={13} />
        </button>
      </div>
      {/* Vertical */}
      <div style={{ display: 'flex', gap: 4 }}>
        <button style={toolBtn()} onClick={() => handleAlign('top')} title="Alinhar ao topo">
          <AlignStartHorizontal size={13} />
        </button>
        <button style={toolBtn()} onClick={() => handleAlign('centerV')} title="Centralizar verticalmente">
          <AlignCenterHorizontal size={13} />
        </button>
        <button style={toolBtn()} onClick={() => handleAlign('bottom')} title="Alinhar à base">
          <AlignEndHorizontal size={13} />
        </button>
      </div>
    </Section>
  );
}
