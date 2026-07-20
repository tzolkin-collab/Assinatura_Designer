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

    // Redirect back to the brand's integrations settings page
    res.redirect(`${config.corsOrigin}/configuracoes/integracoes?connected=asana`);
  } catch (error) {
    next(error);
  }
});

const ASANA_API_BASE = 'https://app.asana.com/api/1.0';

async function getAsanaToken(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { asanaToken: true } });
  if (!user?.asanaToken) throw createError(403, 'Asana não configurado para este usuário');
  return user.asanaToken;
}

async function asanaFetch<T = unknown>(token: string, path: string): Promise<T> {
  const res = await fetch(`${ASANA_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 401) throw createError(401, 'Token do Asana inválido ou expirado');
    throw createError(502, `Falha ao consultar o Asana (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// ── GET /api/asana/status — verifica se token está configurado ────────────────

asanaRouter.get('/status', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw createError(401, 'Não autenticado');
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { asanaToken: true } });
    res.json({ connected: !!user?.asanaToken });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/asana/projects ───────────────────────────────────────────────────

asanaRouter.get('/projects', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw createError(401, 'Não autenticado');
    const token = await getAsanaToken(userId);

    const me = await asanaFetch<{ data?: { workspaces?: { gid: string }[] } }>(token, '/users/me?opt_fields=workspaces');
    const workspaces = me.data?.workspaces ?? [];

    const allProjects: unknown[] = [];
    for (const ws of workspaces) {
      const r = await asanaFetch<{ data?: unknown[] }>(
        token,
        `/workspaces/${encodeURIComponent(ws.gid)}/projects?limit=50&archived=false&opt_fields=name`,
      );
      allProjects.push(...(r.data ?? []));
    }

    res.json({ data: allProjects });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/asana/projects/:projectId/tasks ──────────────────────────────────

asanaRouter.get('/projects/:projectId/tasks', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw createError(401, 'Não autenticado');
    const token = await getAsanaToken(userId);

    const projectId = req.params.projectId as string;
    const opts = 'limit=100&opt_fields=name,completed,due_on,assignee.name,notes,permalink_url';
    const result = await asanaFetch<{ data?: unknown[] }>(
      token,
      `/projects/${encodeURIComponent(projectId)}/tasks?${opts}`,
    );

    res.json({ data: result.data ?? [] });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/asana/tasks/:taskGid/attachments ──
asanaRouter.get('/tasks/:taskGid/attachments', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw createError(401, 'Não autenticado');
    const token = await getAsanaToken(userId);
    const taskGid = req.params.taskGid as string;

    const result = await asanaFetch<{
      data?: Array<{ gid: string; name: string; mime_type?: string; download_url?: string }>
    }>(token, `/tasks/${encodeURIComponent(taskGid)}/attachments?opt_fields=name,mime_type,download_url`);

    const attachments = result.data ?? [];
    const base64Attachments: Array<{ name: string; mimeType: string; dataBase64: string }> = [];

    for (const att of attachments) {
      if (!att.download_url) continue;
      const mime = att.mime_type || 'application/octet-stream';
      const isImg = mime.startsWith('image/');
      const isVid = mime.startsWith('video/');

      if (isImg || isVid) {
        try {
          const fileRes = await fetch(att.download_url);
          if (fileRes.ok) {
            const arrayBuffer = await fileRes.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            base64Attachments.push({
              name: att.name,
              mimeType: mime,
              dataBase64: buffer.toString('base64'),
            });
          }
        } catch (err) {
          console.warn(`[AsanaSync] Falha ao baixar anexo ${att.name}:`, err);
        }
      }
    }

    res.json({ data: base64Attachments });
  } catch (err) {
    next(err);
  }
});


