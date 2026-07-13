import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import { prismaMock } from './client';
import { app } from '../app';
import jwt from 'jsonwebtoken';

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
    JsonWebTokenError: class JsonWebTokenError extends Error {},
  }
}));

describe('Team API (Role Guards)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const generateMockToken = () => 'mocked.jwt.token';

  const mockedVerify = jwt.verify as unknown as Mock;

  // A rota é montada em /api/brands/:brandId/members, e o guard resolve a marca
  // pelo slug — por isso o lookup da marca precisa estar mockado nos dois testes.
  const mockBrand = () => {
    prismaMock.brand.findUnique.mockResolvedValue({
      id: 'brand-1',
      slug: 'brand-1',
      name: 'Brand One',
    });
  };

  it('should block inviting a member if user is VIEWER (403)', async () => {
    // 1. Mock token verification to simulate user 'user-1'
    mockedVerify.mockReturnValue({ userId: 'user-1', email: 'viewer@test.com' });

    mockBrand();

    // 2. Mock Prisma finding the brand member as 'VIEWER'
    prismaMock.brandMember.findUnique.mockResolvedValue({
      id: 'member-1',
      brandId: 'brand-1',
      userId: 'user-1',
      role: 'VIEWER',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .post('/api/brands/brand-1/members/invite')
      .set('Authorization', `Bearer ${generateMockToken()}`)
      .send({ email: 'newbie@test.com', role: 'EDITOR' });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('Você não tem permissão para realizar esta ação na marca.');
    expect(prismaMock.brandMember.create).not.toHaveBeenCalled();
  });

  it('should allow inviting a member if user is OWNER (201)', async () => {
    // 1. Mock token verification to simulate user 'user-2'
    mockedVerify.mockReturnValue({ userId: 'user-2', email: 'owner@test.com' });

    mockBrand();

    // 2. Mock Prisma finding the brand member as 'OWNER' (Middleware)
    prismaMock.brandMember.findUnique.mockResolvedValueOnce({
      id: 'member-2',
      brandId: 'brand-1',
      userId: 'user-2',
      role: 'OWNER',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 3. O convidado já tem conta -> vincula direto (o caso de email sem conta,
    //    que emite convite com token, está coberto em invites.test.ts).
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'new-user', email: 'newbie@test.com' });

    // 4. Mock the existing membership check in the controller
    prismaMock.brandMember.findUnique.mockResolvedValueOnce(null);

    // 5. Mock the creation of the membership
    prismaMock.brandMember.create.mockResolvedValueOnce({ role: 'EDITOR' });

    // 6. Mock notification creation
    prismaMock.notification.create.mockResolvedValueOnce({});

    const res = await request(app)
      .post('/api/brands/brand-1/members/invite')
      .set('Authorization', `Bearer ${generateMockToken()}`)
      .send({ email: 'newbie@test.com', role: 'EDITOR' });

    expect(res.status).toBe(201);
    // A rota passou a devolver { member, invite }: `invite` só vem quando o email
    // ainda não tem conta. Aqui o usuário existe, então vincula direto.
    expect(res.body.data.member.role).toBe('EDITOR');
    expect(res.body.data.invite).toBeNull();
  });
});
