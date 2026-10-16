import sharp from 'sharp';
import type { Asset } from '@prisma/client';
import prisma from './prisma.js';
import { uploadFileToR2 } from './r2.js';
import { prepareStorableFile } from './svgSanitize.js';

/**
 * Guarda um arquivo na biblioteca da marca: higieniza (SVG), mede, sobe para o R2 e grava o `Asset`.
 * Compartilhada pelo upload da tela de mídia (`POST /brands/:slug/assets`, `import-base64`) e pela
 * ferramenta MCP `upload_asset`, para o arquivo passar pela MESMA higienização nos dois caminhos.
 *
 * Autorização e limite de taxa são de quem chama.
 */
export interface StoreBrandAssetInput {
  brandId: string;
  userId: string;
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  /** Origem do arquivo (`upload`, `drive`, `asana`...). Sem valor, vale o padrão do banco. */
  source?: string;
  tags?: string[];
}

export async function storeBrandAsset(input: StoreBrandAssetInput): Promise<Asset> {
  // O Content-Type que o cliente declara não manda: SVG é higienizado e sai como image/svg+xml mesmo se
  // veio como text/html; HTML de verdade vira download. SVG inválido lança InvalidSvgError.
  const prepared = await prepareStorableFile({ buffer: input.buffer, fileName: input.fileName, mimeType: input.mimeType });

  // Dimensões: sem elas o editor não sabe a proporção e insere a imagem esticada num quadrado.
  // Falha de leitura não impede o upload (pode ser SVG/fonte).
  let width: number | undefined;
  let height: number | undefined;
  if (prepared.mimeType.startsWith('image/')) {
    try {
      const meta = await sharp(prepared.buffer).metadata();
      width = meta.width;
      height = meta.height;
    } catch {
      // segue sem dimensões
    }
  }

  const url = await uploadFileToR2(prepared.buffer, input.fileName, prepared.mimeType, `brands/${input.brandId}`);

  return prisma.asset.create({
    data: {
      brandId: input.brandId,
      uploadedBy: input.userId,
      name: input.fileName,
      url,
      fileType: prepared.mimeType,
      sizeBytes: prepared.buffer.length,
      width,
      height,
      ...(input.source ? { source: input.source } : {}),
      ...(input.tags ? { tags: input.tags } : {}),
    },
  });
}
