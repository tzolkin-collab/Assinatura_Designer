import type { SlideTemplate } from './types.js';

// Dimensões base: 1080 × 1080
// Safe area: 60px padding

export const carouselTemplates: SlideTemplate[] = [
  // ── carousel-cover ──────────────────────────────────────────────────────────
  {
    id: 'carousel-cover',
    label: 'Capa do carrossel',
    category: 'carousel',
    dimensions: { width: 1080, height: 1080 },
    canvaTemplateId: 'CAROUSEL_COVER_CANVA_TEMPLATE_ID',
    semanticZones: [
      { id: 'title',    type: 'text', maxChars: 70,  role: 'title' },
      { id: 'subtitle', type: 'text', maxChars: 120, role: 'subtitle', optional: true },
      { id: 'brand',    type: 'text', maxChars: 40,  role: 'brand',    optional: true },
    ],
  },

  // ── carousel-content ────────────────────────────────────────────────────────
  {
    id: 'carousel-content',
    label: 'Conteúdo — título + imagem + legenda',
    category: 'carousel',
    dimensions: { width: 1080, height: 1080 },
    canvaTemplateId: 'CAROUSEL_CONTENT_CANVA_TEMPLATE_ID',
    semanticZones: [
      { id: 'title',   type: 'text', maxChars: 60,  role: 'title' },
      { id: 'image',   type: 'image', fit: 'cover', role: 'content-image' },
      { id: 'caption', type: 'text', maxChars: 120, role: 'caption', optional: true },
    ],
  },

  // ── carousel-text ───────────────────────────────────────────────────────────
  {
    id: 'carousel-text',
    label: 'Só texto — título + corpo',
    category: 'carousel',
    dimensions: { width: 1080, height: 1080 },
    canvaTemplateId: 'CAROUSEL_TEXT_CANVA_TEMPLATE_ID',
    semanticZones: [
      { id: 'title', type: 'text', maxChars: 60,  role: 'title' },
      { id: 'body',  type: 'text', maxChars: 450, role: 'body' },
    ],
  },

  // ── carousel-data ───────────────────────────────────────────────────────────
  {
    id: 'carousel-data',
    label: 'Dado / gráfico',
    category: 'carousel',
    dimensions: { width: 1080, height: 1080 },
    canvaTemplateId: 'CAROUSEL_DATA_CANVA_TEMPLATE_ID',
    semanticZones: [
      { id: 'title',   type: 'text', maxChars: 60,  role: 'title' },
      { id: 'caption', type: 'text', maxChars: 100, role: 'caption', optional: true },
      { id: 'chart',   type: 'chart', role: 'chart' },
    ],
  },

  // ── carousel-quote ──────────────────────────────────────────────────────────
  {
    id: 'carousel-quote',
    label: 'Citação',
    category: 'carousel',
    dimensions: { width: 1080, height: 1080 },
    canvaTemplateId: 'CAROUSEL_QUOTE_CANVA_TEMPLATE_ID',
    semanticZones: [
      { id: 'quote',  type: 'text', maxChars: 200, role: 'quote' },
      { id: 'author', type: 'text', maxChars: 80,  role: 'author', optional: true },
    ],
  },

  // ── carousel-closing ────────────────────────────────────────────────────────
  {
    id: 'carousel-closing',
    label: 'Encerramento + CTA',
    category: 'carousel',
    dimensions: { width: 1080, height: 1080 },
    canvaTemplateId: 'CAROUSEL_CLOSING_CANVA_TEMPLATE_ID',
    semanticZones: [
      { id: 'cta',      type: 'text', maxChars: 100, role: 'cta' },
      { id: 'contact',  type: 'text', maxChars: 120, role: 'contact', optional: true },
      { id: 'swipe',    type: 'text', maxChars: 30,  role: 'swipe-indicator', optional: true },
    ],
  },
];
