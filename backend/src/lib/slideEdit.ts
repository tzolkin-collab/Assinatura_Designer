import type { Prisma, VersionSource } from '@prisma/client';
import prisma from './prisma.js';
import { createError } from '../middleware/errorHandler.js';
import { buildSlideDocument, sanitizeSlideCss, sanitizeSlideHtml } from './htmlDesign.js';
import { mergeSlidesIntoPost, type PostWithSlides } from './postHelper.js';
import { snapshotPost } from './postVersions.js';

/**
 * A porta de escrita do código de UM slide (html/css). Compartilhada pela rota do editor
 * (`PUT /posts/:id/slides/:index/code`) e pela ferramenta MCP `update_slide`, para as duas passarem
 * pela mesma sanitização e pelo mesmo snapshot — nada de segunda implementação que se afasta da primeira.
 *
 * O código chega CRU e sai SANITIZADO (mesmo DOMPurify da geração: o que passar disto executa no chromium
 * do raster). A versão anterior é guardada antes de sobrescrever: errou, restaura.
 *
 * Autorização (quem pode editar este post) é de quem chama: aqui só se confere o conteúdo.
 */
export interface ApplySlideCodeInput {
  postId: string;
  /** Posição do slide, a partir de 0. */
  index: number;
  html: string;
  css?: string;
  userId?: string;
  /** De onde veio a edição, para o histórico de versões. */
  source: VersionSource;
  label?: string;
}

export interface AppliedSlide {
  slideIndex: number;
  slide: { html: string; css?: string };
  slideCount: number;
}

export async function applySlideCode(input: ApplySlideCodeInput): Promise<AppliedSlide> {
  const { postId, index: idx, html, css } = input;
  if (typeof html !== 'string' || !html.trim()) throw createError(400, 'html é obrigatório');

  const post = await prisma.post.findFirst({
    where: { id: postId },
    include: { slides: { orderBy: { position: 'asc' } } },
  });
  if (!post) throw createError(404, 'Post não encontrado');

  const content = mergeSlidesIntoPost(post as unknown as PostWithSlides).content as unknown as {
    kind?: string;
    width?: number;
    height?: number;
    fonts?: string[];
    slides?: Array<{ html: string; css?: string }>;
  };
  if (content?.kind !== 'html-design' || !Array.isArray(content.slides)) {
    throw createError(400, 'Edição de código disponível apenas para designs html-design');
  }
  if (idx < 0 || idx >= content.slides.length) throw createError(400, 'slide fora do limite');

  // Sanitização server-side: NUNCA confiar no que veio do cliente.
  const clean = { html: sanitizeSlideHtml(html), css: css ? sanitizeSlideCss(css) : undefined };
  if (!clean.html.trim()) throw createError(400, 'html ficou vazio após a sanitização');

  await snapshotPost(post.id, {
    source: input.source,
    label: input.label ?? `Antes da edição de código do slide ${idx + 1}`,
    userId: input.userId,
  });

  const existingSlide = post.slides.find((s) => s.position === idx);
  if (!existingSlide) throw createError(404, 'Slide não encontrado na tabela relacional');
  await prisma.slide.update({
    where: { id: existingSlide.id },
    data: {
      contentJson: clean as unknown as Prisma.InputJsonValue,
      htmlRender: buildSlideDocument(clean, content.fonts ?? ['Inter'], content.width ?? 1080, content.height ?? 1080),
    },
  });
  await prisma.post.update({ where: { id: post.id }, data: { updatedAt: new Date() } });

  return { slideIndex: idx, slide: clean, slideCount: content.slides.length };
}
