// Hospedagem pública de apresentações (Fase 5, Fatia 1 — navegação). Ao contrário
// de um convite (lib/invites.ts), o slug aqui NÃO é um segredo: é o próprio
// identificador da URL pública, então fica em texto puro no banco (dá pra buscar
// direto por ele, sem hash) — a intenção é justamente ser encontrável por quem
// tem o link.

import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import prisma from './prisma.js';
import { createError } from '../middleware/errorHandler.js';
import { clearChat } from './presentationChat.js';

export interface HostingConfig {
  autoplay?: boolean;
  showCounter?: boolean;
}

const MAX_SLUG_ATTEMPTS = 5;

function generateSlug(): string {
  // 9 bytes = 72 bits de entropia, url-safe — mesmo padrão de lib/invites.ts e
  // lib/connectorOAuth.ts, encurtado (aqui não é um segredo, só precisa ser
  // improvável de adivinhar por acaso).
  return crypto.randomBytes(9).toString('base64url');
}

/**
 * Publica um post como apresentação hospedada: gera um slug único, marca
 * publishedAt e grava os toggles. Se já estava publicado, apenas atualiza os
 * toggles e gera um slug novo (republicar não deveria reaproveitar link antigo
 * silenciosamente — quem tinha o link velho não deve continuar acessando).
 */
export async function publishPost(postId: string, hostingConfig: HostingConfig): Promise<{ publicSlug: string; publishedAt: Date }> {
  const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
  if (!post) throw createError(404, 'Post não encontrado');

  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
    const publicSlug = generateSlug();
    try {
      const updated = await prisma.post.update({
        where: { id: postId },
        data: { publicSlug, publishedAt: new Date(), hostingConfig: hostingConfig as Prisma.InputJsonValue },
        select: { publicSlug: true, publishedAt: true },
      });
      return { publicSlug: updated.publicSlug!, publishedAt: updated.publishedAt! };
    } catch (err) {
      // P2002 = violação de unique constraint (slug colidiu) — tenta de novo com
      // outro slug. Qualquer outro erro propaga.
      const code = (err as { code?: string } | undefined)?.code;
      if (code !== 'P2002' || attempt === MAX_SLUG_ATTEMPTS) throw err;
    }
  }
  throw createError(500, 'Não foi possível gerar um link único para a apresentação');
}

/** Despublica: limpa slug/publishedAt. Mantém hostingConfig pra republicar rápido. */
export async function unpublishPost(postId: string): Promise<void> {
  const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true, publicSlug: true } });
  if (!post) throw createError(404, 'Post não encontrado');

  await prisma.post.update({
    where: { id: postId },
    data: { publicSlug: null, publishedAt: null },
  });

  // Republicar gera slug novo, então o chat do slug antigo nunca mais seria
  // alcançável de qualquer forma — limpa já em vez de esperar o TTL expirar sozinho.
  if (post.publicSlug) await clearChat(post.publicSlug);
}
