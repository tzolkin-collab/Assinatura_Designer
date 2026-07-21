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

