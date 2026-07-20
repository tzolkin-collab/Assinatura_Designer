import prisma from './prisma.js';
import { getDesign } from './canvaClient.js';
import { logger } from './logger.js';

/**
 * Busca o nome do design no Canva de forma segura.
 */
export async function getCanvaDesignName(userId: string, designId: string): Promise<string | null> {
  try {
    const res = (await getDesign(userId, designId)) as { design?: { title?: string } };
    return res.design?.title || null;
  } catch (err) {
    logger.warn('[CanvaSync] Falha ao obter nome do design no Canva:', { designId, error: (err as Error).message });
    return null;
  }
}

/**
 * Rotina de sincronização automática periódica (cron)
 * Busca metadados atualizados do Canva para todos os posts conectados com sincronização ativável.
 */
export async function runAutoSync(): Promise<void> {
  try {
    logger.info('[CanvaSync] Iniciando rotina de sincronização automática...');
    const posts = await prisma.post.findMany({
      where: {
        canvaSyncEnabled: true,
        canvaDesignId: { not: null },
      },
      select: {
        id: true,
        canvaDesignId: true,
        createdById: true,
        canvaDesignName: true,
        canvaExportUrl: true,
      },
    });

    if (posts.length === 0) {
      logger.info('[CanvaSync] Nenhum post ativo para sincronização automática.');
      return;
    }

    let successCount = 0;

    for (const post of posts) {
      if (!post.createdById || !post.canvaDesignId) continue;
      try {
        const designInfo = (await getDesign(post.createdById, post.canvaDesignId)) as {
          design?: { title?: string; url?: string };
        };
        const title = designInfo.design?.title || post.canvaDesignName;
        const url = designInfo.design?.url || post.canvaExportUrl;

        await prisma.post.update({
          where: { id: post.id },
          data: {
            canvaDesignName: title,
            canvaExportUrl: url,
            canvaLastSyncedAt: new Date(),
          },
        });
        successCount++;
      } catch (err) {
        logger.warn('[CanvaSync] Falha ao sincronizar post:', {
          postId: post.id,
          designId: post.canvaDesignId,
          error: (err as Error).message,
        });
      }
    }

    logger.info('[CanvaSync] Sincronização periódica concluída.', {
      total: posts.length,
      success: successCount,
    });
  } catch (err) {
    logger.error('[CanvaSync] Erro na rotina de sincronização periódica:', { error: (err as Error).message });
  }
}
