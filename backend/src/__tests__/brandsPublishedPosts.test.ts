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

  const capa = (w = 1920, h = 1080) =>
    `<!doctype html><html><head><style>
*{margin:0}
html,body{width:${w}px;height:${h}px;overflow:hidden;}
</style></head><body>x</body></html>`;

  it('devolve só os posts publicados, com a capa e a contagem, sem o conteúdo inteiro', async () => {
    prismaMock.post.findMany.mockResolvedValue([
      {
        id: 'post-1', name: 'Apresentação X', type: 'PRESENTATION', previewUrl: null, publicSlug: 'abc123',
        publishedAt: new Date('2026-07-20'), hostingConfig: { autoplay: true }, updatedAt: new Date(),
        slides: [{ htmlRender: capa() }], _count: { slides: 7 },
      },
    ] as any);

    const res = await auth(request(app).get('/api/brands/minha-marca/posts?published=true'));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const post = res.body.data[0];
    expect(post.publicSlug).toBe('abc123');
    expect(post.slideCount).toBe(7);
    expect(post.cover).toMatchObject({ width: 1920, height: 1080 });
    // a resposta não vaza o relacionamento cru nem o contador interno
    expect(post.slides).toBeUndefined();
    expect(post._count).toBeUndefined();
    expect(prismaMock.post.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { brandId: 'brand-1', publishedAt: { not: null } },
      select: expect.objectContaining({ publicSlug: true, publishedAt: true, hostingConfig: true }),
    }));
    const call = prismaMock.post.findMany.mock.calls[0]![0] as any;
    // só o PRIMEIRO slide, e só o HTML pronto: nunca o `content` do post nem todos os slides
    expect(call.select.slides).toMatchObject({ take: 1, select: { htmlRender: true } });
    expect(call.select.content).toBeUndefined();
    expect(call.include).toBeUndefined();
  });

  it('?recent=N devolve só os N mais recentes, sem slides e com teto de 24', async () => {
    prismaMock.post.findMany.mockResolvedValue([] as any);

    await auth(request(app).get('/api/brands/minha-marca/posts?recent=6'));
    await auth(request(app).get('/api/brands/minha-marca/posts?recent=500'));

    const [primeira, segunda] = prismaMock.post.findMany.mock.calls.map((c) => c[0] as any);
    expect(primeira).toMatchObject({ where: { brandId: 'brand-1' }, orderBy: { updatedAt: 'desc' }, take: 6 });
    expect(primeira.select).toMatchObject({ id: true, name: true, updatedAt: true });
    expect(primeira.select.slides).toBeUndefined();
    expect(primeira.include).toBeUndefined();
    expect(segunda.take).toBe(24);
  });

  it('?recent inválido cai no comportamento antigo', async () => {
    prismaMock.post.findMany.mockResolvedValue([] as any);

    await auth(request(app).get('/api/brands/minha-marca/posts?recent=abc'));

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(expect.objectContaining({ include: expect.anything() }));
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
