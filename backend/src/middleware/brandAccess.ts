import type { Response, NextFunction } from 'express';
import type { BrandRole } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { createError } from './errorHandler.js';
import type { AuthRequest } from './auth.js';

/**
 * Autorização por marca (RBAC), única fonte de verdade.
 *
 * Toda rota que toca dados de uma marca precisa passar por aqui. O caminho antigo
 * (`Brand.userId`) só enxergava o dono e será removido — não usar em código novo.
 */

export const ANY_MEMBER: BrandRole[] = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'];
export const EDITORS: BrandRole[] = ['OWNER', 'ADMIN', 'EDITOR'];
export const ADMINS: BrandRole[] = ['OWNER', 'ADMIN'];
export const OWNER_ONLY: BrandRole[] = ['OWNER'];

export const FORBIDDEN_MESSAGE = 'Você não tem permissão para realizar esta ação na marca.';

export interface BrandRequest extends AuthRequest {
  brand?: { id: string; slug: string };
  brandRole?: BrandRole;
}

/** O slug da marca aparece com nomes diferentes conforme o ponto de montagem do router. */
function resolveSlug(req: BrandRequest): string | undefined {
  const params = req.params as Record<string, string | undefined>;
  return params.slug ?? params.brandId ?? params.marca;
}

/**
 * Carrega a marca pelo slug, exige que o usuário seja membro com uma das roles
 * permitidas e anexa `req.brand` / `req.brandRole` para o handler reusar.
 */
export function requireBrandRole(allowed: BrandRole[]) {
  return async (req: BrandRequest, _res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.userId;
      if (!userId) return next(createError(401, 'Unauthorized'));

      const slug = resolveSlug(req);
      if (!slug) return next(createError(400, 'Marca não informada.'));

      const brand = await prisma.brand.findUnique({
        where: { slug },
        select: { id: true, slug: true },
      });
      if (!brand) return next(createError(404, 'Marca não encontrada.'));

      const membership = await prisma.brandMember.findUnique({
        where: { userId_brandId: { userId, brandId: brand.id } },
        select: { role: true },
      });

      if (!membership || !allowed.includes(membership.role)) {
        return next(createError(403, FORBIDDEN_MESSAGE));
      }

      req.brand = brand;
      req.brandRole = membership.role;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Mesma regra, para rotas que não recebem o slug na URL (ex.: `/posts/:id`, onde a
 * marca só é conhecida pelo relacionamento). Devolve o fragmento `where` do Prisma.
 *
 *   where: { id, brand: brandMemberFilter(userId, EDITORS) }
 */
export function brandMemberFilter(userId: string | undefined, roles: BrandRole[] = ANY_MEMBER) {
  return { members: { some: { userId: userId ?? '', role: { in: roles } } } };
}

/** Checagem imperativa, para quando o slug vem no body (ex.: criar sessão da fábrica). */
export async function assertBrandAccess(
  slug: string,
  userId: string | undefined,
  allowed: BrandRole[] = ANY_MEMBER,
): Promise<{ id: string; slug: string }> {
  if (!userId) throw createError(401, 'Unauthorized');

  const brand = await prisma.brand.findUnique({ where: { slug }, select: { id: true, slug: true } });
  if (!brand) throw createError(404, 'Marca não encontrada.');

  const membership = await prisma.brandMember.findUnique({
    where: { userId_brandId: { userId, brandId: brand.id } },
    select: { role: true },
  });
  if (!membership || !allowed.includes(membership.role)) {
    throw createError(403, FORBIDDEN_MESSAGE);
  }
  return brand;
}
