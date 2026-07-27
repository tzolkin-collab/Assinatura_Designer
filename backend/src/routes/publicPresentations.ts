import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { config } from '../config.js';
import { createError } from '../middleware/errorHandler.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { mergeSlidesIntoPost } from '../lib/postHelper.js';
import { isChatEnabled, addChatMessage, getChatMessages } from '../lib/presentationChat.js';

// Rota pública (sem sessão nossa) — quem acessa é qualquer visitante com o link,
// não um usuário logado. Nunca devolve brandId/createdById/status ou qualquer
// outro dado do dono; só o necessário pra renderizar o deck.
//
// EXCEÇÃO deliberada: se um Authorization Bearer válido vier junto (o designer
// abriu o próprio link já logado no app, pra apresentar), e esse usuário for
// membro da marca dona do post, a resposta ganha `isOwner`/`postId`/mensagens do
// chat — dá pro mesmo link servir de "tela de apresentador" pra quem publicou E
// de link comum pra plateia, sem precisar de um segundo link/token (mesmo
// princípio já usado no QR: "token do designer", não uma URL separada).
export const publicPresentationsRouter = Router();

/** Decodifica o Bearer se vier — nunca lança; ausência/token inválido = anônimo. */
function tryDecodeUserId(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const token = authHeader.split(' ')[1] ?? '';
    const decoded = jwt.verify(token, config.jwtSecret) as { userId: string };
    return decoded.userId ?? null;
  } catch {
    return null;
  }
}

async function isBrandMember(userId: string | null, brandId: string): Promise<boolean> {
  if (!userId) return false;
  const membership = await prisma.brandMember.findUnique({
    where: { userId_brandId: { userId, brandId } },
    select: { role: true },
  });
  return !!membership;
}

// GET /api/public/presentations/:slug
publicPresentationsRouter.get(
  '/:slug',
  rateLimit({ windowSec: 60, max: 60, keyPrefix: 'public-presentation-view' }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const slug = req.params.slug as string;
      const post = await prisma.post.findFirst({
        where: { publicSlug: slug, publishedAt: { not: null } },
        select: {
          id: true,
          brandId: true,
          name: true,
          content: true,
          hostingConfig: true,
          slides: { orderBy: { position: 'asc' } },
        },
      });
      if (!post) throw createError(404, 'Apresentação não encontrada ou não publicada');

      // O blob `content` só carrega metadado (width/height/fonts/...) — os slides de
      // verdade vivem na tabela relacional (mesmo motivo de GET /posts/:id). Sem isto
      // a apresentação pública chegava sempre "sem slides nenhum".
      const merged = mergeSlidesIntoPost(post);
      const isOwner = await isBrandMember(tryDecodeUserId(req), post.brandId);
      const chatEnabled = await isChatEnabled(slug);

      res.json({
        data: {
          name: merged.name,
          content: merged.content,
          hostingConfig: merged.hostingConfig ?? {},
          isOwner,
          ...(isOwner ? { postId: post.id } : {}),
          chat: { enabled: chatEnabled },
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// GET /api/public/presentations/:slug/chat — polling: plateia só confirma se está
// habilitado (pra saber se mostra a caixa de pergunta); o palestrante (dono
// autenticado) também recebe as mensagens.
publicPresentationsRouter.get(
  '/:slug/chat',
  rateLimit({ windowSec: 60, max: 60, keyPrefix: 'public-presentation-chat-get' }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const slug = req.params.slug as string;
      const post = await prisma.post.findFirst({
        where: { publicSlug: slug, publishedAt: { not: null } },
        select: { brandId: true },
      });
      if (!post) throw createError(404, 'Apresentação não encontrada ou não publicada');

      const enabled = await isChatEnabled(slug);
      const isOwner = await isBrandMember(tryDecodeUserId(req), post.brandId);
      const messages = isOwner ? await getChatMessages(slug) : [];

      res.json({ data: { enabled, messages } });
    } catch (error) {
      next(error);
    }
  },
);

// POST /api/public/presentations/:slug/chat — a plateia manda uma pergunta.
// Rate limit bem mais apertado que o de leitura: é o único ponto de escrita
// anônima desta rota inteira.
publicPresentationsRouter.post(
  '/:slug/chat',
  rateLimit({ windowSec: 60, max: 8, keyPrefix: 'public-presentation-chat-post' }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const slug = req.params.slug as string;
      const post = await prisma.post.findFirst({
        where: { publicSlug: slug, publishedAt: { not: null } },
        select: { id: true },
      });
      if (!post) throw createError(404, 'Apresentação não encontrada ou não publicada');

      const enabled = await isChatEnabled(slug);
      if (!enabled) throw createError(403, 'O palestrante não habilitou perguntas nesta apresentação.');

      const text = typeof req.body?.text === 'string' ? req.body.text : '';
      if (!text.trim()) throw createError(400, 'Mensagem vazia.');

      const message = await addChatMessage(slug, text);
      res.status(201).json({ data: { message } });
    } catch (error) {
      next(error);
    }
  },
);
