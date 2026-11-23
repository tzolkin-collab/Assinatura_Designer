import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Publicadas (23/11/2026). Era uma grade de cartões com selos ("Apresentação", "12 slides")
// em cima do slide, cobrindo o título, e um campo de link truncado ("apresentacao/liderar-se…").
// Virou uma linha por link no ar: capa, nome, endereço inteiro, meta e "Copiar link" à frente.

const view = fs.readFileSync(path.join(__dirname, 'PublishedPresentationsView.tsx'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'PublishedPresentations.module.css'), 'utf8');

describe('tela Publicadas', () => {
  it('mesmo topo das outras telas (PageHeader) e nome igual ao do menu; títulos na serifa da base', () => {
    expect(view).toContain('<PageHeader');
    expect(view).toContain('title="Publicadas"');
    // Base "marfim editorial": títulos de seção e de estado vazio usam a serifa, nunca uma fonte solta.
    expect(css).toMatch(/\.listTitle \{[^}]*font-family: var\(--font-serif\);/);
    expect(css).not.toMatch(/font-family: ['"]?(Georgia|Newsreader)/);
  });

  it('nada por cima da capa', () => {
    expect(view).not.toContain('coverBadge');
    expect(view).not.toContain('coverCount');
  });

  it('o endereço aparece inteiro, como link, e "Copiar link" é a primeira ação', () => {
    expect(view).toContain('const endereco = shortPublicUrl(origin, post.publicSlug);');
    expect(view).toMatch(/className=\{styles\.url\}[^>]*>\s*\{endereco\}/);
    expect(view).toMatch(/<div className=\{styles\.actions\}>\s*<button[\s\S]*?Copiar link/);
  });

  it('se a cópia falhar, aparece o endereço inteiro selecionado para copiar à mão', () => {
    expect(view).toMatch(/copyFailedId === post\.id && \([\s\S]*?value=\{publicUrl\(post\)\}/);
  });

  it('filtros numa linha: tipo e ordem são seletores, não chips de 40px', () => {
    expect(view).not.toContain('styles.chip');
    expect(view).toContain('aria-label="Filtrar por tipo"');
    expect(view).toContain('aria-label="Ordenar por"');
  });

  it('linhas se rearrumam pela largura da lista; no celular Abrir e Editar ficam só com ícone', () => {
    expect(css).toContain('container-type: inline-size;');
    expect(css).toMatch(/@container \(max-width: 520px\) \{[\s\S]*?\.actionLabel \{\s*display: none;/);
    expect(view).toContain('aria-label={`Abrir “${title}”`}');
    expect(view).toContain('aria-label={`Editar “${title}”`}');
  });
});
