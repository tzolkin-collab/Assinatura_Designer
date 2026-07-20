import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from './client';

// O chromium é caro e não é o que estamos testando aqui.
vi.mock('../lib/htmlRaster', () => ({
  renderHtmlToPng: vi.fn(async () => Buffer.from('png-falso')),
}));

vi.mock('../lib/canvaClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/canvaClient')>();
  return {
    ...actual,
    uploadAsset: vi.fn(),
    uploadAssetAndWait: vi.fn(),
    createDesign: vi.fn(),
    createDesignMerge: vi.fn(),
    parseDesignResponse: (raw: unknown) => {
      const d = (raw ?? {}) as { id?: string; design?: { id?: string; urls?: { edit_url?: string } } };
      const design = d.design ?? d;
      return { id: (design as { id?: string }).id!, url: (design as { urls?: { edit_url?: string } }).urls?.edit_url };
    },
  };
});

import { runCanvaExport } from '../lib/canvaExport';
import { renderHtmlToPng } from '../lib/htmlRaster';
import { uploadAssetAndWait, createDesign, createDesignMerge, CanvaSessionExpiredError } from '../lib/canvaClient';

const deckDe = (n: number) => ({
  kind: 'ir-design',
  version: 1,
  width: 1080,
  height: 1080,
  fonts: ['Inter'],
  ir: {
    width: 1080,
    height: 1080,
    fonts: ['Inter'],
    slides: Array.from({ length: n }, (_, i) => ({
      id: `s${i}`,
      background: { type: 'solid', color: '#fff' },
      elements: [],
    })),
  },
});

// A tabela relacional `slides` é a fonte de verdade: mergeSlidesIntoPost reescreve
// content.ir.slides a partir dela. Um fixture com `slides: []` produz um deck vazio.
const postCom = (n: number) => ({
  id: 'post-1',
  name: 'Deck de Teste',
  content: deckDe(n),
  slides: Array.from({ length: n }, (_, i) => ({
    id: `row-${i}`,
    position: i,
    contentJson: { id: `s${i}`, background: { type: 'solid', color: '#fff' }, elements: [] },
  })),
});

describe('Export para o Canva (job da fila)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Canva é a conta do designer que pediu: o export lê o token do próprio usuário.
    prismaMock.user.findUnique.mockResolvedValue({ canvaAccessToken: 'token-valido' });
    (uploadAssetAndWait as ReturnType<typeof vi.fn>).mockImplementation(async () => 'asset-x');
    (createDesign as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ design: { id: 'design-x' } }));
  });

  it('entrega o deck como UM design multipágina (merge), não PNGs soltos', async () => {
    prismaMock.post.findUnique.mockResolvedValue(postCom(3));
    (createDesign as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ design: { id: 'd1' } })
      .mockResolvedValueOnce({ design: { id: 'd2' } })
      .mockResolvedValueOnce({ design: { id: 'd3' } });
    (createDesignMerge as ReturnType<typeof vi.fn>).mockResolvedValue({
      design: { id: 'deck-final', urls: { edit_url: 'https://canva.com/deck-final' } },
    });

    const res = await runCanvaExport({ postId: 'post-1', userId: 'u1' });

    expect(res.designId).toBe('deck-final');
    expect(res.designUrl).toBe('https://canva.com/deck-final');
    expect(res.slides).toBe(3);
    expect(res.mergeFallback).toBeUndefined();

    // As páginas entram na ORDEM dos slides — um merge fora de ordem embaralha o deck.
    expect(createDesignMerge).toHaveBeenCalledWith('u1', ['d1', 'd2', 'd3'], 'Deck de Teste');
  });

  it('espera o job de upload antes de criar o design (o asset_id só existe depois)', async () => {
    prismaMock.post.findUnique.mockResolvedValue(postCom(1));

    const ordem: string[] = [];
    (uploadAssetAndWait as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      ordem.push('upload');
      return 'asset-1';
    });
    (createDesign as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      ordem.push('createDesign');
      return { design: { id: 'd1' } };
    });

    await runCanvaExport({ postId: 'post-1', userId: 'u1' });

    expect(ordem).toEqual(['upload', 'createDesign']);
    expect(createDesign).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ asset_id: 'asset-1' }),
    );
  });

  it('slide único não passa pelo merge', async () => {
    prismaMock.post.findUnique.mockResolvedValue(postCom(5));

    const res = await runCanvaExport({ postId: 'post-1', userId: 'u1', slideIndex: 2 });

    expect(res.slides).toBe(1);
    expect(renderHtmlToPng).toHaveBeenCalledTimes(1);
    expect(createDesignMerge).not.toHaveBeenCalled();
  });

  it('se o merge falhar, ENTREGA os designs por slide em vez de perder o trabalho', async () => {
    prismaMock.post.findUnique.mockResolvedValue(postCom(2));
    (createDesign as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ design: { id: 'd1' } })
      .mockResolvedValueOnce({ design: { id: 'd2' } });
    (createDesignMerge as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('merge indisponível'));

    const res = await runCanvaExport({ postId: 'post-1', userId: 'u1' });

    expect(res.mergeFallback).toBe(true);
    expect(res.designIds).toEqual(['d1', 'd2']);
    expect(res.slides).toBe(2);
  });

  it('reporta progresso slide a slide', async () => {
    prismaMock.post.findUnique.mockResolvedValue(postCom(3));
    (createDesignMerge as ReturnType<typeof vi.fn>).mockResolvedValue({ design: { id: 'deck' } });

    const progresso: Array<[number, number]> = [];
    await runCanvaExport({ postId: 'post-1', userId: 'u1' }, (done, total) => {
      progresso.push([done, total]);
    });

    expect(progresso).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('recusa usuário sem Canva conectado antes de renderizar', async () => {
    prismaMock.post.findUnique.mockResolvedValue(postCom(2));
    prismaMock.user.findUnique.mockResolvedValue({ canvaAccessToken: null });

    await expect(runCanvaExport({ postId: 'post-1', userId: 'u1' })).rejects.toThrow(/não conectado/i);
    expect(renderHtmlToPng).not.toHaveBeenCalled();
  });

  it('recusa slideIndex fora do limite', async () => {
    prismaMock.post.findUnique.mockResolvedValue(postCom(2));
    await expect(
      runCanvaExport({ postId: 'post-1', userId: 'u1', slideIndex: 9 }),
    ).rejects.toThrow(/limite/i);
  });

  it('não faz fallback quando o merge falha por sessão expirada', async () => {
    prismaMock.post.findUnique.mockResolvedValue(postCom(2));
    (createDesign as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ design: { id: 'd1' } })
      .mockResolvedValueOnce({ design: { id: 'd2' } });
    (createDesignMerge as ReturnType<typeof vi.fn>).mockRejectedValue(new CanvaSessionExpiredError());

    await expect(runCanvaExport({ postId: 'post-1', userId: 'u1' })).rejects.toThrow(CanvaSessionExpiredError);
  });
});
