import { Router, Response, NextFunction } from 'express';
import { config } from '../config.js';
import prisma from '../lib/prisma.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateOAuthState,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  getCanvaUser,
} from '../lib/canvaClient.js';

// O Canva é conector do DESIGNER (por usuário), como o Asana e o Drive: é a pessoa
// que edita a arte, então a exportação cai na conta Canva DELA. Antes isto era
// por-marca (tabela CanvaIntegration + rotas /:slug/*); agora os tokens vivem no
// próprio User e o job de export usa o userId de quem pediu.
export const canvaRouter = Router();

// Rota que o browser acessa sem sessão nossa. O callback do OAuth chega como
// redirect do Canva, sem Authorization header — quem prova a identidade aqui é o
// `state` (gerado por nós e conferido no banco), não o JWT.
export const canvaPublicRouter = Router();

// ── GET /api/canva/auth-url ──
// Gera a URL de autorização do Canva e guarda PKCE verifier + state no usuário.
canvaRouter.get('/auth-url', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw createError(401, 'Não autenticado');

    if (!config.canvaClientId || !config.canvaClientSecret) {
      throw createError(500, 'Canva API credentials are not configured');
    }

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateOAuthState();

    await prisma.user.update({
      where: { id: userId },
      data: { canvaCodeVerifier: codeVerifier, canvaOauthState: state },
    });

    const authUrl = buildAuthorizationUrl(codeChallenge, state);
    res.json({ data: { authUrl, state } });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/canva/callback ──
// OAuth callback — troca o authorization code pelos tokens e grava no usuário.
canvaPublicRouter.get('/callback', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code, state } = req.query;

    if (!code || typeof code !== 'string') {
      throw createError(400, 'Missing authorization code');
    }
    if (!state || typeof state !== 'string') {
      throw createError(400, 'Missing state parameter');
    }

    // Recupera o usuário pelo state que geramos no auth-url.
    const user = await prisma.user.findFirst({ where: { canvaOauthState: state } });

    if (!user) {
      throw createError(400, 'Invalid or expired OAuth state. Please restart the connection process.');
    }
    if (!user.canvaCodeVerifier) {
      throw createError(500, 'Code verifier not found. Please restart the connection process.');
    }

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code, user.canvaCodeVerifier);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        canvaAccessToken: tokens.access_token,
        canvaRefreshToken: tokens.refresh_token,
        canvaTokenExpiry: expiresAt,
        canvaCodeVerifier: null, // limpa dado sensível transitório
        canvaOauthState: null,
      },
    });

    // Best-effort: guarda o id do perfil do Canva (aparece na tela de status).
    try {
      const userInfo = await getCanvaUser(user.id) as Record<string, unknown>;
      const profile = userInfo.profile as Record<string, unknown> | undefined;
      if (profile?.id) {
        await prisma.user.update({
          where: { id: user.id },
          data: { canvaUserId: profile.id as string },
        });
      }
    } catch {
      console.warn('[Canva] Failed to fetch user profile after OAuth');
    }

    // Volta para a tela global de integrações do designer.
    res.redirect(`${config.corsOrigin}/configuracoes/integracoes?connected=canva`);
  } catch (error) {
    next(error);
  }
});

// ── GET /api/canva/status ──
// Verifica se o usuário logado tem o Canva conectado.
canvaRouter.get('/status', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw createError(401, 'Não autenticado');

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { canvaAccessToken: true, canvaUserId: true, canvaTokenExpiry: true },
    });

    const isConnected = !!(user?.canvaAccessToken && user.canvaAccessToken.length > 0);

    res.json({
      data: {
        connected: isConnected,
        canvaUserId: user?.canvaUserId ?? null,
        expiresAt: user?.canvaTokenExpiry ?? null,
      },
    });
  } catch (error) {
    next(error);
  }
});
