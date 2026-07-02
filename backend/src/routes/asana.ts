import { Router } from 'express';
import * as Asana from 'asana';
import prisma from '../lib/prisma.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';

export const asanaRouter = Router();

async function getAsanaClient(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { asanaToken: true } });
  if (!user?.asanaToken) throw createError(403, 'Asana não configurado para este usuário');

  const client = (Asana as unknown as { ApiClient: { instance: { authentications: Record<string, { accessToken: string }> } } }).ApiClient.instance;
  client.authentications['token'].accessToken = user.asanaToken;
  return client;
}

// ── GET /api/asana/projects ───────────────────────────────────────────────────

asanaRouter.get('/projects', async (req: AuthRequest, res, next) => {
  try {
    if (!req.user?.userId) return next(createError(401, 'Não autenticado'));
    await getAsanaClient(req.user.userId);

    type AsanaSDK = {
      UsersApi: new () => { getUser: (id: string, opts: object) => Promise<{ data: { workspaces?: { gid: string }[] } }> };
      ProjectsApi: new () => { getProjectsForWorkspace: (ws: string, opts: object) => Promise<{ data: unknown[] }> };
    };
    const sdk = Asana as unknown as AsanaSDK;

    // Resolve workspaces from the authenticated user
    const usersApi = new sdk.UsersApi();
    const me = await usersApi.getUser('me', { opt_fields: 'workspaces' });
    const workspaces: { gid: string }[] = me.data?.workspaces ?? [];

    const projectsApi = new sdk.ProjectsApi();
    const allProjects: unknown[] = [];

    for (const ws of workspaces) {
      const r = await projectsApi.getProjectsForWorkspace(ws.gid, { limit: 50, archived: false });
      allProjects.push(...r.data);
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
    await getAsanaClient(req.user.userId);

    const TasksApi = (Asana as unknown as { TasksApi: new () => { getTasksForProject: (id: string, opts: object) => Promise<{ data: unknown[] }> } }).TasksApi;
    const api = new TasksApi();
    const result = await api.getTasksForProject(req.params['projectId'] as string, {
      limit: 100,
      opt_fields: 'name,completed,due_on,assignee.name,notes,permalink_url',
    });

    res.json({ data: result.data });
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
