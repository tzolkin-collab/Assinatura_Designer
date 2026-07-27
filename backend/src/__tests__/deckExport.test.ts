import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from './client';

vi.mock('../lib/htmlRaster', () => ({
  renderHtmlToPng: vi.fn(async () => Buffer.from('png-falso')),
  renderHtmlToPdf: vi.fn(async () => Buffer.from('pdf-falso')),
}));

vi.mock('../lib/htmlToPptx', () => ({
  htmlDocsToPptx: vi.fn(async (docs: string[]) => ({
    buffer: Buffer.from('pptx-falso'),
    stats: docs.map((_, i) => ({ slide: i + 1, texts: 1, images: 0, shapes: 0, svgSkipped: 0, gradientApprox: 0 })),
  })),
}));

vi.mock('../lib/r2', () => ({
  uploadFileToR2: vi.fn(async (_buf: Buffer, fileName: string) => `https://r2.example.com/exports/${fileName}`),
}));

vi.mock('pdf-lib', () => ({
  PDFDocument: {
    create: vi.fn(async () => ({
      copyPages: vi.fn(async () => [{}]),
      addPage: vi.fn(),
      save: vi.fn(async () => new Uint8Array(Buffer.from('pdf-final-falso'))),
    })),
    load: vi.fn(async () => ({})),
  },
}));

import { runDeckExport } from '../lib/deckExport';
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
  name: 'Meu Deck',
  content: deckDe(n),
  slides: Array.from({ length: n }, (_, i) => ({
    id: `row-${i}`,
    position: i,
    contentJson: { html: `<div>Slide ${i}</div>`, css: '' },
  })),
});

describe('runDeckExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.post.findUnique.mockResolvedValue(postCom(3));
  });

  it('export zip: sobe com extensão .zip (regressão — vinha nomeado ".png" mas o conteúdo é um arquivo ZIP de verdade)', async () => {
    const res = await runDeckExport({ postId: 'post-1', userId: 'u1', format: 'zip' });

    expect(res.fileName).toMatch(/\.zip$/);
    expect(res.fileName).not.toMatch(/\.png$/);
    expect(uploadFileToR2).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.stringMatching(/\.zip$/),
      'application/zip',
      'exports',
    );
  });

  it('export html: mantém extensão .zip (já estava correto)', async () => {
    const res = await runDeckExport({ postId: 'post-1', userId: 'u1', format: 'html' });
    expect(res.fileName).toMatch(/\.zip$/);
  });

  it('export pdf: extensão .pdf', async () => {
    const res = await runDeckExport({ postId: 'post-1', userId: 'u1', format: 'pdf' });
    expect(res.fileName).toMatch(/\.pdf$/);
  });

  it('export pptx: extensão .pptx', async () => {
    const res = await runDeckExport({ postId: 'post-1', userId: 'u1', format: 'pptx' });
    expect(res.fileName).toMatch(/\.pptx$/);
  });
});
