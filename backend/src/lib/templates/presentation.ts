import type { CanvaTemplate } from './types.js';

// Dimensões base: 1920 × 1080
// Safe area: 80px padding lateral, 60px topo/base
// Content area: 1760 × 960

export const presentationTemplates: CanvaTemplate[] = [
  // ── title-hero ─────────────────────────────────────────────────────────────
  {
    id: 'title-hero',
    label: 'Capa — título centralizado',
    category: 'presentation',
    dimensions: { width: 1920, height: 1080 },
    canvaTemplateId: 'TITLE_HERO_CANVA_TEMPLATE_ID', // Placeholder for actual Canva template ID
    semanticZones: [
      { id: 'eyebrow',  type: 'text',  maxChars: 40,  role: 'eyebrow',  optional: true, typographyTokens: 'body', behaviors: ['no-overlap'] },
      { id: 'title',    type: 'text',  maxChars: 80,  role: 'title', typographyTokens: 'display', behaviors: ['no-overlap'] },
      { id: 'subtitle', type: 'text',  maxChars: 150, role: 'subtitle', optional: true, typographyTokens: 'heading', behaviors: ['no-overlap'] },
    ],
  },

  // ── title-content ───────────────────────────────────────────────────────────
  {
    id: 'title-content',
    label: 'Título + corpo longo',
    category: 'presentation',
    dimensions: { width: 1920, height: 1080 },
    canvaTemplateId: 'TITLE_CONTENT_CANVA_TEMPLATE_ID', // Placeholder for actual Canva template ID
    semanticZones: [
      { id: 'title', type: 'text', maxChars: 70,  role: 'title', typographyTokens: 'heading', behaviors: ['no-overlap'] },
      { id: 'body',  type: 'text', maxChars: 700, role: 'body', typographyTokens: 'body', behaviors: ['no-overlap'] },
    ],
  },

  // ── split-left ──────────────────────────────────────────────────────────────
  {
    id: 'split-left',
    label: 'Texto esquerda, imagem direita',
    category: 'presentation',
    dimensions: { width: 1920, height: 1080 },
    canvaTemplateId: 'SPLIT_LEFT_CANVA_TEMPLATE_ID', // Placeholder for actual Canva template ID
    semanticZones: [
      { id: 'title', type: 'text',  maxChars: 60,  role: 'title', typographyTokens: 'heading', behaviors: ['no-overlap'] },
      { id: 'body',  type: 'text',  maxChars: 400, role: 'body', typographyTokens: 'body', behaviors: ['no-overlap'] },
      { id: 'image', type: 'image', fit: 'cover', role: 'hero-image' },
    ],
  },

  // ── split-right ─────────────────────────────────────────────────────────────
  {
    id: 'split-right',
    label: 'Imagem esquerda, texto direita',
    category: 'presentation',
    dimensions: { width: 1920, height: 1080 },
    canvaTemplateId: 'SPLIT_RIGHT_CANVA_TEMPLATE_ID', // Placeholder for actual Canva template ID
    semanticZones: [
      { id: 'image', type: 'image', fit: 'cover', role: 'hero-image' },
      { id: 'title', type: 'text',  maxChars: 60,  role: 'title', typographyTokens: 'heading', behaviors: ['no-overlap'] },
      { id: 'body',  type: 'text',  maxChars: 400, role: 'body', typographyTokens: 'body', behaviors: ['no-overlap'] },
    ],
  },

  // ── full-bleed ──────────────────────────────────────────────────────────────
  {
    id: 'full-bleed',
    label: 'Imagem full-screen + overlay',
    category: 'presentation',
    dimensions: { width: 1920, height: 1080 },
    canvaTemplateId: 'FULL_BLEED_CANVA_TEMPLATE_ID', // Placeholder for actual Canva template ID
    semanticZones: [
      { id: 'image',    type: 'image', fit: 'cover', role: 'background' },
      { id: 'overlay',  type: 'shape', role: 'overlay', optional: true, behaviors: ['semi-transparent-dark'] },
      { id: 'title',    type: 'text',  maxChars: 80,  role: 'title', typographyTokens: 'heading', contrastBackground: true, behaviors: ['no-overlap'] },
      { id: 'subtitle', type: 'text',  maxChars: 120, role: 'subtitle', optional: true, typographyTokens: 'body', contrastBackground: true, behaviors: ['no-overlap'] },
    ],
  },

  // ── data-chart ──────────────────────────────────────────────────────────────
  {
    id: 'data-chart',
    label: 'Título + gráfico',
    category: 'presentation',
    dimensions: { width: 1920, height: 1080 },
    canvaTemplateId: 'DATA_CHART_CANVA_TEMPLATE_ID', // Placeholder for actual Canva template ID
    semanticZones: [
      { id: 'title',   type: 'text',  maxChars: 70,  role: 'title', typographyTokens: 'heading', behaviors: ['no-overlap'] },
      { id: 'caption', type: 'text',  maxChars: 120, role: 'caption', optional: true, typographyTokens: 'body', behaviors: ['no-overlap'] },
      { id: 'chart',   type: 'chart', role: 'chart' },
    ],
  },

  // ── quote ───────────────────────────────────────────────────────────────────
  {
    id: 'quote',
    label: 'Citação grande + autor',
    category: 'presentation',
    dimensions: { width: 1920, height: 1080 },
    canvaTemplateId: 'QUOTE_CANVA_TEMPLATE_ID', // Placeholder for actual Canva template ID
    semanticZones: [
      { id: 'quote',  type: 'text', maxChars: 220, role: 'quote', typographyTokens: 'display', behaviors: ['no-overlap'] },
      { id: 'author', type: 'text', maxChars: 80,  role: 'author', optional: true, typographyTokens: 'body', behaviors: ['no-overlap'] },
    ],
  },

  // ── section-divider ─────────────────────────────────────────────────────────
  {
    id: 'section-divider',
    label: 'Divisor de seção',
    category: 'presentation',
    dimensions: { width: 1920, height: 1080 },
    canvaTemplateId: 'SECTION_DIVIDER_CANVA_TEMPLATE_ID', // Placeholder for actual Canva template ID
    semanticZones: [
      { id: 'section-number', type: 'text', maxChars: 6,  role: 'section-number', optional: true, typographyTokens: 'body', behaviors: ['no-overlap'] },
      { id: 'title',          type: 'text', maxChars: 60, role: 'title', typographyTokens: 'heading', behaviors: ['no-overlap'] },
    ],
  },

  // ── two-columns ─────────────────────────────────────────────────────────────
  {
    id: 'two-columns',
    label: 'Duas colunas de conteúdo',
    category: 'presentation',
    dimensions: { width: 1920, height: 1080 },
    canvaTemplateId: 'TWO_COLUMNS_CANVA_TEMPLATE_ID', // Placeholder for actual Canva template ID
    semanticZones: [
      { id: 'title',           type: 'text', maxChars: 70,  role: 'title', typographyTokens: 'heading', behaviors: ['no-overlap'] },
      { id: 'col-left-title',  type: 'text', maxChars: 40,  role: 'col-title', optional: true, typographyTokens: 'heading', behaviors: ['no-overlap'] },
      { id: 'col-left-body',   type: 'text', maxChars: 380, role: 'col-body', typographyTokens: 'body', behaviors: ['no-overlap'] },
      { id: 'col-right-title', type: 'text', maxChars: 40,  role: 'col-title', optional: true, typographyTokens: 'heading', behaviors: ['no-overlap'] },
      { id: 'col-right-body',  type: 'text', maxChars: 380, role: 'col-body', typographyTokens: 'body', behaviors: ['no-overlap'] },
    ],
  },

  // ── timeline ────────────────────────────────────────────────────────────────
  {
    id: 'timeline',
    label: 'Timeline horizontal (até 4 eventos)',
    category: 'presentation',
    dimensions: { width: 1920, height: 1080 },
    canvaTemplateId: 'TIMELINE_CANVA_TEMPLATE_ID', // Placeholder for actual Canva template ID
    semanticZones: [
      { id: 'title',         type: 'text', maxChars: 70, role: 'title', typographyTokens: 'heading', behaviors: ['no-overlap'] },
      // Evento 1
      { id: 'event-1-date',  type: 'text', maxChars: 20, role: 'event-date',  optional: true, typographyTokens: 'body', behaviors: ['no-overlap'] },
      { id: 'event-1-title', type: 'text', maxChars: 30, role: 'event-title', typographyTokens: 'heading', behaviors: ['no-overlap'] },
      { id: 'event-1-body',  type: 'text', maxChars: 100, role: 'event-body', optional: true, typographyTokens: 'body', behaviors: ['no-overlap'] },
      // Evento 2
      { id: 'event-2-date',  type: 'text', maxChars: 20, role: 'event-date',  optional: true, typographyTokens: 'body', behaviors: ['no-overlap'] },
      { id: 'event-2-title', type: 'text', maxChars: 30, role: 'event-title', typographyTokens: 'heading', behaviors: ['no-overlap'] },
      { id: 'event-2-body',  type: 'text', maxChars: 100, role: 'event-body', optional: true, typographyTokens: 'body', behaviors: ['no-overlap'] },
      // Evento 3
      { id: 'event-3-date',  type: 'text', maxChars: 20, role: 'event-date',  optional: true, typographyTokens: 'body', behaviors: ['no-overlap'] },
      { id: 'event-3-title', type: 'text', maxChars: 30, role: 'event-title', typographyTokens: 'heading', behaviors: ['no-overlap'] },
      { id: 'event-3-body',  type: 'text', maxChars: 100, role: 'event-body', optional: true, typographyTokens: 'body', behaviors: ['no-overlap'] },
      // Evento 4
      { id: 'event-4-date',  type: 'text', maxChars: 20, role: 'event-date',  optional: true, typographyTokens: 'body', behaviors: ['no-overlap'] },
      { id: 'event-4-title', type: 'text', maxChars: 30, role: 'event-title', typographyTokens: 'heading', behaviors: ['no-overlap'] },
      { id: 'event-4-body',  type: 'text', maxChars: 100, role: 'event-body', optional: true, typographyTokens: 'body', behaviors: ['no-overlap'] },
    ],
  },

  // ── closing ─────────────────────────────────────────────────────────────────
  {
    id: 'closing',
    label: 'Encerramento — CTA + contato',
    category: 'presentation',
    dimensions: { width: 1920, height: 1080 },
    canvaTemplateId: 'CLOSING_CANVA_TEMPLATE_ID', // Placeholder for actual Canva template ID
    semanticZones: [
      { id: 'cta',     type: 'text', maxChars: 120, role: 'cta', typographyTokens: 'heading', behaviors: ['no-overlap'] },
      { id: 'contact', type: 'text', maxChars: 160, role: 'contact', optional: true, typographyTokens: 'body', behaviors: ['no-overlap'] },
    ],
  },
  // ── carousel-cover ──────────────────────────────────────────────────────────
  {
    id: 'carousel-cover',
    label: 'Capa do carrossel (título + marca)',
    category: 'carousel',
    dimensions: { width: 1080, height: 1080 },
    canvaTemplateId: 'CAROUSEL_COVER_CANVA_TEMPLATE_ID', // Placeholder for actual Canva template ID
    semanticZones: [
      { id: 'title', type: 'text', maxChars: 60, role: 'title', typographyTokens: 'display', behaviors: ['no-overlap'] },
      { id: 'brand', type: 'text', maxChars: 30, role: 'brand', optional: true, typographyTokens: 'body', behaviors: ['no-overlap'] },
    ],
  },
  // ── carousel-data ───────────────────────────────────────────────────────────
  {
    id: 'carousel-data',
    label: 'Título + gráfico',
    category: 'carousel',
    dimensions: { width: 1080, height: 1080 },
    canvaTemplateId: 'CAROUSEL_DATA_CANVA_TEMPLATE_ID', // Placeholder for actual Canva template ID
    semanticZones: [
      { id: 'title', type: 'text',  maxChars: 50,  role: 'title', typographyTokens: 'heading', behaviors: ['no-overlap'] },
      { id: 'chart', type: 'chart', role: 'chart' },
    ],
  },
  // ── carousel-content ────────────────────────────────────────────────────────
  {
    id: 'carousel-content',
    label: 'Título + corpo curto + imagem',
    category: 'carousel',
    dimensions: { width: 1080, height: 1080 },
    canvaTemplateId: 'CAROUSEL_CONTENT_CANVA_TEMPLATE_ID', // Placeholder for actual Canva template ID
    semanticZones: [
      { id: 'title', type: 'text',  maxChars: 50,  role: 'title', typographyTokens: 'heading', behaviors: ['no-overlap'] },
      { id: 'body',  type: 'text',  maxChars: 200, role: 'body', typographyTokens: 'body', behaviors: ['no-overlap'] },
      { id: 'image', type: 'image', fit: 'cover', role: 'hero-image', optional: true }
    ]
  },
  // ── carousel-quote ──────────────────────────────────────────────────────────
  {
    id: 'carousel-quote',
    label: 'Citação + autor',
    category: 'carousel',
    dimensions: { width: 1080, height: 1080 },
    canvaTemplateId: 'CAROUSEL_QUOTE_CANVA_TEMPLATE_ID', // Placeholder for actual Canva template ID
    semanticZones: [
      { id: 'quote',  type: 'text', maxChars: 180, role: 'quote', typographyTokens: 'heading', behaviors: ['no-overlap'] },
      { id: 'author', type: 'text', maxChars: 60,  role: 'author', optional: true, typographyTokens: 'body', behaviors: ['no-overlap'] },
    ],
  },
  // ── carousel-closing ────────────────────────────────────────────────────────
  {
    id: 'carousel-closing',
    label: 'CTA + swipe indicator',
    category: 'carousel',
    dimensions: { width: 1080, height: 1080 },
    canvaTemplateId: 'CAROUSEL_CLOSING_CANVA_TEMPLATE_ID', // Placeholder for actual Canva template ID
    semanticZones: [
      { id: 'cta',           type: 'text', maxChars: 100, role: 'cta', typographyTokens: 'heading', behaviors: ['no-overlap'] },
      { id: 'swipe-indicator', type: 'text', maxChars: 30,  role: 'swipe-indicator', optional: true, typographyTokens: 'body', behaviors: ['no-overlap'] },
    ],
  }
];
