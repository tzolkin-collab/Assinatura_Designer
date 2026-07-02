import type { Layer } from '../Fabrica/DesignRenderer';

export type Axis = 'horizontal' | 'vertical';

export interface SnapLine {
  id: string;
  axis: Axis;
  position: number;
  type: 'layer' | 'grid' | 'guide';
}

export interface Guide extends SnapLine {
  type: 'guide';
}

const SNAP_THRESHOLD = 5; // pixels

/**
 * Calculates snap lines when a layer is dragged.
 * It compares the moving layer's bounds with other layers' bounds.
 */
export function calculateSnapLines(
  movingLayerBounds: { x: number; y: number; w: number; h: number },
  otherLayers: Layer[],
  guides: Guide[],
  scale: number
): SnapLine[] {
  const lines: SnapLine[] = [];
  const threshold = SNAP_THRESHOLD / scale; // Adjust threshold based on zoom

  const movingCenters = {
    x: movingLayerBounds.x + movingLayerBounds.w / 2,
    y: movingLayerBounds.y + movingLayerBounds.h / 2,
  };

  const movingEdges = {
    top: movingLayerBounds.y,
    bottom: movingLayerBounds.y + movingLayerBounds.h,
    left: movingLayerBounds.x,
    right: movingLayerBounds.x + movingLayerBounds.w,
  };

  // Helper to add snap line if within threshold
  const checkSnap = (movingPos: number, targetPos: number, axis: Axis, type: 'layer' | 'guide') => {
    if (Math.abs(movingPos - targetPos) < threshold) {
      lines.push({ id: `snap-${type}-${axis}-${targetPos}`, axis, position: targetPos, type });
    }
  };

  // Check against guides first (higher priority)
  for (const guide of guides) {
    if (guide.axis === 'horizontal') { // horizontal guide means it's a Y coordinate
      checkSnap(movingEdges.top, guide.position, 'horizontal', 'guide');
      checkSnap(movingEdges.bottom, guide.position, 'horizontal', 'guide');
      checkSnap(movingCenters.y, guide.position, 'horizontal', 'guide');
    } else { // vertical guide means X coordinate
      checkSnap(movingEdges.left, guide.position, 'vertical', 'guide');
      checkSnap(movingEdges.right, guide.position, 'vertical', 'guide');
      checkSnap(movingCenters.x, guide.position, 'vertical', 'guide');
    }
  }

  // Check against other layers
  for (const layer of otherLayers) {
    const targetCenters = {
      x: layer.x + layer.width / 2,
      y: layer.y + layer.height / 2,
    };
    const targetEdges = {
      top: layer.y,
      bottom: layer.y + layer.height,
      left: layer.x,
      right: layer.x + layer.width,
    };

    // Horizontal snap lines (Y axis)
    checkSnap(movingEdges.top, targetEdges.top, 'horizontal', 'layer');
    checkSnap(movingEdges.top, targetEdges.bottom, 'horizontal', 'layer');
    checkSnap(movingEdges.bottom, targetEdges.top, 'horizontal', 'layer');
    checkSnap(movingEdges.bottom, targetEdges.bottom, 'horizontal', 'layer');
    checkSnap(movingCenters.y, targetCenters.y, 'horizontal', 'layer');

    // Vertical snap lines (X axis)
    checkSnap(movingEdges.left, targetEdges.left, 'vertical', 'layer');
    checkSnap(movingEdges.left, targetEdges.right, 'vertical', 'layer');
    checkSnap(movingEdges.right, targetEdges.left, 'vertical', 'layer');
    checkSnap(movingEdges.right, targetEdges.right, 'vertical', 'layer');
    checkSnap(movingCenters.x, targetCenters.x, 'vertical', 'layer');
  }

  // Deduplicate lines by position & axis
  const uniqueLines = new Map<string, SnapLine>();
  for (const line of lines) {
    const key = `${line.axis}-${Math.round(line.position)}`;
    if (!uniqueLines.has(key) || line.type === 'guide') {
      uniqueLines.set(key, line); // Guide overwrites layer if same position
    }
  }

  return Array.from(uniqueLines.values());
}
