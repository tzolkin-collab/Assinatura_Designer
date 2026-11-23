import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { artesDaPasta, caminhoDaPasta, collectSubtree, groupByParent, resumoDaPasta, type FolderNode } from './pastas';

// Galeria (23/11/2026). As pastas eram linhas de tabela com três ícones cada (e depois uma
// fileira de pílulas): só diziam o nome, e a tela parecia um filtro. Viraram quadros com as
// capas do que está dentro, e a pasta aberta ganhou caminho e ações à vista.

const pastas: FolderNode[] = [
  { id: 'marca', name: 'Brandbooks', parentId: null },
  { id: 'palco', name: 'Fotos de palco', parentId: null },
  { id: 'ed26', name: 'Edição 2026', parentId: 'marca' },
  { id: 'mar', name: 'Março', parentId: 'ed26' },
  { id: 'orfa', name: 'Órfã', parentId: 'apagada' },
];
const porPai = groupByParent(pastas);

describe('árvore de pastas', () => {
  it('pasta cujo pai sumiu sobe para a raiz em vez de desaparecer', () => {
    expect((porPai.get(null) ?? []).map((f) => f.id)).toEqual(['marca', 'palco', 'orfa']);
  });

  it('subárvore inclui a própria pasta e as netas', () => {
    expect([...collectSubtree('marca', porPai)].sort()).toEqual(['ed26', 'mar', 'marca']);
  });

  it('caminho vai da raiz até a pasta', () => {
    expect(caminhoDaPasta('mar', pastas).map((f) => f.id)).toEqual(['marca', 'ed26', 'mar']);
  });

  it('um ciclo vindo do banco não trava o caminho', () => {
    const ciclo: FolderNode[] = [
      { id: 'a', name: 'A', parentId: 'b' },
      { id: 'b', name: 'B', parentId: 'a' },
    ];
    expect(caminhoDaPasta('a', ciclo).map((f) => f.id)).toEqual(['b', 'a']);
  });
});

describe('capas da pasta', () => {
  const posts = [
    { id: 'velha', folderId: 'marca', createdAt: '2026-10-01' },
    { id: 'neta', folderId: 'mar', createdAt: '2026-11-20' },
    { id: 'solta', folderId: null, createdAt: '2026-11-21' },
    { id: 'outra', folderId: 'palco', createdAt: '2026-11-22' },
  ];

  it('pega as artes das subpastas também, mais recentes primeiro', () => {
    expect(artesDaPasta('marca', porPai, posts).map((p) => p.id)).toEqual(['neta', 'velha']);
  });

  it('pasta só com subpastas não parece vazia', () => {
    expect(artesDaPasta('ed26', porPai, posts).map((p) => p.id)).toEqual(['neta']);
  });

  it('resumo diz artes e subpastas, ou "Vazia"', () => {
    expect(resumoDaPasta(3, 1)).toBe('3 artes · 1 subpasta');
    expect(resumoDaPasta(1, 0)).toBe('1 arte');
    expect(resumoDaPasta(0, 2)).toBe('2 subpastas');
    expect(resumoDaPasta(0, 0)).toBe('Vazia');
  });
});

describe('tela da galeria', () => {
  const pagina = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8');
  const quadro = fs.readFileSync(path.join(__dirname, 'components', 'FolderTile.tsx'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, 'brand-galeria.module.css'), 'utf8');

  it('o selo "IA hoje" ficou só na Fábrica, onde o gasto acontece', () => {
    expect(pagina).not.toContain('AiSpendBadge');
  });

  it('pastas são quadros com as capas de dentro, não pílulas nem linhas de árvore', () => {
    expect(pagina).toContain('<FolderTile');
    expect(pagina).not.toContain('renderFolderTree');
    expect(pagina).not.toContain('styles.folderCard');
    expect(quadro).toContain('capas.slice(0, 4)');
    // 2×2 num quadro 16:9: cada célula é 16:9 e o slide não é cortado.
    expect(css).toMatch(/\.folderFrame \{[^}]*grid-template-columns: 1fr 1fr;[^}]*aspect-ratio: 16 \/ 9;/);
  });

  it('pasta aberta mostra o caminho e as ações à vista', () => {
    expect(pagina).toContain('aria-label="Caminho da pasta"');
    for (const acao of ['Renomear', 'Nova subpasta', 'Excluir']) expect(pagina).toContain(acao);
    expect(pagina).not.toContain('MoreHorizontal');
  });

  it('arrastar arte ou pasta continua funcionando: quadros e caminho são alvos', () => {
    expect(pagina).toContain('onDrop={(e) => handleDrop(e, folder.id)}');
    expect(pagina).toContain('onDrop={(e) => handleDrop(e, alvoDaRaiz)}');
    expect(pagina).toContain("const alvoDaRaiz = draggedFolderId ? 'root' : 'unassigned';");
  });

  it('excluir a pasta aberta volta para a mãe dela', () => {
    expect(pagina).toContain('setActiveFolder(folders.find(f => f.id === folderId)?.parentId ?? null);');
  });

  it('formato é um seletor na linha da busca; capa sem véu "Visualizar"; 3 por linha', () => {
    expect(pagina).toContain('aria-label="Filtrar por formato"');
    expect(pagina).not.toContain("'Visualizar'");
    expect(css).toContain('minmax(min(100%, 320px), 1fr)');
  });

  it('no celular as pastas rolam de lado e as artes vêm logo depois', () => {
    expect(css).toMatch(/\.folderGrid \{\s*grid-template-columns: none;\s*grid-auto-flow: column;/);
  });
});
