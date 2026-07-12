import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';

export const asanaRouter = Router();

const ASANA_API_BASE = 'https://app.asana.com/api/1.0';

// Antes, o token era escrito num SINGLETON global do SDK
// (Asana.ApiClient.instance.authentications). Sob concorrência, a requisição de
// um usuário podia executar com o token de outro (vazamento cross-tenant),
// porque o `await` entre "setar token" e "chamar a API" permitia interleaving.
// Agora cada request é stateless: o token do usuário vai no header, sem estado
// compartilhado.
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

// ── GET /api/asana/projects ───────────────────────────────────────────────────

asanaRouter.get('/projects', async (req: AuthRequest, res, next) => {
  try {
    if (!req.user?.userId) return next(createError(401, 'Não autenticado'));
    const token = await getAsanaToken(req.user.userId);

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

asanaRouter.get('/projects/:projectId/tasks', async (req: AuthRequest, res, next) => {
  try {
    if (!req.user?.userId) return next(createError(401, 'Não autenticado'));
    const token = await getAsanaToken(req.user.userId);

    const projectId = req.params['projectId'] as string;
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

// ── GET /api/asana/status — verifica se token está configurado ────────────────

asanaRouter.get('/status', async (req: AuthRequest, res, next) => {
  try {
    if (!req.user?.userId) return next(createError(401, 'Não autenticado'));
    const user = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { asanaToken: true } });
    res.json({ connected: !!user?.asanaToken });
  } catch (err) {
    next(err);
  }
});
