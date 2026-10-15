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
vi.mock('../lib/postVersions.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/postVersions.js')>()),
  snapshotPost: vi.fn(async () => null),
}));
vi.mock('../lib/postHelper.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/postHelper.js')>()),
  syncPostSlides: vi.fn(async () => undefined),
}));

const mockedVerify = jwt.verify as unknown as Mock;
const put = (body: unknown) =>
  request(app).put('/api/posts/post-1').set('Authorization', 'Bearer token').send(body as object);

describe('PUT /api/posts/:id — procedência de peça de agente (B6)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedVerify.mockReturnValue({ userId: 'user-1' });
    prismaMock.post.update.mockResolvedValue({ id: 'post-1', slides: [], brand: {} } as never);
  });

  it('editor regravando sem o marcador não tira a peça do agente', async () => {
    prismaMock.post.findFirst.mockResolvedValue({
      id: 'post-1', brandId: 'b', content: { kind: 'html-design', mcp: { userId: 'agente-1' } },
    } as never);
    await put({ content: { kind: 'html-design', slides: [{ html: '<p>x</p>' }], fonts: ['Inter'] } });
    const saved = (prismaMock.post.update.mock.calls[0]![0] as any).data.content;
    expect(saved.mcp).toEqual({ userId: 'agente-1' });
  });

  it('marcador forjado no corpo não vira dono', async () => {
    prismaMock.post.findFirst.mockResolvedValue({
      id: 'post-1', brandId: 'b', content: { kind: 'html-design', mcp: { userId: 'agente-1' } },
    } as never);
    await put({ content: { kind: 'html-design', slides: [{ html: '<p>x</p>' }], mcp: { userId: 'user-1' } } });
    const saved = (prismaMock.post.update.mock.calls[0]![0] as any).data.content;
    expect(saved.mcp).toEqual({ userId: 'agente-1' });
  });

  it('peça comum não ganha marcador', async () => {
    prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1', brandId: 'b', content: { kind: 'html-design' } } as never);
    await put({ content: { kind: 'html-design', slides: [{ html: '<p>x</p>' }], mcp: { userId: 'user-1' } } });
    const saved = (prismaMock.post.update.mock.calls[0]![0] as any).data.content;
    expect(saved).not.toHaveProperty('mcp');
  });
});
