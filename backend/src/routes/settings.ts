import { Router, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { S3Client } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import { config } from '../config.js';
import type { Prisma, BrandRole } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { getBilling } from '../lib/aiBudget.js';
import { assertBrandAccess, ANY_MEMBER, EDITORS } from '../middleware/brandAccess.js';

const ADMIN_ROLES: BrandRole[] = ['OWNER', 'ADMIN'];
import { createError } from '../middleware/errorHandler.js';
import { normalizarLogoParaFundoEscuro } from '../lib/logoTransparency.js';
import { normalizarParaFormulario } from '../lib/brandGuidelines.js';
import { config as appConfig } from '../config.js';
import { AuthRequest } from '../middleware/auth.js';
import { isPublicHttpUrl } from '../lib/validate.js';

export const settingsRouter = Router();

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
    const [config, marca] = await Promise.all([
      prisma.brandConfig.findUnique({ where: { brandId } }),
      prisma.brand.findUnique({ where: { id: brandId }, select: { name: true } }),
    ]);

    // Normaliza na LEITURA em vez de corrigir só na escrita: as marcas que já
    // ficaram com o formato quebrado voltam a exibir certo na hora, e o próximo
    // save da página grava a versão limpa. Sem isto o frontend cairia no catch
    // dele, que enterra tudo em `history` e reseta o nome para o placeholder.
    const data = config
      ? { ...config, guidelines: JSON.stringify(normalizarParaFormulario(config.guidelines, marca?.name)) }
      : config;

    res.json({ data });
  } catch (error) {
    next(error);
  }
});

settingsRouter.put('/:slug/config', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: brandId, role } = await assertBrandAccess(req.params.slug as string, req.user?.userId, EDITORS);
    const { agentPrompt, primaryFonts, colors, guidelines, logoUrl, presentationConfig, ignoreAiCostLimit } = req.body;

    // O teto de custo de IA move gasto da marca: só quem administra decide.
    // A tela de Branding reenvia o valor atual a cada salvamento, então um EDITOR pode salvar com
    // o campo igual ao que já está; mudar o valor é que exige OWNER/ADMIN (recusado, não ignorado).
    if (!ADMIN_ROLES.includes(role)) {
      const atual = await prisma.brandConfig.findUnique({
        where: { brandId },
        select: { ignoreAiCostLimit: true },
      });
      const mudou = ignoreAiCostLimit !== undefined && !!ignoreAiCostLimit !== (atual?.ignoreAiCostLimit ?? false);
      if (mudou) {
        throw createError(403, 'Só o dono ou o administrador da marca altera o limite de custo de IA.');
      }
    }

    // O servidor baixa esta URL (normalização do logo): só endereço público é aceito.
    if (typeof logoUrl === 'string' && logoUrl.trim() && !isPublicHttpUrl(logoUrl.trim())) {
      throw createError(400, 'logoUrl precisa ser uma URL http(s) pública.');
    }

    // Mesma normalização do confirm-logo do brandbook: sem isto, salvar pela
    // página de Branding reintroduz o logo opaco que o outro caminho corrigiu.
    const logoFinal = typeof logoUrl === 'string' && logoUrl.trim()
      ? await normalizarLogoParaFundoEscuro(logoUrl)
      : logoUrl;

    const normalizedPresentationConfig =
      presentationConfig === undefined
        ? undefined
        : (presentationConfig as Prisma.InputJsonValue);

    const config = await prisma.brandConfig.upsert({
      where: { brandId },
      update: {
        agentPrompt, primaryFonts, colors, guidelines, logoUrl: logoFinal, presentationConfig: normalizedPresentationConfig,
        ignoreAiCostLimit,
      },
      create: {
        brandId,
        agentPrompt: agentPrompt || '',
        primaryFonts: primaryFonts || [],
        colors: colors || [],
        guidelines: guidelines || '',
        logoUrl: logoFinal,
        presentationConfig: normalizedPresentationConfig,
        ignoreAiCostLimit: !!ignoreAiCostLimit,
      },
    });

    // Sync Logo → Asset: sem isto, a logo salva pela página Branding ficava
    // invisível na Biblioteca de Mídia (só o confirm-logo do Brandbook criava
    // o Asset). Mesmo padrão do brands.ts confirm-logo.
    if (typeof logoFinal === 'string' && logoFinal.trim()) {
      const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { name: true } });
      const fileName = logoFinal.split('/').pop() ?? 'logo';
      const existingLogoAsset = await prisma.asset.findFirst({
        where: { brandId, source: 'branding' },
      });
      if (existingLogoAsset) {
        await prisma.asset.update({
          where: { id: existingLogoAsset.id },
          data: { url: logoFinal, name: fileName },
        });
      } else {
        const ext = fileName.split('.').pop()?.toLowerCase() ?? 'svg';
        const fileType = ext === 'svg' ? 'image/svg+xml'
          : ext === 'png' ? 'image/png'
          : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
          : 'image/png';
        await prisma.asset.create({
          data: {
            brandId,
            name: `Logo — ${brand?.name ?? req.params.slug}`,
            url: logoFinal,
            fileType,
            sizeBytes: 0,
            source: 'branding',
            tags: ['logo', 'branding'],
          },
        });
      }
    }

    res.json({ data: config });
  } catch (error) {
    next(error);
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

