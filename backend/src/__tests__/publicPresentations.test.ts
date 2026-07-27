import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import { prismaMock } from './client';
import { app } from '../app';
import jwt from 'jsonwebtoken';
import * as presentationChat from '../lib/presentationChat';

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
    sign: vi.fn(() => 'jwt-assinado'),
    JsonWebTokenError: class JsonWebTokenError extends Error {},
  },
}));

vi.mock('../lib/presentationChat', () => ({
  isChatEnabled: vi.fn(async () => false),
  setChatEnabled: vi.fn(async () => undefined),
  addChatMessage: vi.fn(async () => null),
  getChatMessages: vi.fn(async () => []),
  clearChat: vi.fn(async () => undefined),
}));

const mockedVerify = jwt.verify as unknown as Mock;
const auth = (r: request.Test) => r.set('Authorization', 'Bearer token');

describe('GET /api/public/presentations/:slug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publicado, sem Authorization: devolve name/content/hostingConfig + isOwner:false, sem dado de dono/marca', async () => {
    prismaMock.post.findFirst.mockResolvedValue({
      id: 'post-1',
      brandId: 'brand-1',
      name: 'Minha Apresentação',
      content: { kind: 'html-design', width: 1920, height: 1080, slides: [] },
      hostingConfig: { autoplay: true },
    });

    const res = await request(app).get('/api/public/presentations/abc123');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      name: 'Minha Apresentação',
      content: { kind: 'html-design', width: 1920, height: 1080, slides: [] },
      hostingConfig: { autoplay: true },
      isOwner: false,
      chat: { enabled: false },
    });
    expect(prismaMock.post.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { publicSlug: 'abc123', publishedAt: { not: null } },
    }));
  });

  it('não publicado/inexistente: 404', async () => {
    prismaMock.post.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/public/presentations/nao-existe');

    expect(res.status).toBe(404);
  });

  it('hostingConfig ausente: devolve objeto vazio em vez de null', async () => {
    prismaMock.post.findFirst.mockResolvedValue({
      id: 'post-1', brandId: 'brand-1', name: 'Sem toggles', content: {}, hostingConfig: null,
    });

    const res = await request(app).get('/api/public/presentations/xyz');

    expect(res.body.data.hostingConfig).toEqual({});
  });

  it('não exige Authorization header (rota de verdade pública)', async () => {
    prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1', brandId: 'brand-1', name: 'X', content: {}, hostingConfig: {} });
    const res = await request(app).get('/api/public/presentations/abc123');
    expect(res.status).not.toBe(401);
  });

  it('Authorization de quem NÃO é membro da marca: continua isOwner:false, sem postId', async () => {
    prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1', brandId: 'brand-1', name: 'X', content: {}, hostingConfig: {} });
    prismaMock.brandMember.findUnique.mockResolvedValue(null);
    mockedVerify.mockReturnValue({ userId: 'estranho' });

    const res = await auth(request(app).get('/api/public/presentations/abc123'));

    expect(res.body.data.isOwner).toBe(false);
    expect(res.body.data.postId).toBeUndefined();
  });

  it('Authorization de membro da marca dona: isOwner:true + postId (é quem vai apresentar)', async () => {
    prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1', brandId: 'brand-1', name: 'X', content: {}, hostingConfig: {} });
    prismaMock.brandMember.findUnique.mockResolvedValue({ role: 'EDITOR' });
    mockedVerify.mockReturnValue({ userId: 'designer-1' });

    const res = await auth(request(app).get('/api/public/presentations/abc123'));

    expect(res.body.data.isOwner).toBe(true);
    expect(res.body.data.postId).toBe('post-1');
  });
});

describe('GET/POST /api/public/presentations/:slug/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET: anônimo recebe enabled, mas nunca as mensagens (mesmo se o chat estiver ligado)', async () => {
    prismaMock.post.findFirst.mockResolvedValue({ brandId: 'brand-1' });
    (presentationChat.isChatEnabled as Mock).mockResolvedValue(true);
    (presentationChat.getChatMessages as Mock).mockResolvedValue([{ id: 'm1', text: 'oi', createdAt: 1 }]);

    const res = await request(app).get('/api/public/presentations/abc123/chat');

    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(true);
    expect(res.body.data.messages).toEqual([]);
  });

  it('GET: dono autenticado recebe as mensagens', async () => {
    prismaMock.post.findFirst.mockResolvedValue({ brandId: 'brand-1' });
    prismaMock.brandMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    mockedVerify.mockReturnValue({ userId: 'designer-1' });
    (presentationChat.isChatEnabled as Mock).mockResolvedValue(true);
    (presentationChat.getChatMessages as Mock).mockResolvedValue([{ id: 'm1', text: 'Qual o preço?', createdAt: 1 }]);

    const res = await auth(request(app).get('/api/public/presentations/abc123/chat'));

    expect(res.body.data.messages).toHaveLength(1);
    expect(res.body.data.messages[0].text).toBe('Qual o preço?');
  });

  it('GET: 404 se a apresentação não existe/não está publicada', async () => {
    prismaMock.post.findFirst.mockResolvedValue(null);
    const res = await request(app).get('/api/public/presentations/nao-existe/chat');
    expect(res.status).toBe(404);
  });

  it('POST: 403 se o palestrante não habilitou perguntas', async () => {
    prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1' });
    (presentationChat.isChatEnabled as Mock).mockResolvedValue(false);

    const res = await request(app).post('/api/public/presentations/abc123/chat').send({ text: 'Oi' });

    expect(res.status).toBe(403);
  });

  it('POST: 400 se a mensagem vier vazia', async () => {
    prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1' });
    (presentationChat.isChatEnabled as Mock).mockResolvedValue(true);

    const res = await request(app).post('/api/public/presentations/abc123/chat').send({ text: '   ' });

    expect(res.status).toBe(400);
  });

  it('POST: sucesso quando habilitado + texto válido — REGRESSÃO chave: não exige nenhum login', async () => {
    prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1' });
    (presentationChat.isChatEnabled as Mock).mockResolvedValue(true);
    const addSpy = (presentationChat.addChatMessage as Mock).mockResolvedValue({ id: 'm1', text: 'Pergunta', createdAt: 123 });

    const res = await request(app).post('/api/public/presentations/abc123/chat').send({ text: 'Pergunta' });

    expect(res.status).toBe(201);
    expect(res.status).not.toBe(401);
    expect(addSpy).toHaveBeenCalledWith('abc123', 'Pergunta');
  });
});

describe('POST /api/posts/:id/publish e /unpublish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedVerify.mockReturnValue({ userId: 'user-1' });
  });

  it('publica com sucesso quando o post pertence a uma marca do usuário', async () => {
    prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1' });
    prismaMock.post.findUnique.mockResolvedValue({ id: 'post-1' });
    prismaMock.post.update.mockResolvedValue({
      publicSlug: 'novo-slug',
      publishedAt: new Date('2026-07-22T12:00:00Z'),
    });

    const res = await auth(request(app).post('/api/posts/post-1/publish').send({ hostingConfig: { autoplay: true } }));

    expect(res.status).toBe(200);
    expect(res.body.data.publicSlug).toBe('novo-slug');
    expect(res.body.data.path).toBe('/apresentacao/novo-slug');
  });

  it('404 quando o post não existe ou não pertence à marca do usuário', async () => {
    prismaMock.post.findFirst.mockResolvedValue(null);

    const res = await auth(request(app).post('/api/posts/post-x/publish').send({}));

    expect(res.status).toBe(404);
    expect(prismaMock.post.update).not.toHaveBeenCalled();
  });

  it('400 quando hostingConfig tem campo de tipo errado', async () => {
    const res = await auth(request(app).post('/api/posts/post-1/publish').send({ hostingConfig: { autoplay: 'sim' } }));

    expect(res.status).toBe(400);
    expect(prismaMock.post.findFirst).not.toHaveBeenCalled();
  });

  it('despublica com sucesso', async () => {
    prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1' });
    prismaMock.post.findUnique.mockResolvedValue({ id: 'post-1' });
    prismaMock.post.update.mockResolvedValue({});

    const res = await auth(request(app).post('/api/posts/post-1/unpublish'));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ success: true });
  });
});

describe('POST /api/posts/:id/chat/toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedVerify.mockReturnValue({ userId: 'user-1' });
  });

  it('liga o chat quando o post está publicado', async () => {
    prismaMock.post.findFirst.mockResolvedValue({ publicSlug: 'slug-1', publishedAt: new Date() });
    const setSpy = (presentationChat.setChatEnabled as Mock).mockResolvedValue(undefined);

    const res = await auth(request(app).post('/api/posts/post-1/chat/toggle').send({ enabled: true }));

    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(true);
    expect(setSpy).toHaveBeenCalledWith('slug-1', true);
  });

  it('400 se o post ainda não foi publicado (não tem slug pra guardar o estado)', async () => {
    prismaMock.post.findFirst.mockResolvedValue({ publicSlug: null, publishedAt: null });

    const res = await auth(request(app).post('/api/posts/post-1/chat/toggle').send({ enabled: true }));

    expect(res.status).toBe(400);
  });

  it('404 se o post não existe ou não pertence à marca do usuário', async () => {
    prismaMock.post.findFirst.mockResolvedValue(null);

    const res = await auth(request(app).post('/api/posts/post-1/chat/toggle').send({ enabled: true }));

    expect(res.status).toBe(404);
  });

  it('400 se `enabled` não vier como boolean', async () => {
    const res = await auth(request(app).post('/api/posts/post-1/chat/toggle').send({ enabled: 'sim' }));

    expect(res.status).toBe(400);
    expect(prismaMock.post.findFirst).not.toHaveBeenCalled();
  });
});
