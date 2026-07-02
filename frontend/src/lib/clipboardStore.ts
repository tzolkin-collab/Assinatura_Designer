import type { Layer } from '@/components/Fabrica/DesignRenderer';

let clipboard: Layer[] = [];

export function copyLayers(layers: Layer[]) {
  // Deep clone to ensure no references are kept
  clipboard = layers.map(l => structuredClone(l));
}

export function pasteLayers(offsetX = 20, offsetY = 20): Layer[] {
  return clipboard.map(l => ({
    ...structuredClone(l),
    id: crypto.randomUUID(), // Ensure new IDs
    x: l.x + offsetX,
    y: l.y + offsetY,
  }));
}

export function getClipboardCount(): number {
  return clipboard.length;
}
