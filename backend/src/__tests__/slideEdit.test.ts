// applySlideCode: a porta de escrita do código de UM slide, compartilhada pelo editor e pelo MCP (update_slide).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock } from './client';
import { applySlideCode } from '../lib/slideEdit';

vi.mock('../lib/postVersions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/postVersions')>()),
  snapshotPost: vi.fn(async () => ({ id: 'v1' })),
}));
import { snapshotPost } from '../lib/postVersions';

const htmlPost = (over: Record<string, unknown> = {}) => ({
  id: 'post-1',
  content: { kind: 'html-design', width: 1920, height: 1080, fonts: ['Inter'], version: 1 },
  slides: [
    { id: 's0', position: 0, contentJson: { html: '<h1>A</h1>' }, metadata: null },
    { id: 's1', position: 1, contentJson: { html: '<h1>B</h1>' }, metadata: null },
  ],
  ...over,
});

describe('applySlideCode', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(snapshotPost).mockResolvedValue({ id: 'v1' } as never);
    prismaMock.slide.update.mockResolvedValue({} as never);
    prismaMock.post.update.mockResolvedValue({} as never);
  });

  it('guarda a versão ANTES de gravar e grava só o slide pedido', async () => {
    prismaMock.post.findFirst.mockResolvedValue(htmlPost() as never);
    const out = await applySlideCode({ postId: 'post-1', index: 1, html: '<h1>Novo</h1>', css: '.s2-a{color:red}', userId: 'u1', source: 'AI', label: 'Antes do agente' });

    expect(snapshotPost).toHaveBeenCalledWith('post-1', { source: 'AI', label: 'Antes do agente', userId: 'u1' });
    expect(vi.mocked(snapshotPost).mock.invocationCallOrder[0]!).toBeLessThan(prismaMock.slide.update.mock.invocationCallOrder[0]!);
    const call = prismaMock.slide.update.mock.calls[0]![0] as { where: { id: string }; data: { contentJson: { html: string }; htmlRender: string } };
    expect(call.where.id).toBe('s1');
    expect(call.data.contentJson.html).toContain('Novo');
    expect(call.data.htmlRender).toContain('<h1>Novo</h1>');
    expect(out).toMatchObject({ slideIndex: 1, slideCount: 2 });
  });

  it('sanitiza no servidor: script e handler de evento não passam', async () => {
    prismaMock.post.findFirst.mockResolvedValue(htmlPost() as never);
    await applySlideCode({ postId: 'post-1', index: 0, html: '<h1 onclick="x()">Oi</h1><script>alert(1)</script>', source: 'EDITOR' });
    const saved = (prismaMock.slide.update.mock.calls[0]![0] as { data: { contentJson: { html: string } } }).data.contentJson.html;
    expect(saved).toContain('Oi');
    expect(saved).not.toMatch(/<script|onclick/i);
  });

  it.each([
    ['html vazio', { html: '   ' }, 400],
    ['slide fora do limite', { index: 2 }, 400],
    ['índice negativo', { index: -1 }, 400],
  ])('recusa %s antes de gravar', async (_nome, over, status) => {
    prismaMock.post.findFirst.mockResolvedValue(htmlPost() as never);
    await expect(applySlideCode({ postId: 'post-1', index: 0, html: '<p>x</p>', source: 'AI', ...over })).rejects.toMatchObject({ statusCode: status });
    expect(snapshotPost).not.toHaveBeenCalled();
    expect(prismaMock.slide.update).not.toHaveBeenCalled();
  });

  it('só html-design: outros tipos de conteúdo são recusados', async () => {
    prismaMock.post.findFirst.mockResolvedValue(htmlPost({ content: { kind: 'image', url: 'https://x/y.png' } }) as never);
    await expect(applySlideCode({ postId: 'post-1', index: 0, html: '<p>x</p>', source: 'AI' })).rejects.toMatchObject({ statusCode: 400 });
    expect(prismaMock.slide.update).not.toHaveBeenCalled();
  });

  it('post inexistente: 404', async () => {
    prismaMock.post.findFirst.mockResolvedValue(null as never);
    await expect(applySlideCode({ postId: 'nope', index: 0, html: '<p>x</p>', source: 'AI' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('atualiza o updatedAt do post', async () => {
    prismaMock.post.findFirst.mockResolvedValue(htmlPost() as never);
    await applySlideCode({ postId: 'post-1', index: 0, html: '<p>x</p>', source: 'EDITOR' });
    expect(prismaMock.post.update).toHaveBeenCalledWith({ where: { id: 'post-1' }, data: { updatedAt: expect.any(Date) } });
  });
});
