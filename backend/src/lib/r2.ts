import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import { config } from '../config.js';
import { createError } from '../middleware/errorHandler.js';
import { prepareStorableFile } from './svgSanitize.js';

export const s3 = new S3Client({
  region: 'auto',
  endpoint: config.r2Endpoint,
  credentials: {
    accessKeyId: config.r2AccessKeyId,
    secretAccessKey: config.r2SecretAccessKey,
  },
});

export function assertR2Configured(): void {
  const missing = [
    ['R2_ENDPOINT', config.r2Endpoint],
    ['R2_ACCESS_KEY_ID', config.r2AccessKeyId],
    ['R2_SECRET_ACCESS_KEY', config.r2SecretAccessKey],
    ['R2_BUCKET_NAME', config.r2BucketName],
    ['R2_PUBLIC_URL', config.r2PublicUrl],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw createError(503, `Upload indisponível: configuração R2 incompleta (${missing.join(', ')})`);
  }
}

/**
 * Uploads a file Buffer to Cloudflare R2 and returns its public URL.
 *
 * Toda gravação passa por prepareStorableFile: o bucket é público, então um SVG (ou
 * HTML) servido com o Content-Type errado é XSS armazenado a um clique de distância.
 * As rotas já higienizam antes (para devolver 400 com contexto); esta é a rede de
 * segurança de quem esquecer — e é quem garante que o Content-Type não vem do cliente.
 * Lança InvalidSvgError se algo que se apresenta como SVG não for um.
 */
export async function uploadFileToR2(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  folder: string = 'assets'
): Promise<string> {
  assertR2Configured();

  const prepared = await prepareStorableFile({ buffer, fileName, mimeType });

  // Garante um nome de arquivo único para não sobrescrever
  const uniqueId = crypto.randomUUID();
  const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const key = `${folder}/${uniqueId}-${safeName}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: config.r2BucketName,
      Key: key,
      Body: prepared.buffer,
      ContentType: prepared.mimeType,
      ...(prepared.contentDisposition ? { ContentDisposition: prepared.contentDisposition } : {}),
    })
  );

  return `${config.r2PublicUrl}/${key}`;
}

export async function uploadPngToR2(buffer: Buffer): Promise<string> {
  return uploadFileToR2(buffer, 'render.png', 'image/png', 'renders');
}

/**
 * Extrai a key do objeto a partir da URL pública. Guardar a key numa coluna seria
 * mais direto, mas os assets já gravados só têm a URL — derivar aqui evita uma
 * migração e mantém os antigos apagáveis.
 * Devolve null se a URL não pertence ao nosso bucket (não apagamos o que não é nosso).
 */
export function r2KeyFromUrl(url: string): string | null {
  const base = config.r2PublicUrl?.replace(/\/$/, '');
  if (!base || !url.startsWith(`${base}/`)) return null;

  const key = url.slice(base.length + 1).split('?')[0];
  return key ? decodeURIComponent(key) : null;
}

/** Apaga o objeto no R2. Não lança se a URL for externa — só não faz nada. */
export async function deleteFromR2(url: string): Promise<boolean> {
  assertR2Configured();

  const key = r2KeyFromUrl(url);
  if (!key) return false;

  await s3.send(new DeleteObjectCommand({ Bucket: config.r2BucketName, Key: key }));
  return true;
}
