import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import { prismaMock } from './client';
import { app } from '../app';
import jwt from 'jsonwebtoken';

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
    sign: vi.fn(() => 'jwt-assinado'),
    JsonWebTokenError: class JsonWebTokenError extends Error {},
  },
}));

const mockedVerify = jwt.verify as unknown as Mock;
const auth = (r: request.Test) => r.set('Authorization', 'Bearer token');

describe('folders/team — validação de corpo (zod)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedVerify.mockReturnValue({ userId: 'user-1' });
    prismaMock.brand.findUnique.mockResolvedValue({ id: 'brand-1', slug: 'minha-marca' });
    prismaMock.brandMember.findUnique.mockResolvedValue({ role: 'ADMIN' });
  });

  describe('POST /api/folders/:slug', () => {
    it('400 quando o nome é só espaço em branco', async () => {
      const res = await auth(request(app).post('/api/folders/minha-marca').send({ name: '   ' }));
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Folder name is required');
      expect(prismaMock.folder.create).not.toHaveBeenCalled();
    });

    it('400 quando parentId não é string', async () => {
      const res = await auth(request(app).post('/api/folders/minha-marca').send({ name: 'Campanhas', parentId: 123 }));
      expect(res.status).toBe(400);
      expect(prismaMock.folder.create).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/folders/:id', () => {
    it('400 quando o corpo não traz name nem parentId', async () => {
      const res = await auth(request(app).patch('/api/folders/folder-9').send({}));
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('ao menos um campo');
    });
  });

  describe('PATCH /api/brands/:slug/members/:userId', () => {
    it('400 quando o role é inválido (evita lixo no update do Prisma)', async () => {
      const res = await auth(request(app).patch('/api/brands/minha-marca/members/user-2').send({ role: 'SUPERGOD' }));
      expect(res.status).toBe(400);
      expect(prismaMock.brandMember.update).not.toHaveBeenCalled();
    });
  });
});
