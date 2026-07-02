'use client';

import type { CSSProperties } from 'react';
import type { Layer } from '@/components/Fabrica/DesignRenderer';
import { computeLayerStyle, layerPositionStyle } from '@/lib/layerStyle';

interface LayerViewProps {
  layer: Layer;
  index: number;
  /** Extra styles merged into the outermost positioning div (e.g. animation). */
  wrapperStyle?: CSSProperties;
}

/**
 * Static, read-only renderer for a single Layer.
 * Handles all visual properties: gradient, shadow, rotation, border,
 * letterSpacing, italic, textDecoration.
 *
 * Structure:
 *   <div positioning + wrapperStyle>        ← position, size, zIndex, animation
 *     <div outer styles>                    ← opacity, bg, border, shadow, rotation
 *       {shape: nothing | image: img | text: inner div}
 *     </div>
 *   </div>
 */
export default function LayerView({ layer, index, wrapperStyle }: LayerViewProps) {
  const { outer, inner } = computeLayerStyle(layer);
  const posStyle = layerPositionStyle(layer, index);

  if (layer.type === 'shape') {
    return (
      <div style={{ ...posStyle, ...wrapperStyle }}>
        <div style={outer} />
      </div>
    );
  }

  if (layer.type === 'image' && layer.url) {
    return (
      <div style={{ ...posStyle, ...wrapperStyle }}>
        <div style={outer}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={layer.url}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
          />
        </div>
      </div>
    );
  }

  if (layer.type === 'text') {
    return (
      <div style={{ ...posStyle, ...wrapperStyle }}>
        <div style={outer}>
          <div style={inner}>{layer.content ?? ''}</div>
        </div>
      </div>
    );
  }

  return null;
}
