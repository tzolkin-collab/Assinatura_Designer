import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import { prismaMock } from './client';
import { app } from '../app';
import jwt from 'jsonwebtoken';

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
    sign: vi.fn(() => 'jwt'),
    JsonWebTokenError: class JsonWebTokenError extends Error {},
  },
}));

// O mock compartilhado (client.ts) não conhece as tabelas de rastro; adicionamos aqui
// para não mexer num arquivo que todos os testes usam.
const generationRun = { findMany: vi.fn() };
prismaMock.generationRun = generationRun;

const get = (r: request.Test) => r.set('Authorization', 'Bearer token');

const run = (steps: unknown[], over: Record<string, unknown> = {}) => ({
  status: 'COMPLETED',
  startedAt: new Date('2026-09-21T10:00:00Z'),
  finishedAt: new Date('2026-09-21T10:01:00Z'),
  steps,
  ...over,
});

describe('GET /api/posts/:id/cost', () => {
  const mockedVerify = jwt.verify as unknown as Mock;

  beforeEach(() => {
    vi.resetAllMocks();
    mockedVerify.mockReturnValue({ userId: 'u1' });
    prismaMock.post.findUnique.mockResolvedValue({ id: 'post-1', brandId: 'marca-a' });
    prismaMock.brandMember.findUnique.mockResolvedValue({ role: 'VIEWER' });
    generationRun.findMany.mockResolvedValue([]);
  });

  it('200: membro da marca do post recebe a estimativa, rotulada como tal', async () => {
    generationRun.findMany.mockResolvedValue([
      run([
        // gemini-2.5-flash: 5k in a US$0,3/M + 1k out a US$2,5/M = 0,004
        { kind: 'MODEL', role: 'fast', model: 'gemini-2.5-flash', inputTokens: 5000, outputTokens: 1000, error: null, metadata: null },
        // imagem cobrada por tokens de saída: 1120 a US$60/M ≈ 0,0672
        { kind: 'IMAGE', role: null, model: 'gemini-3.1-flash-image', inputTokens: 0, outputTokens: 1120, error: null, metadata: {} },
        { kind: 'TOOL', role: null, model: null, inputTokens: null, outputTokens: null, error: null, metadata: {} },
      ]),
    ]);

    const res = await get(request(app).get('/api/posts/post-1/cost'));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      available: true,
      estimated: true,
      partial: false,
      runs: 1,
      inProgress: false,
      imageCount: 1,
      durationMs: 60_000,
      calls: 2,
    });
    expect(res.body.data.totalUsd).toBeCloseTo(0.0712, 4);
    expect(res.body.data.byRole.fast.usd).toBe(0.004);
    expect(res.body.data.byRole.image.calls).toBe(1);
  });

  it('inclui os tokens de raciocínio gravados no metadata e avisa quando o run ainda está rodando', async () => {
    generationRun.findMany.mockResolvedValue([
      run(
        [{ kind: 'MODEL', role: 'artist', model: 'gemini-3.1-pro-preview', inputTokens: 0, outputTokens: 1000, error: null, metadata: { thinkingTokens: 4000 } }],
        { status: 'RUNNING', finishedAt: null },
      ),
    ]);

    const res = await get(request(app).get('/api/posts/post-1/cost'));

    // (1000 + 4000) × US$12/M = 0,06
    expect(res.body.data.totalUsd).toBe(0.06);
    expect(res.body.data.thinkingTokens).toBe(4000);
    expect(res.body.data.inProgress).toBe(true);
    expect(res.body.data.durationMs).toBeNull();
  });

  it('modelo fora da tabela chega como parcial, com o nome do modelo', async () => {
    generationRun.findMany.mockResolvedValue([
      run([{ kind: 'MODEL', role: 'fast', model: 'modelo-que-nao-existe', inputTokens: 100, outputTokens: 100, error: null, metadata: null }]),
    ]);

    const res = await get(request(app).get('/api/posts/post-1/cost'));

    expect(res.status).toBe(200);
    expect(res.body.data.partial).toBe(true);
    expect(res.body.data.unpricedModels).toEqual(['modelo-que-nao-existe']);
  });

  it('403: membro de OUTRA marca não vê o custo, e o rastro nem é consultado', async () => {
    prismaMock.brandMember.findUnique.mockResolvedValue(null);

    const res = await get(request(app).get('/api/posts/post-1/cost'));

    expect(res.status).toBe(403);
    expect(generationRun.findMany).not.toHaveBeenCalled();
    // A checagem é feita contra a marca DO POST, com o usuário da sessão.
    expect(prismaMock.brandMember.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_brandId: { userId: 'u1', brandId: 'marca-a' } } }),
    );
  });

  it('404 quando o post não existe', async () => {
    prismaMock.post.findUnique.mockResolvedValue(null);

    const res = await get(request(app).get('/api/posts/nao-existe/cost'));

    expect(res.status).toBe(404);
    expect(generationRun.findMany).not.toHaveBeenCalled();
  });

  it('401 sem sessão', async () => {
    const res = await request(app).get('/api/posts/post-1/cost');

    expect(res.status).toBe(401);
  });

  it('available:false, sem erro, para deck anterior ao rastreamento (nenhum run)', async () => {
    generationRun.findMany.mockResolvedValue([]);

    const res = await get(request(app).get('/api/posts/post-1/cost'));

    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(false);
    expect(res.body.data.reason).toMatch(/antes do rastreamento/);
    expect(res.body.data.totalUsd).toBeUndefined();
  });

  it('available:false quando o run existe mas ainda não tem nenhuma chamada registrada', async () => {
    generationRun.findMany.mockResolvedValue([run([], { status: 'RUNNING', finishedAt: null })]);

    const res = await get(request(app).get('/api/posts/post-1/cost'));

    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(false);
  });

  it('não puxa prompt nem resposta dos steps (são MBs e não entram na conta)', async () => {
    await get(request(app).get('/api/posts/post-1/cost'));

    const select = generationRun.findMany.mock.calls[0]![0].select.steps.select;
    expect(select).not.toHaveProperty('promptText');
    expect(select).not.toHaveProperty('responseText');
    expect(generationRun.findMany.mock.calls[0]![0].where).toEqual({ postId: 'post-1' });
  });
});
