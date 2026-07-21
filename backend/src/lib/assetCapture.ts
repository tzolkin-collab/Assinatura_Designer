// Captura automática: todo slide gerado pela IA pode conter imagens inseridas inline 
// (em formato base64). Este script roda em background, varre os slides do post, 
// extrai qualquer imagem base64, sobe para o pool de assets da marca no R2 e 
// atualiza o JSON do slide para apontar para a nova URL leve, evitando base64 pesados
// no banco e garantindo que a mídia gerada pela IA vire acervo reutilizável.

import prisma from './prisma.js';
import { uploadFileToR2 } from './r2.js';
import { logger } from './logger.js';

export interface AssetCaptureParams {
  postId: string;
}

const MAX_CAPTURED_SLIDES = 100;

export async function runAssetCapture(params: AssetCaptureParams): Promise<{ captured: number }> {
  const { postId } = params;

  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { slides: { orderBy: { position: 'asc' } } },
  });
  if (!post) return { captured: 0 };

  const titleBase = post.name?.trim() || `Design ${postId.slice(0, 8)}`;
  const count = Math.min(post.slides.length, MAX_CAPTURED_SLIDES);

  let captured = 0;
  const dataUriRegex = /data:(image\/[a-zA-Z0-9.-]+);base64,([a-zA-Z0-9+/=]+)/g;

  for (let i = 0; i < count; i++) {
    const slideRecord = post.slides[i];
    const content = slideRecord.contentJson;
    
    if (!content) continue;

    let contentStr = JSON.stringify(content);
    let slideUpdated = false;

    const matches = Array.from(contentStr.matchAll(dataUriRegex));
    const uniqueMatches = Array.from(new Map(matches.map((m) => [m[0], m])).values());

    for (let j = 0; j < uniqueMatches.length; j++) {
      const match = uniqueMatches[j];
      const fullMatch = match[0];
      const mimeType = match[1];
      const base64Data = match[2];
      
      try {
        const buffer = Buffer.from(base64Data, 'base64');
        const ext = mimeType.split('/')[1] || 'png';
        const name = `${titleBase} - imagem ia ${i + 1}-${j + 1}.${ext}`;
        
        const url = await uploadFileToR2(buffer, name, mimeType, `brands/${post.brandId}/generated`);
        
        await prisma.asset.create({
          data: {
            brandId: post.brandId,
            uploadedBy: post.createdById,
            postId: post.id,
            name,
            url,
            fileType: mimeType,
            sizeBytes: buffer.length,
            width: 1024,
            height: 1024,
            source: 'ai-generated',
            tags: ['ai-generated', titleBase].filter(Boolean),
          },
        });
        
        contentStr = contentStr.split(fullMatch).join(url);
        slideUpdated = true;
        captured++;
      } catch (err) {
        logger.error('Falha ao capturar imagem gerada por IA', { postId, slide: i, error: (err as Error).message });
      }
    }

    if (slideUpdated) {
      await prisma.slide.update({
        where: { id: slideRecord.id },
        data: {
          contentJson: JSON.parse(contentStr),
        }
      });
    }
  }

  if (captured > 0) {
    logger.info('Captura automática de imagens da IA concluída', { postId, captured });
  }
  return { captured };
}
