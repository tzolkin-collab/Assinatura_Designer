import { describe, it, expect } from 'vitest';
import { designPageToSvg } from '../lib/designToSvg.js';
import type { DesignPageNode, DesignTokens } from '../lib/designDocument.js';

// O DesignDocument é gerado por LLM: qualquer cor pode chegar como string
// arbitrária. Antes, `fill="${fill}"` interpolava a cor crua no atributo — um
// valor com aspas quebrava o atributo e injetava markup no SVG que vai ao
// Chromium/sharp. Estes testes cravam que todo sink de cor passa por esc().

const tokens: DesignTokens = {
  colors: {
    background: '#ffffff',
    surface: '#f0f0f0',
    text: '#111111',
    muted: '#888888',
    accent: '#ff0055',
    accent2: '#0055ff',
  },
  typography: { display: 'Inter', heading: 'Inter', body: 'Inter' },
  spacing: { page: 64, section: 32, gap: 16 },
  radius: { sm: 4, md: 8, lg: 16 },
};

// Payload que quebra o atributo e emenda um <script> se não houver escape.
const BREAKOUT = '#fff"/><script>alert(1)</script><rect fill="';

describe('designPageToSvg — escape de cor (anti-injeção)', () => {
  it('escapa fill de container (background de node)', () => {
    const page: DesignPageNode = {
      id: 'p1',
      type: 'page',
      background: '#000000',
      children: [
        {
          id: 'c1',
          type: 'container',
          layout: { width: 100, height: 100 },
          style: { background: BREAKOUT },
          children: [],
        },
      ],
    };
    const svg = designPageToSvg(page, tokens, 1080, 1080);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&quot;');
  });

  it('escapa fill de shape', () => {
    const page: DesignPageNode = {
      id: 'p1',
      type: 'page',
      background: '#000000',
      children: [{ id: 's1', type: 'shape', layout: { width: 50, height: 50 }, style: { background: BREAKOUT } }],
    };
    const svg = designPageToSvg(page, tokens, 1080, 1080);
    expect(svg).not.toContain('<script>');
  });

  it('escapa cor de texto', () => {
    const page: DesignPageNode = {
      id: 'p1',
      type: 'page',
      background: '#000000',
      children: [{ id: 't1', type: 'text', content: 'Olá', style: { color: BREAKOUT }, layout: { width: 400, height: 80 } }],
    };
    const svg = designPageToSvg(page, tokens, 1080, 1080);
    expect(svg).not.toContain('<script>');
  });

  it('escapa background da página', () => {
    const page: DesignPageNode = { id: 'p1', type: 'page', background: BREAKOUT, children: [] };
    const svg = designPageToSvg(page, tokens, 1080, 1080);
    expect(svg).not.toContain('<script>');
  });

  it('não quebra o caminho normal: cor válida sai intacta e gradiente vira url(#..)', () => {
    const page: DesignPageNode = {
      id: 'p1',
      type: 'page',
      background: 'linear-gradient(135deg, #ff0055, #0055ff)',
      children: [
        { id: 's1', type: 'shape', layout: { width: 50, height: 50 }, style: { background: '#ff0055' } },
      ],
    };
    const svg = designPageToSvg(page, tokens, 1080, 1080);
    expect(svg).toContain('fill="#ff0055"');
    expect(svg).toContain('url(#grad');
    expect(svg).toContain('<linearGradient');
  });
});
