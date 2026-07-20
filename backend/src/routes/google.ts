import { Router, type Response as ExpressResponse, type NextFunction } from 'express';
import createError from 'http-errors';
import prisma from '../lib/prisma.js';
import { config } from '../config.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';

// Alias para evitar conflito entre Express.Response e globalThis.Response (fetch)
type Res = ExpressResponse;

export const googleRouter = Router();
export const googlePublicRouter = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

const GOOGLE_DRIVE_API = 'https://www.googleapis.com/drive/v3';

/**
 * Retorna um access_token válido para o usuário. Se o token expirou (ou está
 * a menos de 5 min de expirar), usa o refresh_token para renová-lo.
 */
async function getValidGoogleToken(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleAccessToken: true, googleRefreshToken: true, googleTokenExpiry: true },
  });

  if (!user?.googleAccessToken) {
    throw createError(403, 'Google Drive não conectado para este usuário');
  }

  const bufferMs = 5 * 60 * 1000;
  const expiresAtMs = user.googleTokenExpiry?.getTime() ?? 0;

  // Token ainda válido — retorna direto
  if (expiresAtMs - bufferMs > Date.now()) {
    return user.googleAccessToken;
  }

  // Precisa renovar
  if (!user.googleRefreshToken) {
    throw createError(401, 'Refresh token do Google ausente. Reconecte o Drive nas integrações.');
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw createError(500, 'Credenciais do Google não configuradas no .env');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: user.googleRefreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('[Google] Token refresh failed:', text);
    throw createError(401, 'Falha ao renovar token do Google. Reconecte o Drive.');
  }

  const tokens = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };

  const updateData: Record<string, unknown> = {
    googleAccessToken: tokens.access_token,
    googleTokenExpiry: new Date(Date.now() + tokens.expires_in * 1000),
  };
  if (tokens.refresh_token) {
    updateData.googleRefreshToken = tokens.refresh_token;
  }

  await prisma.user.update({ where: { id: userId }, data: updateData });

  return tokens.access_token;
}

/** Faz uma requisição autenticada à Google Drive API. */
async function driveFetch(accessToken: string, path: string): Promise<globalThis.Response> {
  return fetch(`${GOOGLE_DRIVE_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// ── GET /api/google/auth-url ──
// Retorna a URL real de autorização do Google OAuth2
googleRouter.get('/auth-url', requireAuth, async (req: AuthRequest, res: Res, next: NextFunction) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || 'http://localhost:4000/api/google/callback';

    if (!clientId) {
      throw createError(500, 'As credenciais da API do Google (GOOGLE_CLIENT_ID) não estão configuradas no .env');
    }

    const userId = req.user?.userId;
    if (!userId) throw createError(401, 'Não autenticado');

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.metadata.readonly',
      access_type: 'offline',
      prompt: 'consent',
      state: userId,
    });

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    // Wrappado em "data" para corresponder exatamente à expectativa do frontend
    res.json({ data: { url } });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/google/callback ──
// Callback público do Google OAuth2 (faz a troca real do code pelo token de acesso)
googlePublicRouter.get('/callback', async (req, res, next) => {
  try {
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

    if (error) {
      throw createError(400, `Google OAuth error: ${error}`);
    }
    if (!code || !state) {
      throw createError(400, 'Code e state são obrigatórios.');
    }

    const userId = state;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw createError(404, 'Usuário não encontrado.');
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || 'http://localhost:4000/api/google/callback';

    if (!clientId || !clientSecret) {
      throw createError(500, 'Credenciais do Google não configuradas no .env');
    }

    // Faz a troca do code temporário pelos tokens reais de acesso e atualização
    const tokenParams = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams.toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw createError(tokenResponse.status, `Falha na troca de tokens do Google: ${errorText}`);
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    const updateData: Record<string, unknown> = {
      googleAccessToken: tokens.access_token,
      googleTokenExpiry: new Date(Date.now() + tokens.expires_in * 1000),
    };

    if (tokens.refresh_token) {
      updateData.googleRefreshToken = tokens.refresh_token;
    }

    // Salva os tokens reais no banco de dados
    await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    // Redireciona o usuário de volta para o painel de integrações do frontend
    const corsOrigins = config.corsOrigin.split(',').map((s) => s.trim()).filter(Boolean);
    const frontendUrl = corsOrigins[0] || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/configuracoes/integracoes?connected=google`);
  } catch (error) {
    next(error);
  }
});

// ── GET /api/google/status ──
googleRouter.get('/status', async (req: AuthRequest, res: Res, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user?.userId }, select: { googleAccessToken: true } });
    res.json({ connected: !!user?.googleAccessToken });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/google/files ──
// Lista os arquivos REAIS do Google Drive do usuário conectado
googleRouter.get('/files', async (req: AuthRequest, res: Res, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw createError(401, 'Não autenticado');

    const accessToken = await getValidGoogleToken(userId);

    // Busca os 30 arquivos mais recentes (imagens, vídeos, pastas e PDFs)
    const query = req.query.q as string | undefined;
    const folderId = req.query.folderId as string | undefined;

    let q = 'trashed = false';
    if (folderId) {
      q += ` and '${folderId}' in parents`;
    }
    if (query) {
      q += ` and name contains '${query.replace(/'/g, "\\'")}'`;
    }

    const fields = 'files(id,name,mimeType,thumbnailLink,webViewLink,webContentLink,size,modifiedTime)';
    const params = new URLSearchParams({
      q,
      fields,
      orderBy: 'modifiedTime desc',
      pageSize: '30',
    });

    const driveRes = await driveFetch(accessToken, `/files?${params.toString()}`);

    if (!driveRes.ok) {
      const text = await driveRes.text();
      throw createError(driveRes.status, `Falha ao listar arquivos do Google Drive: ${text}`);
    }

    const json = (await driveRes.json()) as {
      files?: Array<{
        id: string;
        name: string;
        mimeType: string;
        thumbnailLink?: string;
        webViewLink?: string;
        webContentLink?: string;
        size?: string;
        modifiedTime?: string;
      }>;
    };

    const files = (json.files ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      thumbnailLink: f.thumbnailLink ?? null,
      webViewLink: f.webViewLink ?? null,
      webContentLink: f.webContentLink ?? null,
      size: f.size ? parseInt(f.size, 10) : null,
      modifiedTime: f.modifiedTime ?? null,
    }));

    res.json({ data: files });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/google/files/:fileId/download ──
// Baixa o conteúdo real de um arquivo do Google Drive e retorna em base64
googleRouter.get('/files/:fileId/download', async (req: AuthRequest, res: Res, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw createError(401, 'Não autenticado');

    const { fileId } = req.params;
    const accessToken = await getValidGoogleToken(userId);

    // Primeiro busca os metadados do arquivo
    const metaRes = await driveFetch(accessToken, `/files/${fileId}?fields=name,mimeType,size`);
    if (!metaRes.ok) {
      const text = await metaRes.text();
      throw createError(metaRes.status, `Arquivo não encontrado no Google Drive: ${text}`);
    }

    const meta = (await metaRes.json()) as { name: string; mimeType: string; size?: string };

    // Limite de segurança: não baixar arquivos maiores que 50MB
    const sizeBytes = meta.size ? parseInt(meta.size, 10) : 0;
    if (sizeBytes > 50 * 1024 * 1024) {
      throw createError(413, `Arquivo muito grande (${Math.round(sizeBytes / 1024 / 1024)}MB). Limite: 50MB.`);
    }

    // Google Docs/Sheets/Slides não suportam download direto — exporta como PDF
    const isGoogleDoc = meta.mimeType.startsWith('application/vnd.google-apps.');
    let downloadUrl: string;
    let finalMimeType = meta.mimeType;

    if (isGoogleDoc) {
      // Exporta Google Docs como PDF
      downloadUrl = `${GOOGLE_DRIVE_API}/files/${fileId}/export?mimeType=application/pdf`;
      finalMimeType = 'application/pdf';
    } else {
      downloadUrl = `${GOOGLE_DRIVE_API}/files/${fileId}?alt=media`;
    }

    const fileRes = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!fileRes.ok) {
      throw createError(502, 'Falha ao baixar o arquivo do Google Drive');
    }

    const arrayBuffer = await fileRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.json({
      data: {
        name: meta.name,
        mimeType: finalMimeType,
        dataBase64: buffer.toString('base64'),
      },
    });
  } catch (error) {
    next(error);
  }
});
