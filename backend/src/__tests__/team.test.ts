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

    // 3. O convidado já tem conta -> ainda assim cria o convite pendente
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'new-user', email: 'newbie@test.com' });

    // 4. Mock the creation of the invite
    prismaMock.invite.create.mockResolvedValueOnce({ role: 'EDITOR', email: 'newbie@test.com' });

    // 5. Mock notification creation
    prismaMock.notification.create.mockResolvedValueOnce({});

    const res = await request(app)
      .post('/api/brands/brand-1/members/invite')
      .set('Authorization', `Bearer ${generateMockToken()}`)
      .send({ email: 'newbie@test.com', role: 'EDITOR' });

    expect(res.status).toBe(201);
    
    // A rota devolve { member: null, invite: {...} } sempre, para que o convite
    // possa ser aceito ativamente pelo usuário.
    expect(res.body.data.member).toBeNull();
    expect(res.body.data.invite.role).toBe('EDITOR');
  });
});
