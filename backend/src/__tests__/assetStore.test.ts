// storeBrandAsset: higieniza, mede, sobe e grava — compartilhada pelo upload da tela de mídia e pelo MCP (upload_asset).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { prismaMock } from './client';
import { storeBrandAsset } from '../lib/assetStore';

vi.mock('../lib/r2', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/r2')>()),
  uploadFileToR2: vi.fn(async (_buf: Buffer, name: string, _mime: string, folder: string) => `https://cdn.example.test/${folder}/${name}`),
}));
import { uploadFileToR2 } from '../lib/r2';

vi.mock('../lib/svgSanitize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/svgSanitize')>();
  return { ...actual, prepareStorableFile: vi.fn(actual.prepareStorableFile) };
});
import { prepareStorableFile } from '../lib/svgSanitize';

async function png(width = 6, height = 4): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#ff0000' } }).png().toBuffer();
}

describe('storeBrandAsset', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(uploadFileToR2).mockImplementation(async (_b: Buffer, name: string, _m: string, folder = 'assets') => `https://cdn.example.test/${folder}/${name}`);
    prismaMock.asset.create.mockImplementation((async (args: { data: Record<string, unknown> }) => ({ id: 'asset-1', ...args.data })) as never);
  });

  it('sobe na pasta da marca, mede a imagem e grava o Asset', async () => {
    const buffer = await png(6, 4);
    const asset = await storeBrandAsset({ brandId: 'b1', userId: 'u1', buffer, fileName: 'foto.png', mimeType: 'image/png' });

    expect(uploadFileToR2).toHaveBeenCalledWith(expect.any(Buffer), 'foto.png', 'image/png', 'brands/b1');
    const data = (prismaMock.asset.create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ brandId: 'b1', uploadedBy: 'u1', name: 'foto.png', fileType: 'image/png', width: 6, height: 4, sizeBytes: buffer.length });
    expect(asset).toMatchObject({ id: 'asset-1', url: 'https://cdn.example.test/brands/b1/foto.png' });
  });

  it('sem source/tags não os envia (valem os padrões do banco, como a rota de upload sempre fez)', async () => {
    await storeBrandAsset({ brandId: 'b1', userId: 'u1', buffer: await png(), fileName: 'a.png', mimeType: 'image/png' });
    const data = (prismaMock.asset.create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty('source');
    expect(data).not.toHaveProperty('tags');
  });

  it('com source e tags (importação) grava os dois', async () => {
    await storeBrandAsset({ brandId: 'b1', userId: 'u1', buffer: await png(), fileName: 'a.png', mimeType: 'image/png', source: 'drive', tags: ['drive'] });
    const data = (prismaMock.asset.create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ source: 'drive', tags: ['drive'] });
  });

  it('sobe o que a higienização devolveu (não o que o cliente mandou) e com o tipo dela', async () => {
    // A higienização de SVG roda num pool de workers e tem teste próprio (svgSanitize / svgWritePoints); aqui vale a
    // ligação: o buffer e o tipo que vão para o R2 e para o banco são os do resultado dela.
    vi.mocked(prepareStorableFile).mockResolvedValueOnce({ buffer: Buffer.from('<svg>LIMPO</svg>'), mimeType: 'image/svg+xml', removed: ['script'] } as never);
    await storeBrandAsset({ brandId: 'b1', userId: 'u1', buffer: Buffer.from('<svg><script>x</script></svg>'), fileName: 'logo.svg', mimeType: 'text/html' });

    const [sentBuffer, , sentMime] = vi.mocked(uploadFileToR2).mock.calls[0]!;
    expect(sentBuffer.toString()).toBe('<svg>LIMPO</svg>');
    expect(sentMime).toBe('image/svg+xml'); // o tipo declarado não manda
    const data = (prismaMock.asset.create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ fileType: 'image/svg+xml', sizeBytes: '<svg>LIMPO</svg>'.length });
  });

  it('SVG inválido na higienização não sobe nada', async () => {
    const { InvalidSvgError } = await import('../lib/svgSanitize');
    vi.mocked(prepareStorableFile).mockRejectedValueOnce(new InvalidSvgError('malformado'));
    await expect(storeBrandAsset({ brandId: 'b1', userId: 'u1', buffer: Buffer.from('<svg'), fileName: 'x.svg', mimeType: 'image/svg+xml' })).rejects.toBeInstanceOf(InvalidSvgError);
    expect(uploadFileToR2).not.toHaveBeenCalled();
    expect(prismaMock.asset.create).not.toHaveBeenCalled();
  });

  it('arquivo que não é imagem sobe sem dimensões (não derruba o upload)', async () => {
    await storeBrandAsset({ brandId: 'b1', userId: 'u1', buffer: Buffer.from('dados'), fileName: 'f.bin', mimeType: 'application/octet-stream' });
    const data = (prismaMock.asset.create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.width).toBeUndefined();
    expect(data.height).toBeUndefined();
  });

  it('falha no R2 não grava o Asset', async () => {
    vi.mocked(uploadFileToR2).mockRejectedValueOnce(new Error('R2 fora'));
    await expect(storeBrandAsset({ brandId: 'b1', userId: 'u1', buffer: await png(), fileName: 'a.png', mimeType: 'image/png' })).rejects.toThrow('R2 fora');
    expect(prismaMock.asset.create).not.toHaveBeenCalled();
  });
});
