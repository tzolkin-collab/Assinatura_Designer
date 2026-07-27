import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { assertBrandAccess, ANY_MEMBER, EDITORS } from '../middleware/brandAccess.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import {
  startBenchmarkDiscovery,
  answerBenchmarkQuestion,
  confirmBenchmarkCandidates,
  getBenchmarkSession,
} from '../lib/benchmarkOrchestrator.js';

export const benchmarkRouter = Router();

const startSchema = z.object({
  recommended: z.array(z.string().trim().min(1)).max(5, 'No máximo 5 concorrentes recomendados.').default([]),
});

const responderSchema = z.object({
  answer: z.string().trim().min(1, 'Resposta obrigatória.'),
});

const confirmarSchema = z.object({
  candidates: z.array(z.object({ id: z.string(), confirmed: z.boolean() })).min(1, 'Nenhum candidato pra confirmar.'),
});

// POST /api/settings/:slug/referencias/benchmark — inicia (ou reinicia) a
// descoberta automática de concorrentes. Responde imediatamente; a descoberta
// + coleta rodam em background, o front faz polling via GET.
benchmarkRouter.post('/:slug/referencias/benchmark', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug as string;
    const brand = await assertBrandAccess(slug, req.user?.userId, EDITORS);
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) throw createError(400, parsed.error.errors[0]?.message ?? 'Corpo da requisição inválido');

    res.status(202).json({ data: { status: 'DISCOVERING', recommended: parsed.data.recommended, candidates: [], round: 0, updatedAt: new Date().toISOString() } });

    startBenchmarkDiscovery(brand.id, slug, parsed.data.recommended).catch(console.error);
  } catch (error) {
    next(error);
  }
});

// GET /api/settings/:slug/referencias/benchmark — polling do estado atual.
benchmarkRouter.get('/:slug/referencias/benchmark', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug as string;
    const brand = await assertBrandAccess(slug, req.user?.userId, ANY_MEMBER);
    const session = await getBenchmarkSession(brand.id);
    res.json({ data: session });
  } catch (error) {
    next(error);
  }
});

// POST /api/settings/:slug/referencias/benchmark/responder — resposta do
// usuário a uma pergunta de ambiguidade levantada pelo bot durante a descoberta.
benchmarkRouter.post('/:slug/referencias/benchmark/responder', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug as string;
    const brand = await assertBrandAccess(slug, req.user?.userId, EDITORS);
    const parsed = responderSchema.safeParse(req.body);
    if (!parsed.success) throw createError(400, parsed.error.errors[0]?.message ?? 'Corpo da requisição inválido');

    const session = await getBenchmarkSession(brand.id);
    if (!session || session.status !== 'AWAITING_QUESTION') {
      throw createError(400, 'Não há pergunta pendente pra responder.');
    }

    res.status(202).json({ data: { ...session, status: 'DISCOVERING' } });

    answerBenchmarkQuestion(brand.id, slug, parsed.data.answer).catch(console.error);
  } catch (error) {
    next(error);
  }
});

// POST /api/settings/:slug/referencias/benchmark/confirmar — usuário confirma
// (ou desmarca) os candidatos coletados; dispara a análise de verdade dos
// confirmados, reusando o material já coletado (sem re-chamar a Apify).
benchmarkRouter.post('/:slug/referencias/benchmark/confirmar', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug as string;
    const brand = await assertBrandAccess(slug, req.user?.userId, EDITORS);
    const parsed = confirmarSchema.safeParse(req.body);
    if (!parsed.success) throw createError(400, parsed.error.errors[0]?.message ?? 'Corpo da requisição inválido');

    const session = await getBenchmarkSession(brand.id);
    if (!session || session.status !== 'AWAITING_CONFIRMATION') {
      throw createError(400, 'Não há candidatos aguardando confirmação.');
    }

    res.status(202).json({ data: { ...session, status: 'ANALYZING' } });

    confirmBenchmarkCandidates(brand.id, slug, parsed.data.candidates).catch(console.error);
  } catch (error) {
    next(error);
  }
});
