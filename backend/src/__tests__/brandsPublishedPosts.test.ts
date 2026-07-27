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

describe('GET /api/brands/:slug/posts?published=true', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedVerify.mockReturnValue({ userId: 'user-1' });
    prismaMock.brand.findFirst.mockResolvedValue({ id: 'brand-1' } as any);
  });

  it('404 se a marca não existe ou o usuário não é membro', async () => {
    prismaMock.brand.findFirst.mockResolvedValue(null);

    const res = await auth(request(app).get('/api/brands/minha-marca/posts?published=true'));

    expect(res.status).toBe(404);
  });

  it('devolve só os posts publicados, com select enxuto (sem slides)', async () => {
    prismaMock.post.findMany.mockResolvedValue([
      { id: 'post-1', name: 'Apresentação X', type: 'PRESENTATION', previewUrl: null, publicSlug: 'abc123', publishedAt: new Date('2026-07-20'), hostingConfig: { autoplay: true }, updatedAt: new Date() },
    ] as any);

    const res = await auth(request(app).get('/api/brands/minha-marca/posts?published=true'));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].publicSlug).toBe('abc123');
    expect(prismaMock.post.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { brandId: 'brand-1', publishedAt: { not: null } },
      select: expect.objectContaining({ publicSlug: true, publishedAt: true, hostingConfig: true }),
    }));
    // nunca puxa slides pra essa lista (endpoint é só pra listar links publicados)
    const call = prismaMock.post.findMany.mock.calls[0]![0] as any;
    expect(call.select.slides).toBeUndefined();
    expect(call.include).toBeUndefined();
  });

  it('sem ?published=true, mantém o comportamento antigo (todos os posts, com slides)', async () => {
    prismaMock.post.findMany.mockResolvedValue([]);

    await auth(request(app).get('/api/brands/minha-marca/posts'));

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { brandId: 'brand-1' },
      include: expect.objectContaining({ slides: expect.anything() }),
    }));
  });
});
