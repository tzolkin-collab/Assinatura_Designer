import prisma from './prisma.js';
import { buildSlideDocument } from './htmlDesign.js';
import { compileSlideToDocument } from './designIR/compiler.js';

/**
 * Rebuilds the unified post.content.slides array from individual rows in the relational Slide table.
 * This guarantees 100% backward compatibility with the frontend and the rest of the application
 * that expects a single consolidated Post object.
 */
export function mergeSlidesIntoPost(post: any): any {
  if (!post) return null;

  // Deep clone to avoid mutating Prisma objects or cache
  const cloned = JSON.parse(JSON.stringify(post));

  if (cloned.content && typeof cloned.content === 'object') {
    const slidesRelation = cloned.slides || [];
    
    // Sort slides by their position/index
    slidesRelation.sort((a: any, b: any) => a.position - b.position);

    if (cloned.content.kind === 'ir-design' && cloned.content.ir) {
      cloned.content.ir.slides = slidesRelation.map((s: any) => {
        const slideContent = s.contentJson && typeof s.contentJson === 'object' ? s.contentJson : {};
        return slideContent;
      });
    } else {
      // Map database fields to the format expected by the frontend
      cloned.content.slides = slidesRelation.map((s: any) => {
        const slideContent = s.contentJson && typeof s.contentJson === 'object' ? s.contentJson : {};
        return {
          ...slideContent,
          id: s.id,
          metadata: s.metadata || undefined,
        };
      });
    }
  }

  return cloned;
}

/**
 * Synchronizes the slides array inside a Post's content object back into individual
 * rows in the relational Slide table. Performs update-in-place to minimize database churn.
 */
export async function syncPostSlides(postId: string, content: any): Promise<void> {
  const isHtml = content?.kind === 'html-design' && Array.isArray(content.slides);
  const isIr = content?.kind === 'ir-design' && content.ir && Array.isArray(content.ir.slides);
  
  if (!isHtml && !isIr) {
    return;
  }

  const width = Number(content.width) || 1080;
  const height = Number(content.height) || 1080;
  const fonts = Array.isArray(content.fonts) ? content.fonts : ['Inter'];
  const slides = isIr ? content.ir.slides : content.slides;

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
      htmlDoc = isIr
        ? compileSlideToDocument(slideContent, fonts, width, height)
        : buildSlideDocument(slideContent, fonts, width, height);
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
          contentJson: slideContent as any,
          htmlRender: htmlRenderValue,
          // Merge metadata if present in the slide content
          metadata: slideContent.metadata !== undefined ? slideContent.metadata : existing.metadata,
        },
      });
    } else {
      // Create new slide record
      await prisma.slide.create({
        data: {
          postId,
          position: i,
          contentJson: slideContent as any,
          htmlRender: htmlRenderValue,
          metadata: slideContent.metadata || {},
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
