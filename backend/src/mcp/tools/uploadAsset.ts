import sharp from 'sharp';
import { z } from 'zod';
import { storeBrandAsset } from '../../lib/assetStore.js';
import { InvalidSvgError } from '../../lib/svgSanitize.js';
import { SVG_SANITIZE_RATE_LIMIT } from '../../lib/svgSanitizeRateLimit.js';
import { consumeRateLimit } from '../../middleware/rateLimit.js';
import { WRITE_SCOPE } from '../config.js';
import { ToolUserError, type McpToolDefinition } from './types.js';

/** Mesmo teto da tela de mídia (`multer` em routes/assets.ts). */
const MAX_BYTES = 10 * 1024 * 1024;
/** base64 ocupa 4/3 do binário; folga para quebras de linha. */
const MAX_BASE64_CHARS = Math.ceil((MAX_BYTES * 4) / 3) + 1024;

const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml'] as const;

const inputSchema = {
  brandSlug: z.string().trim().min(1).max(100).describe('Slug da marca, de list_brands.'),
  fileName: z.string().trim().min(1).max(120).describe('Nome do arquivo com extensão (ex.: "palco-2026.jpg").'),
  mimeType: z.enum(ALLOWED_MIME).describe('Tipo da imagem. SVG é higienizado no servidor (scripts e referências externas saem).'),
  dataBase64: z
    .string()
    .min(1)
    .max(MAX_BASE64_CHARS)
    .describe('Conteúdo do arquivo em base64 (sem o prefixo "data:"). Até 10 MB depois de decodificado.'),
  tags: z.array(z.string().trim().min(1).max(40)).max(8).optional().describe('Etiquetas (ex.: "foto", "palco", "retrato").'),
};

const outputSchema = {
  assetId: z.string(),
  name: z.string(),
  url: z.string(),
  fileType: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  sizeBytes: z.number(),
};

/** Nome seguro: sem caminho nem caracteres de controle, com o tamanho que o banco aceita. */
function safeName(raw: string): string {
  const base = raw.replace(/\\/g, '/').split('/').pop() ?? raw;
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || 'arquivo';
}

export const uploadAssetTool: McpToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: 'upload_asset',
  title: 'Enviar um arquivo para a biblioteca',
  description:
    'Guarda uma imagem REAL na biblioteca da marca (foto, logo, elemento gráfico) a partir do conteúdo em base64 e devolve a URL para ' +
    'usar num slide (set_slide_photo ou <img> no HTML). Só imagens, até 10 MB. Envie apenas arquivos que o usuário forneceu: ' +
    'nunca imagem gerada por IA nem de banco de imagens, e nunca foto de uma pessoa que não foi entregue.',
  scope: WRITE_SCOPE,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  inputSchema,
  outputSchema,
  brandArg: 'brandSlug',

  async handler(ctx, args) {
    // O mesmo orçamento por conta das rotas HTTP que higienizam SVG: o pool de workers é do processo inteiro e
    // entrar por outra porta não pode furá-lo.
    const limit = await consumeRateLimit(SVG_SANITIZE_RATE_LIMIT, ctx.userId);
    if (!limit.allowed) {
      throw new ToolUserError(`Muitos envios seguidos. Tente de novo em ${limit.retryAfterSec} s.`, 'rate_limited');
    }

    const payload = args.dataBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
      throw new ToolUserError('dataBase64 não é base64 válido.', 'invalid_base64');
    }
    const buffer = Buffer.from(payload, 'base64');
    if (buffer.length === 0) throw new ToolUserError('O arquivo está vazio.', 'empty_file');
    if (buffer.length > MAX_BYTES) throw new ToolUserError('O arquivo passa de 10 MB.', 'file_too_large');

    // O tipo declarado não vale sozinho: imagem raster precisa ser lida como imagem de verdade.
    // (SVG tem validação própria na higienização.)
    if (args.mimeType !== 'image/svg+xml') {
      try {
        await sharp(buffer).metadata();
      } catch {
        throw new ToolUserError('O conteúdo não é uma imagem válida do tipo informado.', 'invalid_image');
      }
    }

    let asset;
    try {
      asset = await storeBrandAsset({
        brandId: ctx.brand!.id,
        userId: ctx.userId,
        buffer,
        fileName: safeName(args.fileName),
        mimeType: args.mimeType,
        source: 'upload',
        tags: args.tags ?? [],
      });
    } catch (err) {
      if (err instanceof InvalidSvgError) throw new ToolUserError(`SVG inválido: ${err.message}`, 'invalid_svg');
      throw err;
    }

    const structured = {
      assetId: asset.id,
      name: asset.name,
      url: asset.url,
      fileType: asset.fileType,
      width: asset.width ?? null,
      height: asset.height ?? null,
      sizeBytes: asset.sizeBytes,
    };
    const text = `Arquivo guardado: ${asset.name} (${asset.width && asset.height ? `${asset.width}x${asset.height}, ` : ''}${asset.sizeBytes} bytes).\nURL: ${asset.url}`;
    return { text, structured };
  },
};
