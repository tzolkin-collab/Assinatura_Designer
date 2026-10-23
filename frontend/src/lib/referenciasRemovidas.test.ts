import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// A pesquisa de concorrentes saiu do produto (Fase 1: só some o acesso; os dados ficam no banco).
// Estes testes seguram o que não pode quebrar: o endereço antigo leva à Visão geral, o menu e a
// Visão geral não apontam mais para a tela, e nenhum link para ela sobra no código.

const redirect = vi.fn();
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));

import { BRAND_SETTINGS, brandNav } from './navigation';

const SRC = path.resolve(__dirname, '..');

function arquivos(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? arquivos(full) : [full];
  });
}

describe('pesquisa de concorrentes removida', () => {
  it('o endereço antigo /{marca}/configuracoes/referencias redireciona para /{marca}', async () => {
    const { default: ReferenciasPage } = await import('../app/[marca]/configuracoes/referencias/page');
    await ReferenciasPage({ params: Promise.resolve({ marca: 'minha-marca' }) });
    expect(redirect).toHaveBeenCalledWith('/minha-marca');
  });

  it('nenhum item de menu aponta para referências', () => {
    expect(BRAND_SETTINGS.map((s) => s.key)).not.toContain('referencias');
    expect(brandNav('m').map((i) => i.href).some((h) => h.includes('referencias'))).toBe(false);
  });

  it('nenhum arquivo do frontend linka a tela antiga nem chama a API de referências', () => {
    const redirecionador = path.join('configuracoes', 'referencias', 'page.tsx');
    const ofensores = arquivos(SRC)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(redirecionador) && !f.endsWith('referenciasRemovidas.test.ts'))
      .filter((f) => /configuracoes\/referencias|\/referencias[`'"/]/.test(fs.readFileSync(f, 'utf8')));
    expect(ofensores).toEqual([]);
  });
});
