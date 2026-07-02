'use client';

import type { Layer } from '@/components/Fabrica/DesignRenderer';
import TransformPanel from './panels/TransformPanel';
import TextPanel from './panels/TextPanel';
import ShapePanel from './panels/ShapePanel';
import ImagePanel from './panels/ImagePanel';
import StrokePanel from './panels/StrokePanel';
import ShadowPanel from './panels/ShadowPanel';
import AnimationPanel from './panels/AnimationPanel';

interface Props {
  layer: Layer;
  canvasWidth: number;
  canvasHeight: number;
  onChange: (overrides: Partial<Layer>) => void;
  onPreviewAnimation?: () => void;
}

import AlignPanel from './panels/AlignPanel';

export default function LayerPropertiesPanel({ layer, canvasWidth, canvasHeight, onChange, onPreviewAnimation }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24 }}>
      {/* Layer badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 8px',
          background: 'var(--color-bg-secondary)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-text-tertiary)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {layer.id}
        </span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            padding: '2px 5px',
            borderRadius: 3,
            background:
              layer.type === 'text'
                ? '#e0f2fe'
                : layer.type === 'image'
                ? '#fef3c7'
                : '#ede9fe',
            color:
              layer.type === 'text'
                ? '#0369a1'
                : layer.type === 'image'
                ? '#92400e'
                : '#5b21b6',
          }}
        >
          {layer.type}
        </span>
      </div>

      <TransformPanel layer={layer} onChange={onChange} />
      
      <AlignPanel
        layers={[layer]}
        canvasWidth={canvasWidth}
        canvasHeight={canvasHeight}
        onChange={(updates) => {
          const layerUpdates = updates.get(layer.id);
          if (layerUpdates) onChange(layerUpdates);
        }}
      />

      {layer.type === 'text' && <TextPanel layer={layer} onChange={onChange} />}
      {layer.type === 'shape' && <ShapePanel layer={layer} onChange={onChange} />}
      {layer.type === 'image' && <ImagePanel layer={layer} onChange={onChange} />}

      {(layer.type === 'shape' || layer.type === 'image') && (
        <StrokePanel layer={layer} onChange={onChange} />
      )}

      <ShadowPanel layer={layer} onChange={onChange} />
      <AnimationPanel layer={layer} onChange={onChange} onPreview={onPreviewAnimation} />
    </div>
  );
}
