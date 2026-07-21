import { Router, Request, Response, NextFunction } from 'express';
import { getBrandMemory, updateBrandMemory } from '../lib/redis.js';

export const memoryRoutes = Router({ mergeParams: true });

// ── GET /api/brands/:brandSlug/memory ──
memoryRoutes.get('/', async (req: Request<{ brandSlug: string }>, res: Response, next: NextFunction) => {
  try {
    const brandSlug = req.params.brandSlug as string;
    const memory = await getBrandMemory(brandSlug);
    res.json({ data: memory });
  } catch (error) {
    next(error);
  }
});

// ── PUT /api/brands/:brandSlug/memory ──
memoryRoutes.put('/', async (req: Request<{ brandSlug: string }>, res: Response, next: NextFunction) => {
  try {
    const brandSlug = req.params.brandSlug as string;
    const patch = req.body;
    
    // Validar se 'preferences' está sendo enviado
    if (patch && patch.preferences && typeof patch.preferences === 'object') {
      await updateBrandMemory(brandSlug, { preferences: patch.preferences });
    }
    
    const updated = await getBrandMemory(brandSlug);
    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});
