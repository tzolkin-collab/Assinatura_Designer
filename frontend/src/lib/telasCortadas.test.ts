import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Corte de telas duplicadas (22/11/2026). Seguram o que não pode quebrar: o endereço antigo de
// "Projetos da equipe" leva à galeria em Descobrir, e o menu não mostra mais telas que só repetiam
// outra (Projetos da equipe) ou que não eram tela (Editor, que só reabria a última apresentação).

const redirect = vi.fn();
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));

import { BRAND_SETTINGS, GLOBAL_NAV, brandNav } from './navigation';
import { desembrulhar } from './desembrulhar';

const SRC = path.resolve(__dirname, '..');

describe('telas cortadas do menu', () => {
  it('/projetos redireciona para a galeria já em Descobrir', async () => {
    const { default: ProjetosPage } = await import('../app/projetos/page');
    ProjetosPage();
    expect(redirect).toHaveBeenCalledWith('/galeria?modo=descobrir');
  });

  it('a galeria abre em Descobrir quando recebe ?modo=descobrir', () => {
    const galeria = fs.readFileSync(path.join(SRC, 'app', 'galeria', 'page.tsx'), 'utf8');
    expect(galeria).toMatch(/get\('modo'\) === 'descobrir' \? 'discover'/);
  });

  it('o menu geral não tem mais "Projetos da equipe"', () => {
    expect(GLOBAL_NAV.map((i) => i.href)).not.toContain('/projetos');
  });

  it('o menu da marca não tem mais "Editor", mas o endereço continua existindo', () => {
    expect(brandNav('m').map((i) => i.href)).not.toContain('/m/editor');
    expect(fs.existsSync(path.join(SRC, 'app', '[marca]', 'editor', 'page.tsx'))).toBe(true);
  });
});

describe('cortes nas configurações da marca', () => {
  it('"Equipe" saiu da lista e o endereço antigo leva às configurações', async () => {
    expect(BRAND_SETTINGS.map((s) => s.key)).not.toContain('equipe');
    const { default: EquipePage } = await import('../app/[marca]/configuracoes/equipe/page');
    await EquipePage({ params: Promise.resolve({ marca: 'minha-marca' }) });
    expect(redirect).toHaveBeenCalledWith('/minha-marca/configuracoes');
  });

  it('a tela do agente não oferece mais "Preferências e Regras" (não chegavam à geração)', () => {
    const agente = fs.readFileSync(path.join(SRC, 'app', '[marca]', 'configuracoes', 'agent', 'page.tsx'), 'utf8');
    expect(agente).not.toContain('Preferências e Regras');
    expect(agente).not.toMatch(/\/memory/);
    expect(BRAND_SETTINGS.find((s) => s.key === 'agent')!.label).toBe('Instruções do agente');
  });
});

describe('Biblioteca de mídia: pastas e filtro', () => {
  it('desembrulhar aceita a resposta já desembrulhada e a com { data }', () => {
    const pasta = { id: 'p1', name: 'Brandbooks', parentId: null };
    expect(desembrulhar([pasta])).toEqual([pasta]);
    expect(desembrulhar({ data: [pasta] })).toEqual([pasta]);
    expect(desembrulhar(pasta)).toEqual(pasta);
    expect(desembrulhar(null)).toBeUndefined();
  });

  it('as chamadas de pasta não leem mais `.data` da resposta já desembrulhada', () => {
    const midia = fs.readFileSync(path.join(SRC, 'app', '[marca]', 'configuracoes', 'midia', 'page.tsx'), 'utf8');
    expect(midia).not.toMatch(/res\?\.data \|\| \[\]/);
    expect(midia).not.toMatch(/updated(\?)?\.data/);
    expect(midia).not.toMatch(/const \{ data \} = await api\.post/);
  });

  it('o filtro por pasta recalcula quando a pasta ativa muda', () => {
    const midia = fs.readFileSync(path.join(SRC, 'app', '[marca]', 'configuracoes', 'midia', 'page.tsx'), 'utf8');
    expect(midia).toContain('}, [assets, filterSource, filterTag, activeFolder]);');
  });
});
