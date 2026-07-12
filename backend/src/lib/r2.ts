import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import { config } from '../config.js';
import { createError } from '../middleware/errorHandler.js';

const s3 = new S3Client({
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
 * Uploads a PNG Buffer to Cloudflare R2 and returns its public URL.
 */
export async function uploadPngToR2(buffer: Buffer): Promise<string> {
  assertR2Configured();

  const key = `renders/${crypto.randomUUID()}.png`;

  await s3.send(
    new PutObjectCommand({
      Bucket: config.r2BucketName,
      Key: key,
      Body: buffer,
      ContentType: 'image/png',
    })
  );

  return `${config.r2PublicUrl}/${key}`;
}
