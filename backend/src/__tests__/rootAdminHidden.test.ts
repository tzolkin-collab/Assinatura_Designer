import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock } from './client';
import { ensureInternalTeamMemberships } from '../lib/internalTeam';

// O login root (rootSystem) fica fora da regra "todo usuário é membro de toda marca": não é membro
// de verdade de marca nenhuma. (A lista de Gestão de Tenants, que também o escondia, foi removida.)

describe('equipe interna ignora o login root', () => {
  beforeEach(() => {
    prismaMock.user.findMany = vi.fn().mockResolvedValue([{ id: 'u1', role: 'DESIGNER' }]);
    prismaMock.brand.findMany = vi.fn().mockResolvedValue([{ id: 'b1' }]);
    prismaMock.brandMember.findMany = vi.fn().mockResolvedValue([]);
    prismaMock.brandMember.createMany = vi.fn().mockResolvedValue({ count: 1 });
  });

  it('exclui o e-mail interno do root da busca de usuários', async () => {
    await ensureInternalTeamMemberships();
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: { not: 'rootsystem' } } }),
    );
    expect(prismaMock.brandMember.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [{ userId: 'u1', brandId: 'b1', role: 'EDITOR' }] }),
    );
  });
});
