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

describe('posts/settings — validação de corpo (zod)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedVerify.mockReturnValue({ userId: 'user-1' });
    prismaMock.brand.findUnique.mockResolvedValue({ id: 'brand-1', slug: 'minha-marca' });
    prismaMock.brandMember.findUnique.mockResolvedValue({ role: 'EDITOR' });
  });

  describe('POST /api/posts/:id/export-file', () => {
    it('400 com formato inválido, antes de tocar o banco', async () => {
      const res = await auth(request(app).post('/api/posts/post-1/export-file').send({ format: 'gif' }));
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("format deve ser");
      expect(prismaMock.post.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/posts/:id/versions', () => {
    it('400 quando label não é string (antes virava erro 500 no .trim())', async () => {
      const res = await auth(request(app).post('/api/posts/post-1/versions').send({ label: 123 }));
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/posts/:id/export-canva', () => {
    it('400 quando slideIndex não é número', async () => {
      const res = await auth(request(app).post('/api/posts/post-1/export-canva').send({ slideIndex: 'primeiro' }));
      expect(res.status).toBe(400);
      expect(prismaMock.post.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/settings/:slug/referencias', () => {
    it('400 sem name (após resolver a marca)', async () => {
      const res = await auth(request(app).post('/api/settings/minha-marca/referencias').send({ analysisUrl: 'https://exemplo.com' }));
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Reference name is required');
    });
  });
});
