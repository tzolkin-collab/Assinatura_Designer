import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import multer from 'multer';
import sharp from 'sharp';
import { uploadFileToR2, deleteFromR2 } from '../lib/r2.js';
import { createError } from '../middleware/errorHandler.js';
import { requireBrandRole, ANY_MEMBER, EDITORS, type BrandRequest } from '../middleware/brandAccess.js';
import { parseBody } from '../lib/validate.js';

export const assetsRouter = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

const importBase64Schema = z.object({
  attachments: z.array(z.object({
    name: z.string().min(1),
    mimeType: z.string().min(1),
    dataBase64: z.string().min(1),
  })).min(1).max(20),
});


// GET /api/brands/:slug/assets
assetsRouter.get('/', requireBrandRole(ANY_MEMBER), async (req: BrandRequest, res: Response, next: NextFunction) => {
  try {
    const brand = req.brand!;

    const assets = await prisma.asset.findMany({
      where: { brandId: brand.id },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ data: assets });
  } catch (error) {
    next(error);
  }
});

// POST /api/brands/:slug/assets
assetsRouter.post('/', requireBrandRole(EDITORS), upload.single('file'), async (req: BrandRequest, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.user!;
    const file = req.file;

    if (!file) throw createError(400, 'Nenhum arquivo enviado.');

    const brand = req.brand!;

    // Dimensões: sem elas o editor não sabe a proporção e insere a imagem esticada
    // num quadrado. Falha de leitura não impede o upload (pode ser SVG/fonte).
    let width: number | undefined;
    let height: number | undefined;
    if (file.mimetype.startsWith('image/')) {
      try {
        const meta = await sharp(file.buffer).metadata();
        width = meta.width;
        height = meta.height;
      } catch {
        // segue sem dimensões
      }
    }

    // Upload to R2
    const url = await uploadFileToR2(
      file.buffer,
      file.originalname,
      file.mimetype,
      `brands/${brand.id}`
    );

    const asset = await prisma.asset.create({
      data: {
        brandId: brand.id,
        uploadedBy: userId,
        name: file.originalname,
        url,
        fileType: file.mimetype,
        sizeBytes: file.size,
        width,
        height,
      }
    });
    res.status(201).json({ data: asset });
  } catch (error) {
    next(error);
  }
});

// POST /api/brands/:slug/assets/import-base64 — importa arquivos já baixados em
// base64 (Drive/Asana) pro pool de assets da marca. O frontend reaproveita os
// mesmos popups da Fábrica (DrivePopup/AsanaPopup), que já resolvem OAuth e
// devolvem `attachments` nesse formato — aqui só falta persistir no R2 + Asset.
assetsRouter.post('/import-base64', requireBrandRole(EDITORS), async (req: BrandRequest, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.user!;
    const brand = req.brand!;
    const { attachments } = parseBody(importBase64Schema, req.body ?? {});

    const created = [];
    for (const att of attachments) {
      let buffer: Buffer;
      try {
        buffer = Buffer.from(att.dataBase64, 'base64');
      } catch {
        continue; // base64 inválido: pula este item, não derruba o lote inteiro
      }
      if (buffer.length === 0 || buffer.length > MAX_IMPORT_BYTES) continue;

      let width: number | undefined;
      let height: number | undefined;
      if (att.mimeType.startsWith('image/')) {
        try {
          const meta = await sharp(buffer).metadata();
          width = meta.width;
          height = meta.height;
        } catch {
          // segue sem dimensões
        }
      }

      const url = await uploadFileToR2(buffer, att.name, att.mimeType, `brands/${brand.id}`);

      const asset = await prisma.asset.create({
        data: {
          brandId: brand.id,
          uploadedBy: userId,
          name: att.name,
          url,
          fileType: att.mimeType,
          sizeBytes: buffer.length,
          width,
          height,
        },
      });
      created.push(asset);
    }

    if (created.length === 0) throw createError(400, 'Nenhum arquivo pôde ser importado.');

    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/brands/:brandId/assets/:assetId
assetsRouter.delete('/:assetId', requireBrandRole(EDITORS), async (req: BrandRequest, res: Response, next: NextFunction) => {
  try {
    const assetId = req.params.assetId as string;
    const brand = req.brand!;

    // Escopado à marca: sem o brandId aqui, qualquer membro apagaria asset de outra marca.
    const asset = await prisma.asset.findFirst({
      where: { id: assetId, brandId: brand.id },
      select: { id: true, url: true },
    });
    if (!asset) throw createError(404, 'Asset não encontrado nesta marca.');

    await prisma.asset.delete({ where: { id: asset.id } });

    // Apaga o objeto no R2. Se falhar, a linha já saiu do banco: o arquivo vira lixo
    // pago, mas o usuário não fica com um asset zumbi na biblioteca. Logamos para
    // permitir uma limpeza posterior.
    try {
      await deleteFromR2(asset.url);
    } catch (r2Err) {
      console.error(`[Assets] falha ao apagar ${asset.url} no R2:`, (r2Err as Error).message);
    }

    res.json({ message: 'Asset deletado.' });
  } catch (error) {
    next(error);
  }
});
