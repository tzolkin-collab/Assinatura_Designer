// Contrato da lista leve da Galeria: GET /api/brands/:slug/posts?view=gallery.
// O que importa aqui é o que a lista NÃO leva (chatHistory de 4 MB por post, usedAssets, reasoning,
// slides além da capa) e o que ela PRECISA levar para a Galeria funcionar sem buscar o post inteiro.
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import { prismaMock } from './client';
import { app } from '../app';
import jwt from 'jsonwebtoken';
import { toGalleryPost, GALLERY_STRIPPED_CONTENT_KEYS } from '../lib/galleryPosts';

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
    sign: vi.fn(() => 'jwt-assinado'),
    JsonWebTokenError: class JsonWebTokenError extends Error {},
  },
}));

const mockedVerify = jwt.verify as unknown as Mock;
const queryRaw = (prismaMock as unknown as { $queryRaw: Mock }).$queryRaw;
const get = (qs = '') =>
  request(app).get(`/api/brands/minha-marca/posts${qs}`).set('Authorization', 'Bearer token');

const slide = (n: number) => ({ html: `<h1>Slide ${n}</h1>`, css: `.s${n}-a{color:red}` });

/** Linha de Post como a consulta leve a devolve do Prisma. */
const postRow = (over: Record<string, unknown> = {}) => ({
  id: 'post-1', name: 'Deck', type: 'PRESENTATION', status: 'READY', previewUrl: null,
  createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-02T00:00:00Z'),
  brandId: 'brand-1', folderId: null, createdById: 'user-1',
  publicSlug: null, publishedAt: null, hostingConfig: null, folder: null,
  createdBy: { id: 'user-1', name: 'Ana', email: 'ana@x.com' },
  slides: [{ id: 'slide-1', contentJson: slide(1), metadata: { goal: 'abrir' } }],
  _count: { slides: 5 },
  ...over,
});

/** Linha da consulta que já tira os campos pesados no banco. */
const contentRow = (over: Record<string, unknown> = {}) => ({
  id: 'post-1',
  content: { kind: 'html-design', version: 1, width: 1920, height: 1080, fonts: ['Inter'], sessionId: 'sess-1' },
  blobFirstSlide: null, blobSlideCount: 0, chatCount: 12,
  ...over,
});

describe('toGalleryPost', () => {
  it('leva a capa, a contagem e a marca de lista parcial, sem os campos pesados', () => {
    const out = toGalleryPost(postRow() as never, contentRow() as never);
    expect(out.light).toBe(true);
    expect(out.slideCount).toBe(5);
    expect(out.hasChatHistory).toBe(true);
    const content = out.content as Record<string, unknown>;
    expect(content.slides).toEqual([{ ...slide(1), id: 'slide-1', metadata: { goal: 'abrir' } }]);
    expect(content).toMatchObject({ kind: 'html-design', width: 1920, height: 1080, sessionId: 'sess-1' });
    for (const k of GALLERY_STRIPPED_CONTENT_KEYS.filter((k) => k !== 'slides')) expect(content).not.toHaveProperty(k);
    expect(out).not.toHaveProperty('_count');
  });

  it('deck antigo com slides só no blob: capa e contagem vêm do blob', () => {
    const out = toGalleryPost(
      postRow({ slides: [], _count: { slides: 0 } }) as never,
      contentRow({ blobFirstSlide: slide(9), blobSlideCount: 3 }) as never,
    );
    expect(out.slideCount).toBe(3);
    expect((out.content as { slides: unknown[] }).slides).toEqual([slide(9)]);
  });

  it('post sem conversa não tem histórico', () => {
    expect(toGalleryPost(postRow() as never, contentRow({ chatCount: 0 }) as never).hasChatHistory).toBe(false);
    expect(toGalleryPost(postRow() as never, contentRow({ chatCount: BigInt(0) }) as never).hasChatHistory).toBe(false);
  });

  it('contagem em BigInt (retorno do $queryRaw) vira número', () => {
    const out = toGalleryPost(postRow({ slides: [], _count: { slides: 0 } }) as never, contentRow({ blobSlideCount: BigInt(4), chatCount: BigInt(2) }) as never);
    expect(out.slideCount).toBe(4);
    expect(out.hasChatHistory).toBe(true);
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it('post sem conteúdo (FAILED, rascunho) continua válido', () => {
    const out = toGalleryPost(postRow({ status: 'FAILED', slides: [], _count: { slides: 0 } }) as never, contentRow({ content: null }) as never);
    expect(out.content).toBeNull();
    expect(out.slideCount).toBe(0);
  });

  it('sem linha de conteúdo (corrida entre as duas consultas) não quebra', () => {
    const out = toGalleryPost(postRow() as never, undefined);
    expect(out.content).toBeNull();
    expect(out.hasChatHistory).toBe(false);
  });

  it('imagem e ir-design não ganham slides inventados', () => {
    const img = toGalleryPost(postRow({ slides: [], _count: { slides: 0 } }) as never, contentRow({ content: { kind: 'image', url: 'https://x/y.png' } }) as never);
    expect(img.content).toEqual({ kind: 'image', url: 'https://x/y.png' });
    const ir = toGalleryPost(postRow() as never, contentRow({ content: { kind: 'ir-design', ir: { w: 1 } } }) as never);
    expect(ir.content).toEqual({ kind: 'ir-design', ir: { w: 1 } });
  });
});

describe('GET /api/brands/:slug/posts?view=gallery', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedVerify.mockReturnValue({ userId: 'user-1' });
    prismaMock.brand.findFirst.mockResolvedValue({ id: 'brand-1' } as never);
  });

  it('devolve a forma leve e nunca o chatHistory', async () => {
    prismaMock.post.findMany.mockResolvedValue([postRow()] as never);
    queryRaw.mockResolvedValue([contentRow({ chatCount: BigInt(40) })] as never);

    const res = await get('?view=gallery');
    expect(res.status).toBe(200);
    const [p] = res.body.data;
    expect(p).toMatchObject({ id: 'post-1', light: true, slideCount: 5, hasChatHistory: true, folderId: null });
    expect(p.content.slides).toHaveLength(1);
    expect(p.createdBy).toEqual({ id: 'user-1', name: 'Ana', email: 'ana@x.com' });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('chatHistory');
    expect(raw).not.toContain('usedAssets');
    expect(raw).not.toContain('reasoning');
  });

  it('a consulta ao banco não traz o content nem os slides inteiros', async () => {
    prismaMock.post.findMany.mockResolvedValue([] as never);
    queryRaw.mockResolvedValue([] as never);
    await get('?view=gallery');

    const arg = prismaMock.post.findMany.mock.calls[0]![0] as { select?: Record<string, unknown>; include?: unknown; where: unknown };
    expect(arg.include).toBeUndefined();
    expect(arg.select).toBeDefined();
    expect(arg.select).not.toHaveProperty('content');
    expect(arg.select!.slides).toMatchObject({ take: 1 });
    expect(arg.where).toEqual({ brandId: 'brand-1' });
  });

  it('sem o parâmetro a lista continua completa (contrato antigo)', async () => {
    prismaMock.post.findMany.mockResolvedValue([] as never);
    await get();
    const arg = prismaMock.post.findMany.mock.calls[0]![0] as { include?: Record<string, unknown> };
    expect(arg.include).toMatchObject({ slides: { orderBy: { position: 'asc' } } });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('marca de outro usuário continua 404', async () => {
    prismaMock.brand.findFirst.mockResolvedValue(null as never);
    const res = await get('?view=gallery');
    expect(res.status).toBe(404);
    expect(prismaMock.post.findMany).not.toHaveBeenCalled();
  });
});
