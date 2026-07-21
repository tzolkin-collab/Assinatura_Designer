import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';
import { config } from '../config.js';
import { createError } from '../middleware/errorHandler.js';
import type { BrandRole } from '@prisma/client';
import { requireBrandRole, ANY_MEMBER, ADMINS, type BrandRequest } from '../middleware/brandAccess.js';
import {
  generateInviteToken,
  inviteExpiry,
  buildInviteUrl,
  INVITABLE_ROLES,
} from '../lib/invites.js';
import { z } from 'zod';
import { parseBody } from '../lib/validate.js';

export const teamRouter = Router({ mergeParams: true });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// O role vinha do body direto pro create: dava pra convidar alguém como OWNER (ou
// gravar lixo). O enum é a allowlist — OWNER fora, então nem chega ao banco.
const inviteSchema = z.object({
  email: z.string().trim().regex(EMAIL_RE, 'Email inválido.'),
  role: z.enum([...INVITABLE_ROLES] as [BrandRole, ...BrandRole[]]),
});

// Mudança de role aceita qualquer papel válido (inclusive OWNER, guardado depois
// pela checagem de hierarquia); garante que não chegue lixo ao update do Prisma.
const patchRoleSchema = z.object({
  role: z.enum([...ANY_MEMBER] as [BrandRole, ...BrandRole[]]),
});

// GET /api/brands/:slug/members
teamRouter.get('/', requireBrandRole(ANY_MEMBER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.brandId as string;
    const brand = await prisma.brand.findUnique({ where: { slug } });
    if (!brand) throw createError(404, 'Marca não encontrada');
    const brandId = brand.id;

    const members = await prisma.brandMember.findMany({
      where: { brandId },
      include: {
        user: { select: { id: true, name: true, email: true } }
      },
      orderBy: { createdAt: 'asc' }
    });
    res.json({ data: members });
  } catch (error) {
    next(error);
  }
});

// POST /api/brands/:slug/members/invite
teamRouter.post('/invite', requireBrandRole(ADMINS), async (req: BrandRequest, res: Response, next: NextFunction) => {
  try {
    const brand = req.brand!;
    const brandId = brand.id;
    const invitedById = req.user?.userId;

    const { email, role } = parseBody(inviteSchema, req.body);

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });

    // Emite convite com token de uso único (em vez de vincular automaticamente, respeitando o consentimento).
    const { token, tokenHash } = generateInviteToken();

    const invite = await prisma.invite.create({
      data: { tokenHash, email, role, brandId, invitedById, expiresAt: inviteExpiry() },
      select: { id: true, email: true, role: true, expiresAt: true },
    });

    if (user) {
      await prisma.notification.create({
        data: {
          userId: user.id,
          title: 'Convite de Equipe',
          message: `Você foi convidado para participar de ${brand.slug} como ${role}.`,
          type: 'INVITE',
          link: `/convite/${token}`,
        },
      });
    }

    // Não há serviço de email no projeto — o link volta para quem convidou repassar.
    res.status(201).json({
      data: {
        member: null,
        invite: { ...invite, url: buildInviteUrl(config.corsOrigin, token) },
      },
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/brands/:slug/members/:userId
teamRouter.patch('/:targetUserId', requireBrandRole(ADMINS), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.brandId as string;
    const brand = await prisma.brand.findUnique({ where: { slug } });
    if (!brand) throw createError(404, 'Marca não encontrada');
    const brandId = brand.id;

    const targetUserId = req.params.targetUserId as string;
    const { role } = parseBody(patchRoleSchema, req.body);

    // O mesmo projeto não pode ter 2 donos.
    if ((role as string) === 'OWNER') {
      throw createError(400, 'Um projeto não pode ter mais de um dono. Para transferir a titularidade, contate o suporte.');
    }

    if ((role as string) !== 'OWNER') {
      const currentMembership = await prisma.brandMember.findUnique({
        where: { userId_brandId: { userId: targetUserId, brandId } }
      });
      if (currentMembership?.role === 'OWNER') {
        const ownerCount = await prisma.brandMember.count({
          where: { brandId, role: 'OWNER' }
        });
        if (ownerCount <= 1) {
          throw createError(400, 'Não é possível rebaixar o único proprietário da marca.');
        }
      }
    }

    const membership = await prisma.brandMember.update({
      where: { userId_brandId: { userId: targetUserId, brandId } },
      data: { role },
      include: { user: { select: { id: true, name: true, email: true } } }
    });

    res.json({ data: membership });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/brands/:slug/members/:userId
teamRouter.delete('/:targetUserId', requireBrandRole(ADMINS), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.brandId as string;
    const brand = await prisma.brand.findUnique({ where: { slug } });
    if (!brand) throw createError(404, 'Marca não encontrada');
    const brandId = brand.id;

    const targetUserId = req.params.targetUserId as string;

    const currentMembership = await prisma.brandMember.findUnique({
      where: { userId_brandId: { userId: targetUserId, brandId } }
    });
    if (currentMembership?.role === 'OWNER') {
      const ownerCount = await prisma.brandMember.count({
        where: { brandId, role: 'OWNER' }
      });
      if (ownerCount <= 1) {
        throw createError(400, 'Não é possível remover o único proprietário da marca.');
      }
    }

    await prisma.brandMember.delete({
      where: { userId_brandId: { userId: targetUserId, brandId } }
    });

    res.json({ message: 'Membro removido.' });
  } catch (error) {
    next(error);
  }
});
