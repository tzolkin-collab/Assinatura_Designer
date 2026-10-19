import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { prismaMock } from './client';
import { app } from '../app';
import {
  canBeDelivered,
  computeFinalGate,
  readFinalGate,
  withServerOwnedFinalGate,
} from '../lib/designerBrain/finalGate';

vi.mock('jsonwebtoken', () => ({
  default: { verify: vi.fn(), sign: vi.fn(() => 'jwt'), JsonWebTokenError: class JsonWebTokenError extends Error {} },
}));
vi.mock('../lib/postVersions.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/postVersions.js')>()),
  snapshotPost: vi.fn(async () => null),
}));
vi.mock('../lib/postHelper.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/postHelper.js')>()),
  syncPostSlides: vi.fn(async () => undefined),
}));
const publishPost = vi.fn(async () => ({ publicSlug: 'abc', publishedAt: new Date() }));
vi.mock('../lib/presentationHosting.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/presentationHosting.js')>()),
  publishPost: (...a: unknown[]) => (publishPost as any)(...a),
}));
const enqueueDeckExport = vi.fn(async () => 'job-1');
vi.mock('../lib/queue.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/queue.js')>()),
  enqueueDeckExport: (...a: unknown[]) => (enqueueDeckExport as any)(...a),
}));

describe('computeFinalGate', () => {
  it('texto em revisão bloqueia', () => {
    const g = computeFinalGate({ hasInReview: true, generatedCount: 5 });
    expect(g.blocking).toHaveLength(1);
    expect(canBeDelivered({ finalGate: g })).toBe(false);
  });
  it('quantidade, fonte e pendências do cadastro são notas e não bloqueiam', () => {
    const g = computeFinalGate({
      hasInReview: false,
      requestedCount: 5,
      generatedCount: 4,
      fontNotice: '**Aviso de fonte:** Queens ausente',
      brainPending: ['Número total de slides'],
    });
    expect(g.blocking).toEqual([]);
    expect(g.notes).toHaveLength(3);
    expect(g.notes.join(' ')).not.toContain('**');
    expect(canBeDelivered({ finalGate: g })).toBe(true);
  });
  it('sem nada a dizer, não há porta', () => {
    expect(computeFinalGate({ hasInReview: false, generatedCount: 3 })).toEqual({ blocking: [], notes: [] });
    expect(readFinalGate({ finalGate: { blocking: [], notes: [] } })).toBeNull();
  });
  it('conteúdo antigo ou malformado vira "sem porta" e pode sair', () => {
    expect(readFinalGate(null)).toBeNull();
    expect(readFinalGate({ finalGate: 'x' })).toBeNull();
    expect(canBeDelivered({ kind: 'html-design' })).toBe(true);
    expect(readFinalGate({ finalGate: { blocking: [1, 'a'] } })?.blocking).toEqual(['a']);
  });
  it('withServerOwnedFinalGate: o corpo não cria, altera nem remove', () => {
    const stored = { finalGate: { blocking: ['x'], notes: [] } };
    expect(withServerOwnedFinalGate({ a: 1 }, stored)).toEqual({ a: 1, finalGate: stored.finalGate });
    expect(withServerOwnedFinalGate({ finalGate: { blocking: [], notes: [] } }, stored)).toEqual({ finalGate: stored.finalGate });
    expect(withServerOwnedFinalGate({ finalGate: { blocking: ['forjada'] } }, { kind: 'x' })).toEqual({});
  });
});

const mockedVerify = jwt.verify as unknown as Mock;
const auth = (r: request.Test) => r.set('Authorization', 'Bearer token');
const emRevisao = { kind: 'html-design', finalGate: { blocking: ['Há texto em revisão'], notes: [] } };

describe('porta de final nas rotas de entrega', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedVerify.mockReturnValue({ userId: 'user-1' });
  });

  it('PUT não deixa o editor apagar a trava', async () => {
    prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1', brandId: 'b', content: emRevisao } as never);
    prismaMock.post.update.mockResolvedValue({ id: 'post-1', slides: [], brand: {} } as never);
    await auth(request(app).put('/api/posts/post-1')).send({ content: { kind: 'html-design', slides: [{ html: '<p>x</p>' }] } });
    const saved = (prismaMock.post.update.mock.calls[0]![0] as any).data.content;
    expect(saved.finalGate).toEqual(emRevisao.finalGate);
  });

  it('publicar recusa com 409 DRAFT_NOT_FINAL', async () => {
    prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1', content: emRevisao } as never);
    const res = await auth(request(app).post('/api/posts/post-1/publish')).send({});
    expect(res.status).toBe(409);
    expect(res.body.error?.code ?? res.body.code).toBe('DRAFT_NOT_FINAL');
    expect(JSON.stringify(res.body)).toContain('em revisão');
    expect(publishPost).not.toHaveBeenCalled();
  });

  it('publicar com confirmarRascunho passa', async () => {
    prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1', content: emRevisao } as never);
    const res = await auth(request(app).post('/api/posts/post-1/publish')).send({ confirmarRascunho: true });
    expect(res.status).toBe(200);
    expect(publishPost).toHaveBeenCalled();
  });

  it('publicar peça sem porta funciona como antes', async () => {
    prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1', content: { kind: 'html-design' } } as never);
    const res = await auth(request(app).post('/api/posts/post-1/publish')).send({});
    expect(res.status).toBe(200);
  });

  it('export-file recusa antes de enfileirar', async () => {
    prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1', content: emRevisao, slides: [] } as never);
    const res = await auth(request(app).post('/api/posts/post-1/export-file')).send({ format: 'pdf' });
    expect(res.status).toBe(409);
    expect(enqueueDeckExport).not.toHaveBeenCalled();
  });

  it('export-canva recusa antes de checar a conexão do Canva', async () => {
    prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1', content: emRevisao, slides: [] } as never);
    const res = await auth(request(app).post('/api/posts/post-1/export-canva')).send({});
    expect(res.status).toBe(409);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});
