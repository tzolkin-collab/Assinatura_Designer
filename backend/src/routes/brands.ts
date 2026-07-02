import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';
import { createError } from '../middleware/errorHandler.js';
import type { AuthRequest } from '../middleware/auth.js';

export const brandsRouter = Router();

// GET /api/brands - List brands owned by the authenticated user
brandsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthRequest).user!;
    const brands = await prisma.brand.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { posts: true } } },
    });
    res.json({ data: brands });
  } catch (error) {
    next(error);
  }
});

// GET /api/brands/:slug - Get single brand (must belong to user)
brandsRouter.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthRequest).user!;
    const slug = req.params.slug as string;
    const brand = await prisma.brand.findFirst({
      where: { slug, userId },
      include: { config: true, _count: { select: { posts: true, refs: true } } },
    });
    if (!brand) throw createError(404, 'Brand not found');
    res.json({ data: brand });
  } catch (error) {
    next(error);
  }
});

// GET /api/brands/:slug/posts - Get all posts for a brand
brandsRouter.get('/:slug/posts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthRequest).user!;
    const slug = req.params.slug as string;
    const brand = await prisma.brand.findFirst({
      where: { slug, userId },
      select: { id: true },
    });
    if (!brand) throw createError(404, 'Brand not found');
    const posts = await prisma.post.findMany({
      where: { brandId: brand.id },
      orderBy: { createdAt: 'desc' },
      include: { folder: true },
    });
    res.json({ data: posts });
  } catch (error) {
    next(error);
  }
});

// POST /api/brands - Create a new brand (userId from JWT)
brandsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthRequest).user!;
    const { name, color } = req.body;
    if (!name) throw createError(400, 'Name is required');

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    const exist = await prisma.brand.findUnique({ where: { slug } });
    if (exist) throw createError(409, 'Brand with this name already exists');

    const brand = await prisma.brand.create({
      data: { name, slug, color: color || '#171717', userId },
    });
    res.status(201).json({ data: brand });
  } catch (error) {
    next(error);
  }
});

// PUT /api/brands/:slug - Update brand (must belong to user)
brandsRouter.put('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthRequest).user!;
    const slug = req.params.slug as string;
    const { name, color } = req.body;
    const existing = await prisma.brand.findFirst({ where: { slug, userId } });
    if (!existing) throw createError(404, 'Brand not found');
    const brand = await prisma.brand.update({ where: { slug }, data: { name, color } });
    res.json({ data: brand });
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === 'P2025') {
      return next(createError(404, 'Brand not found'));
    }
    
    return next(error);
  }
});

// GET /api/brands/:slug/logo-asset — proxy logo server-side to avoid CORS
brandsRouter.get('/:slug/logo-asset', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthRequest).user!;
    const slug = req.params.slug as string;
    const brand = await prisma.brand.findFirst({
      where: { slug, userId },
      include: { config: true },
    });
    if (!brand) throw createError(404, 'Brand not found');
    const logoUrl = brand.config?.logoUrl;
    if (!logoUrl) throw createError(404, 'No logo configured for this brand');
    const imgRes = await fetch(logoUrl);
    if (!imgRes.ok) throw createError(502, 'Failed to fetch logo from storage');
    const contentType = imgRes.headers.get('content-type') || 'image/png';
    const buffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    res.json({
      data: {
        name: 'logo',
        mimeType: contentType,
        dataBase64: base64,
        sizeBytes: buffer.byteLength,
      },
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/brands/:slug - Delete brand (must belong to user)
brandsRouter.delete('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthRequest).user!;
    const slug = req.params.slug as string;
    const existing = await prisma.brand.findFirst({ where: { slug, userId } });
    if (!existing) throw createError(404, 'Brand not found');
    await prisma.brand.delete({ where: { slug } });
    res.json({ message: 'Brand deleted successfully' });
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === 'P2025') {
      return next(createError(404, 'Brand not found'));
    }
    
    return next(error);
  }
});
