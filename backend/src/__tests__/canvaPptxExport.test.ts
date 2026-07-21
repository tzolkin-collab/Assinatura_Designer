import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from './client';

vi.mock('../lib/htmlToPptx', () => ({
  htmlDocsToPptx: vi.fn(async (docs: string[]) => ({
    buffer: Buffer.from('pptx-falso'),
    stats: docs.map((_, i) => ({ slide: i + 1, texts: 1, images: 0, shapes: 0, svgSkipped: 0, gradientApprox: 0 })),
  })),
}));

vi.mock('../lib/r2', () => ({
  uploadFileToR2: vi.fn(async () => 'https://r2.example.com/canva-imports/deck.pptx'),
  assertR2Configured: vi.fn(),
}));

vi.mock('../lib/canvaClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/canvaClient')>();
  return {
    ...actual,
    createUrlImportJob: vi.fn(),
    waitForUrlImport: vi.fn(),
  };
});

import { runCanvaPptxExport } from '../lib/canvaExport';
import { htmlDocsToPptx } from '../lib/htmlToPptx';
import { uploadFileToR2, assertR2Configured } from '../lib/r2';
import { createUrlImportJob, waitForUrlImport } from '../lib/canvaClient';

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
  content: deckDe(n),
  slides: Array.from({ length: n }, (_, i) => ({
    id: `row-${i}`,
    position: i,
    contentJson: { html: `<div>Slide ${i}</div>`, css: '' },
  })),
});

describe('Export para o Canva via PPTX (Design Import API)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({ canvaAccessToken: 'token-valido' });
    (createUrlImportJob as ReturnType<typeof vi.fn>).mockResolvedValue({ job: { id: 'import-job-1' } });
    (waitForUrlImport as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'design-x',
      title: 'Deck de Teste',
      urls: { edit_url: 'https://canva.com/design/design-x/edit', view_url: 'https://canva.com/design/design-x/view' },
    });
  });

  it('gera o PPTX, sobe no R2 e importa via url-imports — devolve o edit_url', async () => {
    prismaMock.post.findUnique.mockResolvedValue(postCom(4));

    const res = await runCanvaPptxExport({ postId: 'post-1', userId: 'u1' });

    expect(res.designId).toBe('design-x');
    expect(res.designUrl).toBe('https://canva.com/design/design-x/edit');
    expect(res.slides).toBe(4);

    expect(htmlDocsToPptx).toHaveBeenCalledTimes(1);
    const [docs, width, height, title] = (htmlDocsToPptx as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(docs).toHaveLength(4);
    expect(width).toBe(1080);
    expect(height).toBe(1080);
    expect(title).toBe('Deck de Teste');

    expect(uploadFileToR2).toHaveBeenCalledWith(
      Buffer.from('pptx-falso'),
      'Deck de Teste.pptx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'canva-imports',
    );

    expect(createUrlImportJob).toHaveBeenCalledWith(
      'u1',
      'https://r2.example.com/canva-imports/deck.pptx',
      'Deck de Teste',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(waitForUrlImport).toHaveBeenCalledWith('u1', 'import-job-1');
  });

  it('usa view_url quando o import não devolve edit_url', async () => {
    prismaMock.post.findUnique.mockResolvedValue(postCom(1));
    (waitForUrlImport as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'design-y',
      urls: { view_url: 'https://canva.com/design/design-y/view' },
    });

    const res = await runCanvaPptxExport({ postId: 'post-1', userId: 'u1' });

    expect(res.designUrl).toBe('https://canva.com/design/design-y/view');
  });

  it('recusa usuário sem Canva conectado antes de gerar o PPTX', async () => {
    prismaMock.post.findUnique.mockResolvedValue(postCom(2));
    prismaMock.user.findUnique.mockResolvedValue({ canvaAccessToken: null });

    await expect(runCanvaPptxExport({ postId: 'post-1', userId: 'u1' })).rejects.toThrow(/não conectado/i);
    expect(htmlDocsToPptx).not.toHaveBeenCalled();
  });

  it('falha rápido se o R2 não estiver configurado, antes de gerar o PPTX', async () => {
    prismaMock.post.findUnique.mockResolvedValue(postCom(2));
    (assertR2Configured as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('Upload indisponível: configuração R2 incompleta');
    });

    await expect(runCanvaPptxExport({ postId: 'post-1', userId: 'u1' })).rejects.toThrow(/R2/i);
    expect(htmlDocsToPptx).not.toHaveBeenCalled();
  });

  it('propaga o erro quando o job de import falha', async () => {
    prismaMock.post.findUnique.mockResolvedValue(postCom(2));
    (waitForUrlImport as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Canva URL import falhou: invalid_file'));

    await expect(runCanvaPptxExport({ postId: 'post-1', userId: 'u1' })).rejects.toThrow(/invalid_file/);
  });

  it('recusa post inexistente', async () => {
    prismaMock.post.findUnique.mockResolvedValue(null);

    await expect(runCanvaPptxExport({ postId: 'post-x', userId: 'u1' })).rejects.toThrow(/não encontrado/i);
  });
});
