import type { Prisma } from '@prisma/client';
import prisma from './prisma.js';
import { buildSlideDocument, type HtmlDesignSlide } from './htmlDesign.js';
import { compileSlideToDocument } from './designIR/compiler.js';
import type { SlideNode } from './designIR/types.js';

/** Linha da tabela relacional `slides` (a fonte de verdade de cada slide). */
interface SlideRow {
  id: string;
  position: number;
  contentJson: unknown;
  metadata?: unknown;
}

/** Post com a relação `slides` incluída. `content` fica `unknown`: o formato varia
 *  por `kind` (ir-design, html-design, ...) e quem lê já estreita o tipo. */
export interface PostWithSlides {
  content: unknown;
  slides?: SlideRow[];
  [key: string]: unknown;
}

/** Conteúdo do post, visto de dentro deste módulo. */
interface PostContent {
  kind?: string;
  slides?: unknown[];
  ir?: { slides?: unknown[]; [key: string]: unknown };
  width?: unknown;
  height?: unknown;
  fonts?: unknown;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rebuilds the unified post.content.slides array from individual rows in the relational Slide table.
 * This guarantees 100% backward compatibility with the frontend and the rest of the application
 * that expects a single consolidated Post object.
 */
// Sobrecarga: post não-nulo entra, post não-nulo sai. Sem isto, todo chamador que já
// checou o 404 antes teria de repetir a checagem de null.
export function mergeSlidesIntoPost(post: PostWithSlides): PostWithSlides;
export function mergeSlidesIntoPost(post: PostWithSlides | null): PostWithSlides | null;
export function mergeSlidesIntoPost(post: PostWithSlides | null): PostWithSlides | null {
  if (!post) return null;

  // Deep clone to avoid mutating Prisma objects or cache
  const cloned = JSON.parse(JSON.stringify(post)) as PostWithSlides;
  const content = cloned.content;

  if (isRecord(content)) {
    const slidesRelation = (cloned.slides ?? []) as SlideRow[];

    // Sort slides by their position/index
    slidesRelation.sort((a, b) => a.position - b.position);

    const typedContent = content as PostContent;

    if (typedContent.kind === 'ir-design') {
      if (!isRecord(typedContent.ir)) typedContent.ir = {};
      typedContent.ir.slides = slidesRelation.map((s) =>
        isRecord(s.contentJson) ? s.contentJson : {},
      );
    } else {
      // Map database fields to the format expected by the frontend
      typedContent.slides = slidesRelation.map((s) => ({
        ...(isRecord(s.contentJson) ? s.contentJson : {}),
        id: s.id,
        metadata: s.metadata || undefined,
      }));
    }
  }

  return cloned;
}

/**
 * Synchronizes the slides array inside a Post's content object back into individual
 * rows in the relational Slide table. Performs update-in-place to minimize database churn.
 */
export async function syncPostSlides(postId: string, content: unknown): Promise<void> {
  if (!isRecord(content)) return;
  const typed = content as PostContent;

  const isHtml = typed.kind === 'html-design' && Array.isArray(typed.slides);
  const isIr = typed.kind === 'ir-design' && isRecord(typed.ir) && Array.isArray(typed.ir.slides);

  if (!isHtml && !isIr) {
    return;
  }

  const width = Number(typed.width) || 1080;
  const height = Number(typed.height) || 1080;
  const fonts = (Array.isArray(typed.fonts) ? typed.fonts : ['Inter']) as string[];
  const slides = (isIr ? typed.ir!.slides! : typed.slides!) as Record<string, unknown>[];

  // Fetch currently saved slides
  const existingSlides = await prisma.slide.findMany({
    where: { postId },
  });

  const existingMap = new Map(existingSlides.map((s) => [s.position, s]));
  const processedPositions = new Set<number>();

  for (let i = 0; i < slides.length; i++) {
    const slideContent = slides[i];
    processedPositions.add(i);

    const existing = existingMap.get(i);
    let htmlDoc = '';

    try {
      // O slide vem do JSON do post, então só sabemos a forma pelo `kind` do content.
      // O compilador valida/normaliza o que receber, e a falha cai no catch abaixo.
      htmlDoc = isIr
        ? compileSlideToDocument(slideContent as unknown as SlideNode, fonts, width, height)
        : buildSlideDocument(slideContent as unknown as HtmlDesignSlide, fonts, width, height);
    } catch (e) {
      console.error(`Falha ao compilar slide ${i} para cache de render`, e);
    }

    // Não sobrescreve um htmlRender bom com string vazia se a compilação falhar.
    const htmlRenderValue = htmlDoc ? htmlDoc : existing?.htmlRender ?? null;

    if (existing) {
      // Update in place if changed
      await prisma.slide.update({
        where: { id: existing.id },
        data: {
          contentJson: slideContent as Prisma.InputJsonValue,
          htmlRender: htmlRenderValue,
          // Merge metadata if present in the slide content
          metadata: (slideContent.metadata !== undefined ? slideContent.metadata : existing.metadata) as Prisma.InputJsonValue,
        },
      });
    } else {
      // Create new slide record
      await prisma.slide.create({
        data: {
          postId,
          position: i,
          contentJson: slideContent as Prisma.InputJsonValue,
          htmlRender: htmlRenderValue,
          metadata: (slideContent.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    }
  }

  // Delete any slides that are no longer present in the updated slides array
  const slidesToDelete = existingSlides
    .filter((s) => !processedPositions.has(s.position))
    .map((s) => s.id);

  if (slidesToDelete.length > 0) {
    await prisma.slide.deleteMany({
      where: { id: { in: slidesToDelete } },
    });
  }
}
