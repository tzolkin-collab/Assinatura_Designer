import { Router, Response, NextFunction } from 'express';
import type { BrandRole } from '@prisma/client';
import { config } from '../config.js';
import prisma from '../lib/prisma.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { assertBrandAccess, ANY_MEMBER, EDITORS, ADMINS } from '../middleware/brandAccess.js';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateOAuthState,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  getCanvaUser,
  exportDesign,
  waitForExport,
} from '../lib/canvaClient.js';

export const canvaRouter = Router();

// ── Helper: get brand, exigindo vínculo do usuário (BrandMember) ──
// Antes comparava `brand.userId` (só o dono legacy). Como a entrega do produto passa
// pelo Canva, isso trancava a equipe fora do caminho de export.

async function getBrandBySlug(slug: string, userId?: string, roles: BrandRole[] = EDITORS) {
  await assertBrandAccess(slug, userId, roles);

  const brand = await prisma.brand.findUnique({
    where: { slug },
    include: { canvaIntegration: true },
  });
  if (!brand) throw createError(404, 'Brand not found');
  return brand;
}

// ── GET /api/canva/:slug/auth-url ──
// Generates the Canva OAuth authorization URL and stores PKCE verifier + state

canvaRouter.get('/:slug/auth-url', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Autoriza antes de qualquer coisa: quem não é membro não deve nem descobrir
    // se a integração está configurada.
    const slug = req.params.slug as string;
    const brand = await getBrandBySlug(slug, req.user?.userId, ADMINS);

    if (!config.canvaClientId || !config.canvaClientSecret) {
      throw createError(500, 'Canva API credentials are not configured');
    }

    // Generate PKCE values
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateOAuthState();

    // Store verifier and state so we can use them in the callback
    // Use upsert in case there's already an integration record
    await prisma.canvaIntegration.upsert({
      where: { brandId: brand.id },
      create: {
        brandId: brand.id,
        codeVerifier,
        oauthState: state,
        canvaAccessToken: '',  // placeholder, will be set in callback
        canvaRefreshToken: '', // placeholder, will be set in callback
        tokenExpiresAt: new Date(0),
      },
      update: {
        codeVerifier,
        oauthState: state,
      },
    });

    const authUrl = buildAuthorizationUrl(codeChallenge, state);
    res.json({ data: { authUrl, state } });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/canva/callback ──
// OAuth callback — exchanges the authorization code for tokens

canvaRouter.get('/callback', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code, state } = req.query;

    if (!code || typeof code !== 'string') {
      throw createError(400, 'Missing authorization code');
    }
    if (!state || typeof state !== 'string') {
      throw createError(400, 'Missing state parameter');
    }

    // Find the integration record with matching state
    const integration = await prisma.canvaIntegration.findFirst({
      where: { oauthState: state },
      include: { brand: true },
    });

    if (!integration) {
      throw createError(400, 'Invalid or expired OAuth state. Please restart the connection process.');
    }

    if (!integration.codeVerifier) {
      throw createError(500, 'Code verifier not found. Please restart the connection process.');
    }

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code, integration.codeVerifier);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Update integration with real tokens
    await prisma.canvaIntegration.update({
      where: { id: integration.id },
      data: {
        canvaAccessToken: tokens.access_token,
        canvaRefreshToken: tokens.refresh_token,
        tokenExpiresAt: expiresAt,
        codeVerifier: null, // Clear sensitive data
        oauthState: null,
      },
    });

    // Try to fetch Canva user ID
    try {
      const userInfo = await getCanvaUser(integration.brandId) as Record<string, unknown>;
      const profile = userInfo.profile as Record<string, unknown> | undefined;
      if (profile?.id) {
        await prisma.canvaIntegration.update({
          where: { id: integration.id },
          data: { canvaUserId: profile.id as string },
        });
      }
    } catch {
      // Non-critical: just log it
      console.warn('[Canva] Failed to fetch user profile after OAuth');
    }

    // Redirect back to the brand's Canva settings page
    const redirectUrl = `${config.corsOrigin}/${integration.brand.slug}/configuracoes/canva?connected=true`;
    res.redirect(redirectUrl);
  } catch (error) {
    next(error);
  }
});

// ── GET /api/canva/:slug/status ──
// Check if the brand has a Canva integration connected

canvaRouter.get('/:slug/status', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug as string;
    const brand = await getBrandBySlug(slug, req.user?.userId, ANY_MEMBER);

    const integration = brand.canvaIntegration;
    const isConnected = !!(
      integration &&
      integration.canvaAccessToken &&
      integration.canvaAccessToken.length > 0 &&
      integration.tokenExpiresAt.getTime() > 0
    );

    res.json({
      data: {
        connected: isConnected,
        canvaUserId: integration?.canvaUserId || null,
        expiresAt: integration?.tokenExpiresAt || null,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── DELETE /api/canva/:slug/disconnect ──
// Disconnect the Canva integration from a brand

canvaRouter.delete('/:slug/disconnect', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug as string;
    const brand = await getBrandBySlug(slug, req.user?.userId, ADMINS);

    if (brand.canvaIntegration) {
      await prisma.canvaIntegration.delete({
        where: { brandId: brand.id },
      });
    }

    res.json({ data: { disconnected: true } });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/canva/:slug/export ──
// Export a Canva design (triggers export and polls until complete)

canvaRouter.post('/:slug/export', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug as string;
    const { designId, format = 'png' } = req.body;

    if (!designId || typeof designId !== 'string') {
      throw createError(400, 'designId is required');
    }

    const validFormats = ['png', 'jpg', 'pdf', 'mp4', 'gif'];
    if (!validFormats.includes(format)) {
      throw createError(400, `Invalid format. Must be one of: ${validFormats.join(', ')}`);
    }

    const brand = await getBrandBySlug(slug, req.user?.userId);
    if (!brand.canvaIntegration) {
      throw createError(400, 'Canva is not connected for this brand');
    }

    // Start export
    const exportResult = await exportDesign(brand.id, designId, format) as Record<string, unknown>;
    const job = exportResult.job as Record<string, unknown> | undefined;
    const exportId = job?.id as string | undefined;

    if (!exportId) {
      throw createError(500, 'Failed to start Canva export');
    }

    // Poll until complete
    const finalResult = await waitForExport(brand.id, exportId);
    const finalJob = (finalResult as Record<string, unknown>).job as Record<string, unknown>;
    const urls = finalJob?.urls as string[] | undefined;

    // Update the post if we find one with this designId
    if (urls && urls.length > 0) {
      await prisma.post.updateMany({
        where: { canvaDesignId: designId, brandId: brand.id },
        data: {
          canvaExportUrl: urls[0],
          previewUrl: urls[0],
          status: 'READY',
        },
      });
    }

    res.json({
      data: {
        exportId,
        status: finalJob?.status,
        urls: urls || [],
      },
    });
  } catch (error) {
    next(error);
  }
});
