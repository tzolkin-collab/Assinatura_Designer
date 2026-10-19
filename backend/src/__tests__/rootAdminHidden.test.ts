import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { prismaMock } from './client';
import { app } from '../app';
import { config } from '../config';
import { ensureInternalTeamMemberships } from '../lib/internalTeam';

// O login root (rootSystem) fica fora da regra "todo usuário é membro de toda marca" e fora da lista de
// tenants: não é membro de verdade de marca nenhuma.

const adminToken = jwt.sign({ userId: 'admin-1', role: 'ADMIN' }, config.jwtSecret);

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

describe('GET /api/settings/tenants esconde o root', () => {
  beforeEach(() => {
    prismaMock.brand.findMany = vi.fn().mockResolvedValue([
      {
        id: 'b1',
        name: 'Amanda',
        slug: 'amanda',
        color: '#000',
        createdAt: new Date().toISOString(),
        _count: { posts: 1, folders: 0 },
        members: [
          { role: 'OWNER', user: { id: 'r', name: 'rootSystem', email: 'rootsystem' } },
          { role: 'EDITOR', user: { id: 'u1', name: 'Ana', email: 'ana@x.com' } },
        ],
      },
    ]);
  });

  it('o root não aparece entre os membros', async () => {
    const res = await request(app).get('/api/settings/tenants').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const members = res.body.data[0].members as Array<{ user: { email: string } }>;
    expect(members.map((m) => m.user.email)).toEqual(['ana@x.com']);
  });
});
