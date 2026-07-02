import { Router } from 'express';
import { randomUUID } from 'crypto';
import { AuthRequest } from '../middleware/auth.js';
import { createError } from '../middleware/errorHandler.js';
import { getSession } from '../lib/redis.js';
import { createBrainSession, initBrainHandlers, reconnectSession } from '../agents/brain/index.js';
import { buildBrandContextSummary, resolveBrandContext } from '../lib/brandContext.js';

export const fabricaRouter = Router();

// Registra handlers WebSocket do Brain (roda 1x no boot)
initBrainHandlers();

// ── POST /api/fabrica/sessions — cria sessão ──────────────────────────────────

fabricaRouter.post('/sessions', async (req: AuthRequest, res, next) => {
  try {
    const { brandSlug } = req.body as { brandSlug?: string };
    if (!brandSlug) return next(createError(400, 'brandSlug obrigatório'));

    const userId = req.user?.userId;
    const brand = await resolveBrandContext(brandSlug, userId).catch((error) => {
      throw error;
    });

    const sessionId = randomUUID();

    await createBrainSession({
      sessionId,
      brandSlug,
      userId,
      brandContextSummary: buildBrandContextSummary(brand),
      presentationConfig: brand.presentationConfig,
    });

    res.json({ sessionId, phase: 'listening', reviewMode: brand.presentationConfig?.autoMode ? 'auto' : 'manual' });
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
