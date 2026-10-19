// applySlidePhoto: troca de foto de um espaço, compartilhada pelo editor e pelo MCP (set_slide_photo).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock } from './client';
import { applySlidePhoto } from '../lib/slidePhoto';

vi.mock('../lib/postVersions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/postVersions')>()),
  snapshotPost: vi.fn(async () => ({ id: 'v1' })),
}));
vi.mock('../lib/photoFraming', () => ({
  analyzePhoto: vi.fn(async () => ({ faces: [] })),
  measureSlotAspect: vi.fn(async () => 1.5),
  frameFromAnalysis: vi.fn(() => ({ position: { x: 40, y: 20 }, faceVisible: 0.95 })),
}));
import { snapshotPost } from '../lib/postVersions';
import { frameFromAnalysis } from '../lib/photoFraming';

const PHOTO = 'https://cdn.example.test/brands/b1/palco.jpg';
const OTHER = 'https://cdn.example.test/brands/b1/outra.jpg';

const post = (html = '<div data-photo-slot="1" style="width:400px;height:300px"></div>', over: Record<string, unknown> = {}) => ({
  id: 'post-1',
  brandId: 'b1',
  content: { kind: 'html-design', width: 1920, height: 1080, fonts: ['Inter'], version: 1 },
  slides: [{ id: 's0', position: 0, contentJson: { html }, metadata: null }],
  ...over,
});

const savedHtml = () => (prismaMock.slide.update.mock.calls[0]![0] as { data: { contentJson: { html: string } } }).data.contentJson.html;

describe('applySlidePhoto', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(snapshotPost).mockResolvedValue({ id: 'v1' } as never);
    vi.mocked(frameFromAnalysis).mockReturnValue({ position: { x: 40, y: 20 }, faceVisible: 0.95 } as never);
    prismaMock.asset.findFirst.mockResolvedValue({ name: 'palco.jpg' } as never);
    prismaMock.slide.update.mockResolvedValue({} as never);
    prismaMock.post.update.mockResolvedValue({} as never);
  });

  it('coloca a foto, enquadra pelo assunto e guarda a versão ANTES de gravar', async () => {
    prismaMock.post.findFirst.mockResolvedValue(post() as never);
    const out = await applySlidePhoto({ postId: 'post-1', index: 0, slot: '1', assetUrl: PHOTO, userId: 'u1', source: 'AI' });

    expect(out.framing).toEqual({ mode: 'auto', faceVisible: 0.95 });
    expect(out.slots[0]).toMatchObject({ slot: '1', hasPhoto: true, src: PHOTO });
    expect(savedHtml()).toContain(PHOTO);
    expect(snapshotPost).toHaveBeenCalledWith('post-1', { source: 'AI', label: 'Antes de trocar a foto do slide 1', userId: 'u1' });
    expect(vi.mocked(snapshotPost).mock.invocationCallOrder[0]!).toBeLessThan(prismaMock.slide.update.mock.invocationCallOrder[0]!);
  });

  it('só aceita foto da biblioteca DA MARCA do post por padrão', async () => {
    prismaMock.post.findFirst.mockResolvedValue(post() as never);
    await applySlidePhoto({ postId: 'post-1', index: 0, slot: '1', assetUrl: PHOTO, source: 'EDITOR' });
    const where = (prismaMock.asset.findFirst.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where).toEqual({ brandId: 'b1', url: PHOTO, fileType: { startsWith: 'image/' } });
  });

  it('com allowedBrandIds (MCP/collab) aceita também a biblioteca do projeto-base', async () => {
    prismaMock.post.findFirst.mockResolvedValue(post() as never);
    await applySlidePhoto({ postId: 'post-1', index: 0, slot: '1', assetUrl: PHOTO, source: 'AI', allowedBrandIds: ['b1', 'base'] });
    const where = (prismaMock.asset.findFirst.mock.calls[0]![0] as { where: { brandId: unknown } }).where;
    expect(where.brandId).toEqual({ in: ['b1', 'base'] });
  });

  it('URL fora da biblioteca: 400 e nada é gravado (anti-SSRF)', async () => {
    prismaMock.post.findFirst.mockResolvedValue(post() as never);
    prismaMock.asset.findFirst.mockResolvedValue(null as never);
    await expect(applySlidePhoto({ postId: 'post-1', index: 0, slot: '1', assetUrl: 'http://169.254.169.254/x.jpg', source: 'AI' })).rejects.toMatchObject({ statusCode: 400 });
    expect(snapshotPost).not.toHaveBeenCalled();
    expect(prismaMock.slide.update).not.toHaveBeenCalled();
  });

  it('sem detecção de assunto cai no centro', async () => {
    prismaMock.post.findFirst.mockResolvedValue(post() as never);
    vi.mocked(frameFromAnalysis).mockReturnValue(null as never);
    const out = await applySlidePhoto({ postId: 'post-1', index: 0, slot: '1', assetUrl: PHOTO, source: 'AI' });
    expect(out.framing).toEqual({ mode: 'center' });
  });

  it('posição informada manda: não analisa a foto', async () => {
    prismaMock.post.findFirst.mockResolvedValue(post() as never);
    const out = await applySlidePhoto({ postId: 'post-1', index: 0, slot: '1', assetUrl: PHOTO, position: { x: 10, y: 90 }, source: 'AI' });
    expect(out.framing).toEqual({ mode: 'manual' });
    expect(frameFromAnalysis).not.toHaveBeenCalled();
    expect(out.slots[0]!.position).toEqual({ x: 10, y: 90 });
  });

  it('a mesma foto reenviada mantém o enquadramento que já tinha', async () => {
    const withPhoto = `<div data-photo-slot="1"><img src="${PHOTO}" style="object-fit:cover;object-position:25% 75%"></div>`;
    prismaMock.post.findFirst.mockResolvedValue(post(withPhoto) as never);
    const out = await applySlidePhoto({ postId: 'post-1', index: 0, slot: '1', assetUrl: PHOTO, source: 'AI' });
    expect(out.framing).toEqual({ mode: 'kept' });
    expect(out.slots[0]!.position).toEqual({ x: 25, y: 75 });
    expect(frameFromAnalysis).not.toHaveBeenCalled();
  });

  it('assetUrl null esvazia o espaço e o rótulo da versão diz isso', async () => {
    const withPhoto = `<div data-photo-slot="1"><img src="${PHOTO}"></div>`;
    prismaMock.post.findFirst.mockResolvedValue(post(withPhoto) as never);
    const out = await applySlidePhoto({ postId: 'post-1', index: 0, slot: '1', assetUrl: null, source: 'AI' });
    expect(out.slots[0]).toMatchObject({ slot: '1', hasPhoto: false });
    expect(savedHtml()).not.toContain(PHOTO);
    expect(vi.mocked(snapshotPost).mock.calls[0]![1].label).toBe('Antes de remover a foto do slide 1');
    expect(prismaMock.asset.findFirst).not.toHaveBeenCalled();
  });

  it('reenquadrar sem foto no espaço: 400', async () => {
    prismaMock.post.findFirst.mockResolvedValue(post() as never);
    await expect(applySlidePhoto({ postId: 'post-1', index: 0, slot: '1', position: { x: 1, y: 1 }, source: 'AI' })).rejects.toMatchObject({ statusCode: 400 });
    expect(prismaMock.slide.update).not.toHaveBeenCalled();
  });

  it('reenquadrar a foto que já está: troca só posição e ajuste', async () => {
    const withPhoto = `<div data-photo-slot="1"><img src="${PHOTO}" style="object-fit:cover"></div>`;
    prismaMock.post.findFirst.mockResolvedValue(post(withPhoto) as never);
    const out = await applySlidePhoto({ postId: 'post-1', index: 0, slot: '1', position: { x: 60, y: 30 }, fit: 'contain', source: 'AI' });
    expect(out.slots[0]).toMatchObject({ src: PHOTO, position: { x: 60, y: 30 }, fit: 'contain' });
    expect(prismaMock.asset.findFirst).not.toHaveBeenCalled();
  });

  it('espaço que não existe no slide: 404', async () => {
    prismaMock.post.findFirst.mockResolvedValue(post() as never);
    await expect(applySlidePhoto({ postId: 'post-1', index: 0, slot: '9', assetUrl: OTHER, source: 'AI' })).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.slide.update).not.toHaveBeenCalled();
  });

  it.each([
    ['slide fora do limite', { index: 3 }, 400],
    ['post inexistente', { __missing: true }, 404],
  ])('%s', async (_nome, over, status) => {
    const { __missing, ...rest } = over as { __missing?: boolean; index?: number };
    prismaMock.post.findFirst.mockResolvedValue((__missing ? null : post()) as never);
    await expect(applySlidePhoto({ postId: 'post-1', index: 0, slot: '1', assetUrl: PHOTO, source: 'AI', ...rest })).rejects.toMatchObject({ statusCode: status });
  });

  it('só html-design: imagem avulsa é recusada', async () => {
    prismaMock.post.findFirst.mockResolvedValue(post(undefined, { content: { kind: 'image', url: 'https://x/y.png' } }) as never);
    await expect(applySlidePhoto({ postId: 'post-1', index: 0, slot: '1', assetUrl: PHOTO, source: 'AI' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('sanitiza o HTML novo antes de gravar', async () => {
    prismaMock.post.findFirst.mockResolvedValue(post('<div data-photo-slot="1"></div><script>alert(1)</script>') as never);
    await applySlidePhoto({ postId: 'post-1', index: 0, slot: '1', assetUrl: PHOTO, source: 'AI' });
    expect(savedHtml()).not.toMatch(/<script/i);
  });
});
