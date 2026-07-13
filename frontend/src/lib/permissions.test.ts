import { describe, it, expect } from 'vitest';
import { can, isReadOnly, permissionHint, type BrandAction, type BrandRole } from './permissions';

/**
 * Esta matriz precisa espelhar `backend/src/middleware/brandAccess.ts`. Se divergir,
 * a interface oferece um botão que o servidor recusa com 403 — que é exatamente o
 * problema que este módulo existe para evitar.
 */
describe('Permissões por papel na marca', () => {
  const ESCRITAS: BrandAction[] = ['edit-design', 'manage-assets', 'generate', 'export', 'edit-settings'];
  const ADMIN_ONLY: BrandAction[] = ['manage-team', 'manage-integrations'];

  describe('sem papel (não é membro): nada é permitido', () => {
    const TODAS: BrandAction[] = [...ESCRITAS, ...ADMIN_ONLY];
    it.each(TODAS)('bloqueia %s', (action) => {
      expect(can(undefined, action)).toBe(false);
    });
  });

  describe('VIEWER: só lê', () => {
    it.each(ESCRITAS)('bloqueia %s', (action) => {
      expect(can('VIEWER', action)).toBe(false);
    });

    it.each(ADMIN_ONLY)('bloqueia %s', (action) => {
      expect(can('VIEWER', action)).toBe(false);
    });

    it('é sinalizado como somente-leitura', () => {
      expect(isReadOnly('VIEWER')).toBe(true);
      expect(permissionHint('VIEWER')).toMatch(/apenas de visualização/i);
    });
  });

  describe('EDITOR: trabalha, mas não administra', () => {
    it.each(ESCRITAS)('permite %s', (action) => {
      expect(can('EDITOR', action)).toBe(true);
    });

    it.each(ADMIN_ONLY)('bloqueia %s (é ação de admin)', (action) => {
      expect(can('EDITOR', action)).toBe(false);
    });

    it('não é somente-leitura', () => {
      expect(isReadOnly('EDITOR')).toBe(false);
    });
  });

  describe('ADMIN e OWNER: podem tudo que a UI expõe', () => {
    const ADMINS: BrandRole[] = ['ADMIN', 'OWNER'];

    it.each(ADMINS)('%s pode gerenciar equipe e integrações', (role) => {
      expect(can(role, 'manage-team')).toBe(true);
      expect(can(role, 'manage-integrations')).toBe(true);
    });

    it.each(ADMINS)('%s pode editar e exportar', (role) => {
      expect(can(role, 'edit-design')).toBe(true);
      expect(can(role, 'export')).toBe(true);
    });
  });

  it('exportar exige papel de edição — VIEWER não consome cota do Canva', () => {
    expect(can('VIEWER', 'export')).toBe(false);
    expect(can('EDITOR', 'export')).toBe(true);
  });

  it('gerar com IA exige papel de edição — VIEWER não gasta cota do Gemini', () => {
    expect(can('VIEWER', 'generate')).toBe(false);
    expect(can('EDITOR', 'generate')).toBe(true);
  });
});
