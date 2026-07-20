import prisma from './prisma.js';
import { renderHtmlToPng } from './htmlRaster.js';
import { mergeSlidesIntoPost } from './postHelper.js';
import { resolveRenderableDeck } from './renderableDeck.js';
import {
  uploadAssetAndWait,
  createDesign,
  createDesignMerge,
  parseDesignResponse,
  CanvaSessionExpiredError,
} from './canvaClient.js';

/**
 * Export de um post para o Canva.
 *
 * Antes isto rodava DENTRO da requisição HTTP, um slide por request, num laço
 * sequencial no navegador: um deck de 200 slides eram 200 requisições, cada uma
 * disparando um render full-res no chromium. Estourava timeout e arriscava OOM.
 * Agora é um job na fila, com progresso — a aba do usuário não segura mais nada.
 *
 * O que entregamos (decisão de produto, ver docs/ROADMAP.md): ARTE PRONTA. A
 * Connect API não constrói design elemento a elemento; o texto vai rasterizado no
 * PNG. O deck vira UM design multipágina no Canva, via Merge API.
 */

export interface CanvaExportParams {
  postId: string;
  userId: string;
  /** Exporta um slide só (índice) ou o deck inteiro quando ausente. */
  slideIndex?: number;
}

export interface CanvaExportResult {
  designId: string;
  designUrl?: string;
  slides: number;
  /** true quando o merge não estava disponível e caímos em designs por slide. */
  mergeFallback?: boolean;
  /** Preenchido no fallback: um design por slide, na ordem. */
  designIds?: string[];
}

export type ExportProgress = (done: number, total: number) => Promise<void> | void;

export async function runCanvaExport(
  params: CanvaExportParams,
  onProgress?: ExportProgress,
): Promise<CanvaExportResult> {
  const { postId, userId, slideIndex } = params;

  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: {
      slides: { orderBy: { position: 'asc' } },
    },
  });
  if (!post) throw new Error('Post não encontrado');

  // O Canva é a conta do designer que pediu o export (params.userId), não da marca.
  // Fail-fast antes de renderizar: o token real é resolvido (e renovado) dentro do
  // canvaFetch a cada chamada.
  const requester = await prisma.user.findUnique({
    where: { id: userId },
    select: { canvaAccessToken: true },
  });
  if (!requester?.canvaAccessToken) {
    throw new Error('Canva não conectado para este usuário');
  }

  const deck = resolveRenderableDeck(mergeSlidesIntoPost(post).content);
  if (!deck) throw new Error('Export disponível apenas para designs html-design ou ir-design');

  const indices =
    typeof slideIndex === 'number'
      ? [slideIndex]
      : Array.from({ length: deck.count }, (_, i) => i);

  if (indices.some((i) => i < 0 || i >= deck.count)) {
    throw new Error('slideIndex fora do limite');
  }

  const titleBase = post.name?.trim() || `Design ${postId.slice(0, 8)}`;

  // Um design de 1 página por slide. É a única forma de levar a arte pro Canva:
  // POST /designs aceita um único asset_id de imagem.
  const perSlideDesignIds: string[] = [];

  for (let n = 0; n < indices.length; n++) {
    const idx = indices[n]!;

    const png = await renderHtmlToPng(deck.docAt(idx), {
      width: deck.width,
      height: deck.height,
      maxDim: 0,
    });

    const assetId = await uploadAssetAndWait(
      userId,
      png,
      `${titleBase} - slide ${idx + 1}.png`,
      'image/png',
    );

    const created = await createDesign(userId, {
      design_type: { type: 'custom', width: deck.width, height: deck.height },
      asset_id: assetId,
      title: indices.length > 1 ? `${titleBase} - ${idx + 1}` : titleBase,
    });

    perSlideDesignIds.push(parseDesignResponse(created).id);
    await onProgress?.(n + 1, indices.length);
  }

  // Slide único: o design que acabamos de criar já é a entrega.
  if (perSlideDesignIds.length === 1) {
    const only = perSlideDesignIds[0]!;
    return { designId: only, slides: 1, designIds: perSlideDesignIds };
  }

  // Deck: junta as páginas num design só.
  try {
    const merged = await createDesignMerge(userId, perSlideDesignIds, titleBase);
    const { id, url } = parseDesignResponse(
      (merged as { design?: unknown; design_id?: string }).design ??
        ((merged as { design_id?: string }).design_id
          ? { id: (merged as { design_id?: string }).design_id }
          : merged),
    );
    return { designId: id, designUrl: url, slides: perSlideDesignIds.length };
  } catch (error) {
    // Sessão expirada: não faz fallback, propaga para o usuário reconectar.
    if (error instanceof CanvaSessionExpiredError) {
      throw error;
    }
    // O merge é a cereja, não a entrega: se ele falhar (indisponível na conta,
    // limite de operações), os designs por slide já estão no Canva do usuário.
    // Derrubar o job aqui apagaria um trabalho que de fato foi concluído.
    console.warn('[CanvaExport] merge falhou, entregando designs por slide:', (error as Error).message);
    return {
      designId: perSlideDesignIds[0]!,
      slides: perSlideDesignIds.length,
      mergeFallback: true,
      designIds: perSlideDesignIds,
    };
  }
}
