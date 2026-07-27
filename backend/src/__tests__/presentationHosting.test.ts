import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from './client';
import { publishPost, unpublishPost } from '../lib/presentationHosting';

describe('publishPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('post inexistente: lança 404 sem tentar gerar slug', async () => {
    prismaMock.post.findUnique.mockResolvedValue(null);
    await expect(publishPost('post-x', {})).rejects.toThrow(/não encontrado/i);
    expect(prismaMock.post.update).not.toHaveBeenCalled();
  });

  it('publica com sucesso: gera slug, marca publishedAt e grava hostingConfig', async () => {
    prismaMock.post.findUnique.mockResolvedValue({ id: 'post-1' });
    prismaMock.post.update.mockResolvedValue({
      publicSlug: 'abc123',
      publishedAt: new Date('2026-07-22T12:00:00Z'),
    });

    const result = await publishPost('post-1', { autoplay: true });

    expect(result.publicSlug).toBe('abc123');
    expect(result.publishedAt).toEqual(new Date('2026-07-22T12:00:00Z'));
    expect(prismaMock.post.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'post-1' },
      data: expect.objectContaining({ hostingConfig: { autoplay: true } }),
    }));
  });

  it('colisão de slug (P2002): tenta de novo com outro slug em vez de falhar', async () => {
    prismaMock.post.findUnique.mockResolvedValue({ id: 'post-1' });
    prismaMock.post.update
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValueOnce({ publicSlug: 'novo-slug', publishedAt: new Date() });

    const result = await publishPost('post-1', {});

    expect(result.publicSlug).toBe('novo-slug');
    expect(prismaMock.post.update).toHaveBeenCalledTimes(2);
  });

  it('erro que não é colisão de slug propaga imediatamente, sem retry', async () => {
    prismaMock.post.findUnique.mockResolvedValue({ id: 'post-1' });
    prismaMock.post.update.mockRejectedValue(new Error('banco fora do ar'));

    await expect(publishPost('post-1', {})).rejects.toThrow('banco fora do ar');
    expect(prismaMock.post.update).toHaveBeenCalledTimes(1);
  });
});

describe('unpublishPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('post inexistente: lança 404', async () => {
    prismaMock.post.findUnique.mockResolvedValue(null);
    await expect(unpublishPost('post-x')).rejects.toThrow(/não encontrado/i);
    expect(prismaMock.post.update).not.toHaveBeenCalled();
  });

  it('limpa publicSlug e publishedAt, mantém hostingConfig intacto', async () => {
    prismaMock.post.findUnique.mockResolvedValue({ id: 'post-1' });
    prismaMock.post.update.mockResolvedValue({});

    await unpublishPost('post-1');

    expect(prismaMock.post.update).toHaveBeenCalledWith({
      where: { id: 'post-1' },
      data: { publicSlug: null, publishedAt: null },
    });
  });
});
