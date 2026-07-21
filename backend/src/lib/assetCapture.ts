// Captura automática: todo slide que a Fábrica gera vira, além de HTML/CSS, um
// PNG persistido no pool de assets da marca (source='ai-generated'). Fecha o
// último buraco do §0 do plano de consolidação — a mídia gerada pela IA
// desaparecia depois do preview, sem virar acervo reutilizável.
//
// Roda como job de fila (best-effort, depois da geração já ter respondido ao
// usuário): renderizar cada slide em PNG é o mesmo custo de chromium que um
// export — vale a pena pagar uma vez, em background, não bloqueando o "pronto"
// que o usuário já viu na tela.

import prisma from './prisma.js';
import { mergeSlidesIntoPost } from './postHelper.js';
import { resolveRenderableDeck } from './renderableDeck.js';
import { renderHtmlToPng } from './htmlRaster.js';
import { uploadFileToR2 } from './r2.js';
import { logger } from './logger.js';

export interface AssetCaptureParams {
  postId: string;
}

/** Teto de slides capturados por deck — um deck de 200 não deve virar 200
 *  linhas na biblioteca de mídia numa tacada só; a amostra cobre o essencial. */
const MAX_CAPTURED_SLIDES = 30;

export async function runAssetCapture(params: AssetCaptureParams): Promise<{ captured: number }> {
  const { postId } = params;

  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { slides: { orderBy: { position: 'asc' } } },
  });
  if (!post) return { captured: 0 };

  const deck = resolveRenderableDeck(mergeSlidesIntoPost(post).content);
  if (!deck || deck.count === 0) return { captured: 0 };

  const titleBase = post.name?.trim() || `Design ${postId.slice(0, 8)}`;
  const count = Math.min(deck.count, MAX_CAPTURED_SLIDES);

  let captured = 0;
  for (let i = 0; i < count; i++) {
    try {
      const png = await renderHtmlToPng(deck.docAt(i), { width: deck.width, height: deck.height, maxDim: 1600 });
      const name = deck.count === 1 ? `${titleBase}.png` : `${titleBase} - slide ${i + 1}.png`;
      const url = await uploadFileToR2(png, name, 'image/png', `brands/${post.brandId}/generated`);

      await prisma.asset.create({
        data: {
          brandId: post.brandId,
          uploadedBy: post.createdById,
          postId: post.id,
          name,
          url,
          fileType: 'image/png',
          sizeBytes: png.length,
          width: deck.width,
          height: deck.height,
          source: 'ai-generated',
          tags: ['ai-generated', titleBase].filter(Boolean),
        },
      });
      captured++;
    } catch (err) {
      // Um slide falhar não deve derrubar os outros — best-effort por natureza.
      logger.error('Falha ao capturar slide gerado como asset', { postId, slide: i, error: (err as Error).message });
    }
  }

  logger.info('Captura automática de assets concluída', { postId, captured, total: deck.count });
  return { captured };
}
