export type { SlideTemplate, SlideZone, ZoneType, ImageFit } from './types.js';
export { presentationTemplates } from './presentation.js';
export { carouselTemplates } from './carousel.js';

import { presentationTemplates } from './presentation.js';
import { carouselTemplates } from './carousel.js';
import type { SlideTemplate } from './types.js';

export const allTemplates: SlideTemplate[] = [
  ...presentationTemplates,
  ...carouselTemplates,
];

const templateMap = new Map(allTemplates.map((t) => [t.id, t]));

export function getTemplate(id: string): SlideTemplate | undefined {
  return templateMap.get(id);
}

export function getTemplatesByCategory(category: SlideTemplate['category']): SlideTemplate[] {
  return allTemplates.filter((t) => t.category === category);
}
