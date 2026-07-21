import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import multer from 'multer';
import sharp from 'sharp';
import { uploadFileToR2, deleteFromR2 } from '../lib/r2.js';
import { createError } from '../middleware/errorHandler.js';
import { requireBrandRole, ANY_MEMBER, EDITORS, type BrandRequest } from '../middleware/brandAccess.js';
import { parseBody } from '../lib/validate.js';
import { exportDesign, waitForExport } from '../lib/canvaClient.js';

export const assetsRouter = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

const importBase64Schema = z.object({
  attachments: z.array(z.object({
    name: z.string().min(1),
    mimeType: z.string().min(1),
    dataBase64: z.string().min(1),
  })).min(1).max(20),
  // De onde os attachments vieram — o frontend sabe (é o popup que chamou),
  // o backend não tem como inferir. 'upload' cobriria import genérico futuro.
  source: z.enum(['drive', 'asana', 'upload']).default('upload'),
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
    const { attachments, source } = parseBody(importBase64Schema, req.body ?? {});

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
          source,
          tags: [source],
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

// POST /api/brands/:slug/assets/import-canva/:designId — exporta um design do
// Canva do usuário (PNG) e importa pro pool de assets da marca. O Canva é
// conector por-usuário (não por-marca): quem exporta é sempre o requester
// (req.user), o pool que recebe é a marca da URL.
assetsRouter.post('/import-canva/:designId', requireBrandRole(EDITORS), async (req: BrandRequest, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.user!;
    const brand = req.brand!;
    const designId = req.params.designId as string;
    const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim() : `Canva ${designId.slice(0, 8)}`;

    let exportJob: { job?: { id?: string } };
    try {
      exportJob = (await exportDesign(userId, designId, 'png')) as { job?: { id?: string } };
    } catch (err) {
      throw createError(502, `Falha ao iniciar export do Canva: ${(err as Error).message}`);
    }
    const exportId = exportJob.job?.id;
    if (!exportId) throw createError(502, 'Canva não retornou o id do job de export');

    let exported: Record<string, unknown>;
    try {
      exported = await waitForExport(userId, exportId);
    } catch (err) {
      throw createError(502, `Export do Canva falhou: ${(err as Error).message}`);
    }
    const urls = ((exported.job as Record<string, unknown> | undefined)?.urls as string[] | undefined) ?? [];
    if (urls.length === 0) throw createError(502, 'Canva não retornou nenhum arquivo exportado.');

    const created = [];
    for (let i = 0; i < urls.length; i++) {
      const fileRes = await fetch(urls[i]!);
      if (!fileRes.ok) continue; // uma página falhar não derruba o design inteiro
      const buffer = Buffer.from(await fileRes.arrayBuffer());

      let width: number | undefined;
      let height: number | undefined;
      try {
        const meta = await sharp(buffer).metadata();
        width = meta.width;
        height = meta.height;
      } catch {
        // segue sem dimensões
      }

      const name = urls.length > 1 ? `${title} - página ${i + 1}.png` : `${title}.png`;
      const url = await uploadFileToR2(buffer, name, 'image/png', `brands/${brand.id}`);

      const asset = await prisma.asset.create({
        data: {
          brandId: brand.id,
          uploadedBy: userId,
          name,
          url,
          fileType: 'image/png',
          sizeBytes: buffer.length,
          width,
          height,
          source: 'canva',
          tags: ['canva'],
        },
      });
      created.push(asset);
    }

    if (created.length === 0) throw createError(502, 'Nenhuma página do design pôde ser importada.');

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

// POST /api/brands/:brandId/assets/:assetId/export-canva
assetsRouter.post('/:assetId/export-canva', requireBrandRole(EDITORS), async (req: BrandRequest, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.user!;
    const brand = req.brand!;
    const assetId = req.params.assetId as string;

    const asset = await prisma.asset.findFirst({
      where: { id: assetId, brandId: brand.id },
    });
    if (!asset) throw createError(404, 'Asset não encontrado nesta marca.');

    // 1. Baixar o arquivo do R2 para a memória
    const fileRes = await fetch(asset.url);
    if (!fileRes.ok) throw createError(502, 'Falha ao recuperar o arquivo do armazenamento.');
    const buffer = Buffer.from(await fileRes.arrayBuffer());

    // 2. Fazer upload para o Canva (requer que o usuário tenha vinculado o Canva)
    const { uploadAssetAndWait, createDesign, parseDesignResponse } = await import('../lib/canvaClient.js');
    let canvaAssetId: string;
    try {
      canvaAssetId = await uploadAssetAndWait(userId, buffer, asset.name, asset.fileType || 'image/png');
    } catch (err) {
      throw createError(502, `Falha ao subir arquivo pro Canva: ${(err as Error).message}`);
    }

    // 3. Criar um novo design com a imagem
    let designUrl: string | undefined;
    try {
      const designResult = await createDesign(userId, {
        title: asset.name,
        asset_id: canvaAssetId,
      });
      const parsed = parseDesignResponse(designResult);
      designUrl = parsed.url;
    } catch (err) {
      throw createError(502, `Falha ao criar design no Canva: ${(err as Error).message}`);
    }

    res.json({ data: { url: designUrl } });
  } catch (error) {
    next(error);
  }
});
