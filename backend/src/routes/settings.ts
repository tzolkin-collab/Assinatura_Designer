import { Router, Response, NextFunction } from 'express';
import dns from 'dns/promises';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import bcrypt from 'bcrypt';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import { generateWithRetry } from '../lib/geminiRetry.js';
import { config } from '../config.js';
import type { Prisma, BrandRole } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { getBilling } from '../lib/aiBudget.js';
import { assertBrandAccess, ANY_MEMBER, EDITORS } from '../middleware/brandAccess.js';
import { createError } from '../middleware/errorHandler.js';
import { config as appConfig } from '../config.js';
import { AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';
import { isPublicHttpUrl, isPublicHttpUrlResolved } from '../lib/validate.js';
import { analyzeReferenceBackground } from '../lib/referenceSync.js';

export const settingsRouter = Router();

const referenciaSchema = z.object({
  name: z.string({ required_error: 'Reference name is required' }).trim().min(1, 'Reference name is required'),
  analysisUrl: z
    .string({ required_error: 'Reference URL is required for analysis' })
    .trim()
    .min(1, 'Reference URL is required for analysis'),
  sourceType: z.string().optional(),
});

const s3 = new S3Client({
  region: 'auto',
  endpoint: appConfig.r2Endpoint,
  credentials: {
    accessKeyId: appConfig.r2AccessKeyId,
    secretAccessKey: appConfig.r2SecretAccessKey,
  },
});

// Resolve a marca pelo slug exigindo vínculo do usuário (BrandMember).
// Antes isso comparava `brand.userId`, o que trancava a equipe inteira fora das configurações.
const getBrandId = async (slug: string, userId?: string, roles: BrandRole[] = EDITORS) => {
  const brand = await assertBrandAccess(slug, userId, roles);
  return brand.id;
};

// ── Agent & Branding Config ──

settingsRouter.get('/:slug/config', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const brandId = await getBrandId(req.params.slug as string, req.user?.userId, ANY_MEMBER);
    const config = await prisma.brandConfig.findUnique({ where: { brandId } });

    res.json({ data: config });
  } catch (error) {
    next(error);
  }
});

settingsRouter.put('/:slug/config', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const brandId = await getBrandId(req.params.slug as string, req.user?.userId);
    const { agentPrompt, primaryFonts, colors, guidelines, logoUrl, presentationConfig } = req.body;

    const normalizedPresentationConfig =
      presentationConfig === undefined
        ? undefined
        : (presentationConfig as Prisma.InputJsonValue);

    const config = await prisma.brandConfig.upsert({
      where: { brandId },
      update: { agentPrompt, primaryFonts, colors, guidelines, logoUrl, presentationConfig: normalizedPresentationConfig },
      create: {
        brandId,
        agentPrompt: agentPrompt || '',
        primaryFonts: primaryFonts || [],
        colors: colors || [],
        guidelines: guidelines || '',
        logoUrl,
        presentationConfig: normalizedPresentationConfig,
      },
    });

    res.json({ data: config });
  } catch (error) {
    next(error);
  }
});

// ── References ──

settingsRouter.get('/:slug/referencias', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const brandId = await getBrandId(req.params.slug as string, req.user?.userId, ANY_MEMBER);
    const refs = await prisma.reference.findMany({
      where: { brandId },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ data: refs });
  } catch (error) {
    next(error);
  }
});

settingsRouter.post('/:slug/referencias', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug as string;
    const brandId = await getBrandId(slug, req.user?.userId);
    const { name, analysisUrl, sourceType, autoSyncEnabled, autoSyncInterval } = req.body;

    // Guard de SSRF: só http(s) público. Fica fora do zod porque é mais que formato
    // de URL — resolve o host e barra IPs privados/loopback.
    if (!isPublicHttpUrl(analysisUrl)) throw createError(400, 'URL inválida ou não permitida (apenas http(s) público)');

    let validSourceType = sourceType === 'INSTAGRAM' ? 'INSTAGRAM' : 'WEBSITE';
    if (analysisUrl.toLowerCase().includes('instagram.com')) {
      validSourceType = 'INSTAGRAM';
    }

    const ref = await prisma.reference.create({
      data: { 
        name, 
        analysisUrl, 
        brandId, 
        status: 'PENDING', 
        insights: 0, 
        sourceType: validSourceType,
        autoSyncEnabled: !!autoSyncEnabled,
        autoSyncInterval: autoSyncInterval ? Number(autoSyncInterval) : 14
      },
    });

    // Respond immediately, analyze in background
    res.status(201).json({ data: ref });

    analyzeReferenceBackground(ref.id, slug, name, analysisUrl, validSourceType).catch(console.error);
  } catch (error) {
    next(error);
  }
});



settingsRouter.patch('/:slug/referencias/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug as string;
    const brandId = await getBrandId(slug, req.user?.userId);
    const id = req.params.id as string;
    const { autoSyncEnabled, autoSyncInterval } = req.body;

    const ref = await prisma.reference.findFirst({ where: { id, brandId } });
    if (!ref) throw createError(404, 'Reference not found');

    const updated = await prisma.reference.update({
      where: { id },
      data: {
        autoSyncEnabled: autoSyncEnabled !== undefined ? autoSyncEnabled : ref.autoSyncEnabled,
        autoSyncInterval: autoSyncInterval !== undefined ? autoSyncInterval : ref.autoSyncInterval,
      }
    });

    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

settingsRouter.post('/:slug/referencias/:id/sync', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug as string;
    const brandId = await getBrandId(slug, req.user?.userId);
    const id = req.params.id as string;

    const ref = await prisma.reference.findFirst({ where: { id, brandId } });
    if (!ref) throw createError(404, 'Reference not found');

    const updated = await prisma.reference.update({
      where: { id },
      data: { status: 'PENDING' }
    });

    res.json({ data: updated, message: 'Sync started' });

    analyzeReferenceBackground(ref.id, slug, ref.name, ref.analysisUrl, ref.sourceType).catch(console.error);
  } catch (error) {
    next(error);
  }
});



settingsRouter.delete('/:slug/referencias/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug as string;
    const brandId = await getBrandId(slug, req.user?.userId);
    const id = req.params.id as string;
    // Escopa a exclusão à marca do usuário — antes qualquer dono de marca podia
    // deletar referências de marcas alheias passando só o id (cross-tenant).
    const result = await prisma.reference.deleteMany({ where: { id, brandId } });
    if (result.count === 0) throw createError(404, 'Reference not found');
    res.json({ message: 'Reference deleted' });
  } catch (error) {
    return next(error);
  }
});

// ── GET /api/settings/perfil ──
settingsRouter.get('/perfil', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        asanaToken: true,
        googleAccessToken: true,
        canvaAccessToken: true,
      },
    });

    if (!user) throw createError(404, 'Usuário não encontrado');

    res.json({
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        connections: {
          asana: !!user.asanaToken,
          googleDrive: !!user.googleAccessToken,
          canva: !!user.canvaAccessToken,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── PUT /api/settings/perfil ──
settingsRouter.put('/perfil', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    const { name, password } = req.body as { name?: string; password?: string };

    const updateData: Prisma.UserUpdateInput = {};
    if (name && name.trim().length > 0) {
      updateData.name = name.trim();
    }
    if (password && password.length >= 8) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updateData).length === 0) {
      throw createError(400, 'Nenhum dado válido para atualização fornecido');
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, name: true, email: true, role: true },
    });

    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

// ── DELETE /api/settings/connections/:provider ──
settingsRouter.delete('/connections/:provider', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    const { provider } = req.params;

    const updateData: Prisma.UserUpdateInput = {};
    if (provider === 'asana') {
      updateData.asanaToken = null;
    } else if (provider === 'google') {
      updateData.googleAccessToken = null;
      updateData.googleRefreshToken = null;
      updateData.googleTokenExpiry = null;
    } else if (provider === 'canva') {
      updateData.canvaAccessToken = null;
      updateData.canvaRefreshToken = null;
      updateData.canvaTokenExpiry = null;
      updateData.canvaUserId = null;
      updateData.canvaCodeVerifier = null;
      updateData.canvaOauthState = null;
    } else {
      throw createError(400, 'Provedor de conexão inválido');
    }

    await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    res.json({ message: `Conexão com ${provider} removida com sucesso` });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/settings/tenants ──
settingsRouter.get('/tenants', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user?.role !== 'ADMIN') {
      throw createError(403, 'Acesso exclusivo para administradores');
    }

    const brands = await prisma.brand.findMany({
      include: {
        members: {
          select: {
            role: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
        _count: { select: { posts: true, folders: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ data: brands });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/settings/billing ──
settingsRouter.get('/billing', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user?.role !== 'ADMIN') {
      throw createError(403, 'Acesso exclusivo para administradores');
    }

    const { month } = req.query as { month?: string };
    const report = await getBilling(undefined, month);

    res.json({ data: report });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/settings/agent ──
settingsRouter.get('/agent', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user?.role !== 'ADMIN') {
      throw createError(403, 'Acesso exclusivo para administradores');
    }

    res.json({
      data: {
        models: config.models,
        thinkingBudget: config.geminiThinkingBudget,
        dailyTokenBudget: config.aiDailyTokenBudget,
        brandDailyTokenBudget: config.aiBrandDailyTokenBudget,
      },
    });
  } catch (error) {
    next(error);
  }
});

