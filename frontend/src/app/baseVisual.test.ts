import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Base "marfim editorial" (23/11/2026). O app parecia genérico perto do Claude porque a base era
// preto e branco frio, tudo em sans 600 e com linha em volta de cada bloco. A troca é só de tokens
// e de quatro componentes compartilhados; estes testes seguram a base para ninguém voltar ao frio.

const ler = (...p: string[]) => fs.readFileSync(path.join(__dirname, ...p), 'utf8');
const globals = ler('globals.css');
const layout = ler('layout.tsx');
const sidebar = ler('..', 'components', 'Sidebar', 'Sidebar.module.css');
const pageHeader = ler('..', 'components', 'ui', 'PageHeader.module.css');
const button = ler('..', 'components', 'ui', 'Button.module.css');

describe('base visual', () => {
  it('fundo marfim, texto grafite quente e acento escuro (nada de #fff/#0a0a0a como base)', () => {
    expect(globals).toContain('--color-bg: #faf9f5;');
    expect(globals).toContain('--color-text: #24221e;');
    expect(globals).toContain('--color-accent: #2d2a25;');
    expect(globals).not.toContain('--color-bg: #ffffff;');
  });

  it('serifa carregada pelo next/font e usada só pelo token --font-serif', () => {
    expect(layout).toMatch(/import \{[^}]*Newsreader[^}]*\} from 'next\/font\/google'/);
    expect(layout).toContain("variable: '--font-newsreader'");
    expect(layout).toContain('newsreader.variable');
    expect(globals).toMatch(/--font-serif: var\(--font-newsreader\)/);
  });

  it('títulos de página na serifa, peso 500', () => {
    expect(pageHeader).toMatch(/\.title \{[^}]*font-family: var\(--font-serif\);[^}]*font-weight: 500;/);
  });

  it('menu lateral separado por tom, sem linha e sem rótulo em caixa alta', () => {
    expect(sidebar).toMatch(/\.sidebar \{[^}]*background-color: var\(--color-sidebar\);/);
    expect(sidebar).not.toMatch(/\.sidebar \{[^}]*border-right/);
    expect(sidebar).not.toMatch(/\.navSectionLabel \{[^}]*text-transform: uppercase/);
  });

  it('botão principal não pisca preto puro ao clicar', () => {
    expect(button).not.toContain('#000000');
  });
});
