import { Router, Response, NextFunction } from 'express';
import { config } from '../config.js';
import prisma from '../lib/prisma.js';
import { createError } from '../middleware/errorHandler.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

export const asanaRouter = Router();
export const asanaPublicRouter = Router();

// ── GET /api/asana/auth-url ──
asanaRouter.get('/auth-url', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!config.asanaClientId || !config.asanaClientSecret) {
      throw createError(500, 'Asana API credentials are not configured');
    }

    const userId = req.user?.userId;
    // O state serve para segurança contra CSRF e para recuperar o usuário no callback
    const state = userId; 

    const params = new URLSearchParams({
      client_id: config.asanaClientId,
      redirect_uri: config.asanaRedirectUri,
      response_type: 'code',
      state: state || '',
    });

    const url = `https://app.asana.com/-/oauth_authorize?${params.toString()}`;
    res.json({ data: { url } });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/asana/callback ──
asanaPublicRouter.get('/callback', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

    if (error) {
      throw createError(400, `Asana OAuth error: ${error}`);
    }
    if (!code || !state) {
      throw createError(400, 'Code and state are required');
    }

    // O state é o userId salvo na URL de autorização
    const userId = state;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw createError(400, 'Usuário não encontrado');
    }

    // Faz a troca do code pelo token
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.asanaClientId,
      client_secret: config.asanaClientSecret,
      redirect_uri: config.asanaRedirectUri,
      code,
    });

    const tokenResponse = await fetch('https://app.asana.com/-/oauth_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams.toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw createError(tokenResponse.status, `Failed to exchange token: ${errorText}`);
    }

    const tokens = (await tokenResponse.json()) as { access_token: string };

    await prisma.user.update({
      where: { id: userId },
      data: { asanaToken: tokens.access_token },
    });

    res.redirect(`${config.corsOrigin}/configuracoes?connected=asana`);
  } catch (error) {
    next(error);
  }
});
