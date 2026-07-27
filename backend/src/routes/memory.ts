import { Router, Response, NextFunction } from 'express';
import { getBrandMemory, updateBrandMemory } from '../lib/redis.js';
import { requireBrandRole, ANY_MEMBER, EDITORS, type BrandRequest } from '../middleware/brandAccess.js';

export const memoryRoutes = Router({ mergeParams: true });

// ── GET /api/brands/:brandSlug/memory ──
// VIEWER+ pode ler a memória da marca (contexto de preferências do agente)
memoryRoutes.get('/', requireBrandRole(ANY_MEMBER), async (req: BrandRequest, res: Response, next: NextFunction) => {
  try {
    const brandSlug = req.brand!.slug;
    const memory = await getBrandMemory(brandSlug);
    res.json({ data: memory });
  } catch (error) {
    next(error);
  }
});

// ── PUT /api/brands/:brandSlug/memory ──
// Apenas EDITOR+ pode alterar as preferências de memória da marca
memoryRoutes.put('/', requireBrandRole(EDITORS), async (req: BrandRequest, res: Response, next: NextFunction) => {
  try {
    const brandSlug = req.brand!.slug;
    const patch = req.body;

    if (patch && patch.preferences && typeof patch.preferences === 'object') {
      await updateBrandMemory(brandSlug, { preferences: patch.preferences });
    }

    const updated = await getBrandMemory(brandSlug);
    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});
