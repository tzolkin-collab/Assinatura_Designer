import { Router, Response, NextFunction } from 'express';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import { config } from '../config.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest, requireAuth } from '../middleware/auth.js';
import {
  normalizeImage,
  isSupportedMimeType,
  ACCEPTED_MIME_TYPES,
} from '../lib/imageNormalizer.js';

export const uploadRouter = Router();

const MAX_LOGO_BYTES = 8 * 1024 * 1024;

const s3 = new S3Client({
  region: 'auto',
  endpoint: config.r2Endpoint,
  credentials: {
    accessKeyId: config.r2AccessKeyId,
    secretAccessKey: config.r2SecretAccessKey,
  },
});

function assertR2Configured() {
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

function parseBase64Image(data: string) {
  const base64 = data.includes(',') ? data.split(',').pop() || '' : data;

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) {
    throw createError(400, 'Imagem inválida: envie um base64 válido');
  }

  const buffer = Buffer.from(base64, 'base64');

  if (buffer.length === 0) throw createError(400, 'Imagem inválida: payload vazio');
  if (buffer.length > MAX_LOGO_BYTES) throw createError(413, 'Imagem muito grande: limite de 8MB');

  return buffer;
}

import multer from 'multer';
import { uploadFileToR2 } from '../lib/r2.js';
import { prepareStorableFile } from '../lib/svgSanitize.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { SVG_SANITIZE_RATE_LIMIT } from '../lib/svgSanitizeRateLimit.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const svgSanitizeRateLimit = rateLimit(SVG_SANITIZE_RATE_LIMIT);

// POST /api/upload - Rota genérica para uploads avulsos (ex: pelo Editor no Frontend)
// Rate limit compartilhado com as outras rotas que chamam sanitizeSvg — ver
// lib/svgSanitizeRateLimit.ts (blocker B: pool piscina saturado por uma única conta).
// "Rota genérica = mais fácil de abusar" já era o motivo do comentário original abaixo;
// o rate limit fecha exatamente essa brecha.
uploadRouter.post('/', requireAuth, svgSanitizeRateLimit, upload.single('file'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    assertR2Configured();
    const file = req.file;
    if (!file) throw createError(400, 'Nenhum arquivo enviado.');

    // Rota genérica = mais fácil de abusar: o cliente escolhe nome e Content-Type.
    // SVG sai higienizado como image/svg+xml; HTML vira download (ver svgSanitize.ts).
    const prepared = await prepareStorableFile({ buffer: file.buffer, fileName: file.originalname, mimeType: file.mimetype });

    const url = await uploadFileToR2(
      prepared.buffer,
      file.originalname,
      prepared.mimeType,
      `uploads/general` // Pasta genérica
    );

    res.status(201).json({ data: { url } });
  } catch (error) {
    next(error);
  }
});

// Rate limit compartilhado com as outras rotas que chamam sanitizeSvg — ver
// lib/svgSanitizeRateLimit.ts. Esta rota não repete `requireAuth` explicitamente (só
// existe uma vez, no app.use('/api/upload', requireAuth, uploadRouter) em app.ts), mas
// já roda atrás dele mesmo assim — o rate limit por conta (keyBy: 'user') funciona
// normalmente.
uploadRouter.post('/logo', svgSanitizeRateLimit, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    assertR2Configured();

    const { data, mimeType } = req.body;

    if (!data || typeof data !== 'string') throw createError(400, 'Image data is required');
    if (!mimeType || typeof mimeType !== 'string') throw createError(400, 'mimeType is required');

    if (!isSupportedMimeType(mimeType)) {
      throw createError(
        400,
        `Tipo não suportado: ${mimeType}. Aceitos: ${ACCEPTED_MIME_TYPES.join(', ')}`
      );
    }

    const inputBuffer = parseBase64Image(data);
    const normalized = await normalizeImage(inputBuffer, mimeType);

    const key = `logos/${crypto.randomUUID()}.${normalized.extension}`;

    await s3.send(new PutObjectCommand({
      Bucket: config.r2BucketName,
      Key: key,
      Body: normalized.buffer,
      ContentType: normalized.mimeType,
    }));

    res.json({
      data: {
        url: `${config.r2PublicUrl}/${key}`,
        mimeType: normalized.mimeType,
        width: normalized.width,
        height: normalized.height,
        wasConverted: normalized.wasConverted,
        originalMimeType: normalized.originalMimeType,
      },
    });
  } catch (error) {
    next(error);
  }
});
