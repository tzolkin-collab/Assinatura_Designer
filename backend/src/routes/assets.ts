import { Router, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';
import multer from 'multer';
import { uploadFileToR2 } from '../lib/r2.js';
import { createError } from '../middleware/errorHandler.js';
import { requireBrandRole, ANY_MEMBER, EDITORS, type BrandRequest } from '../middleware/brandAccess.js';

export const assetsRouter = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });


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
        // TODO: Extrair dimensões para imagens (sharp) depois
      }
    });
    res.status(201).json({ data: asset });
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
    const result = await prisma.asset.deleteMany({ where: { id: assetId, brandId: brand.id } });
    if (result.count === 0) throw createError(404, 'Asset não encontrado nesta marca.');

    // TODO: Apagar do Cloudflare R2
    res.json({ message: 'Asset deletado.' });
  } catch (error) {
    next(error);
  }
});
