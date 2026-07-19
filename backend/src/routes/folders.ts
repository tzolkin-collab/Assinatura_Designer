import { Router, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import {
  requireBrandRole,
  brandMemberFilter,
  ANY_MEMBER,
  EDITORS,
  type BrandRequest,
} from '../middleware/brandAccess.js';
import { z } from 'zod';
import { parseBody } from '../lib/validate.js';

export const foldersRouter = Router();

const createFolderSchema = z.object({
  name: z.string().trim().min(1, 'Folder name is required'),
  parentId: z.string().nullish(),
});

const patchFolderSchema = z
  .object({
    name: z.string().trim().min(1, 'Folder name is required').optional(),
    parentId: z.string().nullable().optional(),
  })
  .refine((d) => d.name !== undefined || d.parentId !== undefined, {
    message: 'Informe ao menos um campo: name ou parentId.',
  });

const FOLDER_FIELDS = { id: true, name: true, parentId: true, createdAt: true } as const;

/**
 * Resolve o pai de uma pasta: precisa existir E ser da mesma marca. Sem esta
 * checagem daria para aninhar uma pasta sob a pasta de outra marca só mandando
 * o id no body — o mesmo tipo de vazamento cross-tenant que o repo já corrigiu.
 */
async function assertParentInBrand(parentId: string, brandId: string): Promise<void> {
  const parent = await prisma.folder.findFirst({
    where: { id: parentId, brandId },
    select: { id: true },
  });
  if (!parent) throw createError(404, 'Pasta pai não encontrada nesta marca.');
}

/**
 * Impede ciclos ao mover: subir a cadeia de ancestrais do novo pai e falhar se
 * encontrar a própria pasta. Um ciclo some da árvore (nenhum nó chega à raiz) e
 * ainda enche de laço qualquer travessia recursiva.
 */
async function assertNoCycle(folderId: string, newParentId: string): Promise<void> {
  if (folderId === newParentId) {
    throw createError(400, 'Uma pasta não pode ser pai de si mesma.');
  }

  let cursor: string | null = newParentId;
  while (cursor) {
    const current: { parentId: string | null } | null = await prisma.folder.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    if (!current) break;
    if (current.parentId === folderId) {
      throw createError(400, 'Não é possível mover uma pasta para dentro de uma subpasta dela mesma.');
    }
    cursor = current.parentId;
  }
}

// GET /api/folders/:brandSlug — lista plana com parentId; o cliente monta a árvore.
foldersRouter.get('/:slug', requireBrandRole(ANY_MEMBER), async (req: BrandRequest, res: Response, next: NextFunction) => {
  try {
    const brand = req.brand!;

    const folders = await prisma.folder.findMany({
      where: { brandId: brand.id },
      select: FOLDER_FIELDS,
      orderBy: { createdAt: 'desc' },
    });

    res.json({ data: folders });
  } catch (error) {
    next(error);
  }
});

// POST /api/folders/:brandSlug — cria pasta, opcionalmente dentro de outra.
foldersRouter.post('/:slug', requireBrandRole(EDITORS), async (req: BrandRequest, res: Response, next: NextFunction) => {
  try {
    const { name, parentId } = parseBody(createFolderSchema, req.body);

    const brand = req.brand!;

    if (parentId) await assertParentInBrand(parentId, brand.id);

    const folder = await prisma.folder.create({
      data: { name, brandId: brand.id, parentId: parentId ?? null },
      select: FOLDER_FIELDS,
    });

    res.status(201).json({ data: folder });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/folders/:id — renomeia e/ou move a pasta na árvore.
foldersRouter.patch('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { name, parentId } = parseBody(patchFolderSchema, req.body);

    const folder = await prisma.folder.findFirst({
      where: { id, brand: brandMemberFilter(req.user?.userId, EDITORS) },
      select: { id: true, brandId: true },
    });
    if (!folder) throw createError(404, 'Folder not found');

    if (parentId) {
      await assertParentInBrand(parentId, folder.brandId);
      await assertNoCycle(folder.id, parentId);
    }

    const updated = await prisma.folder.update({
      where: { id: folder.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(parentId !== undefined ? { parentId } : {}),
      },
      select: FOLDER_FIELDS,
    });

    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/folders/:id — as subpastas caem junto (cascade); os posts das pastas
// apagadas voltam para "sem pasta" (folderId vira null), nunca são excluídos.
foldersRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const folder = await prisma.folder.findFirst({
      where: {
        id,
        brand: brandMemberFilter(req.user?.userId, EDITORS)
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
