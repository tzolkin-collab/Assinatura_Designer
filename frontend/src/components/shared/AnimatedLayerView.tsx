'use client';

import type { CSSProperties } from 'react';
import type { Layer } from '@/components/Fabrica/DesignRenderer';
import LayerView from './LayerView';

// Keyframe names must match globals.css @keyframes declarations.
const ANIMATION_KEYFRAME: Partial<Record<NonNullable<Layer['animationIn']>, string>> = {
  'fade':        'lyrFade',
  'slide-up':    'lyrSlideUp',
  'slide-down':  'lyrSlideDown',
  'slide-left':  'lyrSlideLeft',
  'slide-right': 'lyrSlideRight',
  'zoom-in':     'lyrZoomIn',
  'zoom-out':    'lyrZoomOut',
  'blur-in':     'lyrBlurIn',
};

const EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';

interface AnimatedLayerViewProps {
  layer: Layer;
  index: number;
  /** Set true in editor to suppress entrance animations. */
  disableAnimation?: boolean;
}

/**
 * AnimatedLayerView wraps LayerView with a CSS entrance animation driven by
 * layer.animationIn / animationDelay / animationDuration.
 *
 * The animation plays on the outermost positioning div so it never conflicts
 * with rotation (which lives one level deeper in the outer/content div).
 *
 * Opacity composition during animation:
 *   wrapper opacity: 0 → 1  (from animation keyframe)
 *   inner content opacity: layer.opacity (static)
 *   → visible opacity = 0 → layer.opacity   ✓
 */
export default function AnimatedLayerView({
  layer,
  index,
  disableAnimation,
}: AnimatedLayerViewProps) {
  const preset =
    !disableAnimation && layer.animationIn && layer.animationIn !== 'none'
      ? layer.animationIn
      : null;

  const keyframe = preset ? ANIMATION_KEYFRAME[preset] : null;

  if (!keyframe) {
    return <LayerView layer={layer} index={index} />;
  }

  const duration = layer.animationDuration ?? 0.5;
  const delay = layer.animationDelay ?? 0;

  const wrapperStyle: CSSProperties = {
    animation: `${keyframe} ${duration}s ${EASING} ${delay}s both`,
  };

  return <LayerView layer={layer} index={index} wrapperStyle={wrapperStyle} />;
}
