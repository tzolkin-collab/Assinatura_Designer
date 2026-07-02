import { Router, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';

export const foldersRouter = Router();

// GET /api/folders/:brandSlug
foldersRouter.get('/:slug', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug as string;
    const brand = await prisma.brand.findFirst({
      where: {
        slug,
        userId: req.user?.userId
      }
    });
    if (!brand) throw createError(404, 'Brand not found');

    const folders = await prisma.folder.findMany({
      where: { brandId: brand.id },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ data: folders });
  } catch (error) {
    next(error);
  }
});

// POST /api/folders/:brandSlug
foldersRouter.post('/:slug', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug as string;
    const { name } = req.body;
    
    if (!name) throw createError(400, 'Folder name is required');

    const brand = await prisma.brand.findFirst({
      where: {
        slug,
        userId: req.user?.userId
      }
    });
    if (!brand) throw createError(404, 'Brand not found');

    const folder = await prisma.folder.create({
      data: {
        name,
        brandId: brand.id
      }
    });

    res.status(201).json({ data: folder });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/folders/:id
foldersRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const folder = await prisma.folder.findFirst({
      where: {
        id,
        brand: { userId: req.user?.userId }
      },
      select: { id: true }
    });

    if (!folder) throw createError(404, 'Folder not found');
    
    await prisma.folder.delete({
      where: { id: folder.id }
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
