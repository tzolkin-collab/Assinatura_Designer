import { Router } from 'express';
import { randomUUID } from 'crypto';
import { AuthRequest } from '../middleware/auth.js';
import { createError } from '../middleware/errorHandler.js';
import { getSession, updateSession } from '../lib/redis.js';
import { createBrainSession, initBrainHandlers, reconnectSession } from '../agents/brain/index.js';
import { buildBrandContextSummary, resolveBrandContext } from '../lib/brandContext.js';
import { assertBrandAccess, EDITORS } from '../middleware/brandAccess.js';
import prisma from '../lib/prisma.js';

export const fabricaRouter = Router();

// Registra handlers WebSocket do Brain (roda 1x no boot)
initBrainHandlers();

/**
 * Uma pasta só é destino válido se for DESTA marca. Sem esta checagem, mandar um
 * folderId qualquer no body deixaria o deck cair na pasta de outro cliente — a marca
 * é a fronteira de isolamento do produto inteiro.
 *
 * `null`/ausente é legítimo e quer dizer "raiz" (o default de sempre).
 */
async function resolveFolderDaMarca(folderId: unknown, brandSlug: string): Promise<string | null> {
  if (folderId === undefined || folderId === null || folderId === '') return null;
  if (typeof folderId !== 'string') throw createError(400, 'folderId inválido');

  const folder = await prisma.folder.findFirst({
    where: { id: folderId, brand: { slug: brandSlug } },
    select: { id: true },
  });
  if (!folder) throw createError(404, 'Pasta não encontrada nesta marca.');
  return folder.id;
}

// ── POST /api/fabrica/sessions — cria sessão ──────────────────────────────────

fabricaRouter.post('/sessions', async (req: AuthRequest, res, next) => {
  try {
    const { brandSlug, folderId } = req.body as { brandSlug?: string; folderId?: string | null };
    if (!brandSlug) return next(createError(400, 'brandSlug obrigatório'));

    const userId = req.user?.userId;

    // O slug vem no body, então não há :slug pro middleware pegar — checagem explícita.
    // `resolveBrandContext` recebe userId mas não autoriza nada.
    await assertBrandAccess(brandSlug, userId, EDITORS);

    const brand = await resolveBrandContext(brandSlug).catch((error) => {
      throw error;
    });

    const pastaDestino = await resolveFolderDaMarca(folderId, brandSlug);

    const sessionId = randomUUID();

    await createBrainSession({
      sessionId,
      brandSlug,
      userId,
      brandContextSummary: buildBrandContextSummary(brand),
      presentationConfig: brand.presentationConfig,
      folderId: pastaDestino,
    });

    res.json({
      sessionId,
      phase: 'listening',
      reviewMode: brand.presentationConfig?.autoMode ? 'auto' : 'manual',
      folderId: pastaDestino,
    });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/fabrica/sessions/:sessionId/folder — escolhe a pasta de destino ─
//
// Existe como rota separada porque a sessão nasce no load da página, antes de o
// usuário ter escolhido qualquer coisa. Sem isto, a pasta só poderia ser decidida
// num momento em que ninguém ainda sabe qual é.

fabricaRouter.patch('/sessions/:sessionId/folder', async (req: AuthRequest, res, next) => {
  try {
    const sessionId = req.params['sessionId'] as string;
    const { folderId } = req.body as { folderId?: string | null };

    const session = await getSession(sessionId);
    if (!session) return next(createError(404, 'Sessão não encontrada'));

    // A sessão diz de que marca ela é; o acesso é checado contra ESSA marca, não
    // contra o que o cliente mandar no body.
    await assertBrandAccess(session.brandSlug, req.user?.userId, EDITORS);

    const pastaDestino = await resolveFolderDaMarca(folderId, session.brandSlug);
    await updateSession(sessionId, { folderId: pastaDestino });

    res.json({ folderId: pastaDestino });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/fabrica/sessions/:sessionId — estado para reconexão ──────────────

fabricaRouter.get('/sessions/:sessionId', async (req: AuthRequest, res, next) => {
  try {
    const sessionId = req.params['sessionId'] as string;
    const userId = req.user?.userId;

    const session = await reconnectSession(sessionId, userId);
    if (!session) return next(createError(404, 'Sessão não encontrada'));

    res.json({
      id: session.id,
      phase: session.phase,
      workerStatus: session.workerStatus,
      brandSlug: session.brandSlug,
      reviewMode: session.reviewMode,
      activeQuestion: session.activeQuestion,
      messageCount: session.messages.length,
      hasDesign: session.currentDesign.length > 0,
    });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/fabrica/sessions/:sessionId — limpa sessão ───────────────────

fabricaRouter.delete('/sessions/:sessionId', async (req: AuthRequest, res, next) => {
  try {
    const sessionId = req.params['sessionId'] as string;
    const session = await getSession(sessionId);
    if (!session) return next(createError(404, 'Sessão não encontrada'));
    if (session.userId && req.user?.userId && session.userId !== req.user.userId) {
      return next(createError(403, 'Acesso negado'));
    }
    // Redis TTL cuida da expiração — apenas retorna ok
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
