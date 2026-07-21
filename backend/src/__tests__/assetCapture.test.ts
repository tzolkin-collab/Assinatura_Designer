import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from './client';

vi.mock('../lib/htmlRaster', () => ({
  renderHtmlToPng: vi.fn(async () => Buffer.from('png-falso')),
}));

vi.mock('../lib/r2', () => ({
  uploadFileToR2: vi.fn(async () => 'https://r2.example.com/brands/brand-1/generated/slide.png'),
}));

import { runAssetCapture } from '../lib/assetCapture';
import { renderHtmlToPng } from '../lib/htmlRaster';
import { uploadFileToR2 } from '../lib/r2';

const deckDe = (n: number) => ({
  kind: 'html-design',
  version: 1,
  width: 1080,
  height: 1080,
  fonts: ['Inter'],
  slides: Array.from({ length: n }, (_, i) => ({ html: `<div>Slide ${i}</div>`, css: '' })),
});

const postCom = (n: number) => ({
  id: 'post-1',
  name: 'Deck de Teste',
  brandId: 'brand-1',
  createdById: 'u1',
  content: deckDe(n),
  slides: Array.from({ length: n }, (_, i) => ({
    id: `row-${i}`,
    position: i,
    contentJson: { html: `<div>Slide ${i}</div>`, css: '' },
  })),
});

describe('Captura automática de slides gerados como assets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renderiza cada slide, sobe no R2 e cria um Asset com source ai-generated', async () => {
    prismaMock.post.findUnique.mockResolvedValue(postCom(3));
    (prismaMock.asset.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'a1' });

    const res = await runAssetCapture({ postId: 'post-1' });

    expect(res.captured).toBe(3);
    expect(renderHtmlToPng).toHaveBeenCalledTimes(3);
    expect(uploadFileToR2).toHaveBeenCalledTimes(3);
    expect(prismaMock.asset.create).toHaveBeenCalledTimes(3);
    expect(prismaMock.asset.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        brandId: 'brand-1',
        postId: 'post-1',
        source: 'ai-generated',
        fileType: 'image/png',
        tags: expect.arrayContaining(['ai-generated']),
      }),
    }));
  });

  it('post inexistente não captura nada (sem lançar erro)', async () => {
    prismaMock.post.findUnique.mockResolvedValue(null);

    const res = await runAssetCapture({ postId: 'post-x' });

    expect(res.captured).toBe(0);
    expect(renderHtmlToPng).not.toHaveBeenCalled();
  });

  it('deck sem slides não captura nada', async () => {
    prismaMock.post.findUnique.mockResolvedValue(postCom(0));

    const res = await runAssetCapture({ postId: 'post-1' });

    expect(res.captured).toBe(0);
  });

  it('falha ao renderizar um slide não impede os demais (best-effort)', async () => {
    prismaMock.post.findUnique.mockResolvedValue(postCom(3));
    (prismaMock.asset.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'a1' });
    (renderHtmlToPng as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(Buffer.from('ok1'))
      .mockRejectedValueOnce(new Error('chromium morreu'))
      .mockResolvedValueOnce(Buffer.from('ok3'));

    const res = await runAssetCapture({ postId: 'post-1' });

    expect(res.captured).toBe(2);
  });
});
