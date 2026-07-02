import { Router, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { renderHtmlToPng } from '../lib/htmlRaster.js';
import { buildSlideDocument, editHtmlSlide } from '../lib/htmlDesign.js';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { generateWithRetry } from '../lib/geminiRetry.js';
import { extractJsonObject } from '../lib/designDocument.js';
import { resolveBrandContext } from '../lib/brandContext.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

export const postsRouter = Router();

// POST /api/posts/:id/edit-slide - edição cirúrgica de um slide html-design via instrução
postsRouter.post('/:id/edit-slide', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { slideIndex, instruction } = (req.body ?? {}) as { slideIndex?: number; instruction?: string };
    if (typeof instruction !== 'string' || !instruction.trim()) throw createError(400, 'instruction é obrigatória');

    const post = await prisma.post.findFirst({
      where: { id, brand: { userId: req.user?.userId } },
      include: { brand: true },
    });
    if (!post) throw createError(404, 'Post not found');

    const content = post.content as unknown as {
      kind?: string;
      width?: number;
      height?: number;
      slides?: Array<{ html: string; css?: string }>;
    };
    if (!content || content.kind !== 'html-design' || !Array.isArray(content.slides) || content.slides.length === 0) {
      throw createError(400, 'Edição disponível apenas para posts html-design');
    }

    const idx = Math.max(0, Math.min(Number(slideIndex) || 0, content.slides.length - 1));
    const brand = await resolveBrandContext(post.brand.slug, req.user?.userId);
    const model = config.geminiDesignDocumentModel || 'gemini-3.1-pro-preview';

    const edited = await editHtmlSlide(
      async (si, up) =>
        (await generateWithRetry(ai, {
          model,
          contents: up,
          config: { systemInstruction: si, responseMimeType: 'application/json', maxOutputTokens: 32768 },
        }, model)).text ?? '{}',
      {
        slide: content.slides[idx],
        instruction,
        brand: { name: brand.name, colors: brand.colors, primaryFonts: brand.primaryFonts },
        width: content.width ?? 1080,
        height: content.height ?? 1080,
      },
      extractJsonObject,
    );

    content.slides[idx] = edited;
    await prisma.post.update({ where: { id }, data: { content: content as unknown as Prisma.InputJsonValue } });

    res.json({ data: { slideIndex: idx, slide: edited } });
  } catch (error) {
    next(error);
  }
});

// GET /api/posts/:id/export?slide=N - renderiza um slide html-design em PNG full-res
postsRouter.get('/:id/export', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const post = await prisma.post.findFirst({
      where: { id, brand: { userId: req.user?.userId } },
      select: { content: true },
    });
    if (!post) throw createError(404, 'Post not found');

    const content = post.content as unknown as {
      kind?: string;
      width?: number;
      height?: number;
      fonts?: string[];
      slides?: Array<{ html: string; css?: string }>;
    };
    if (!content || content.kind !== 'html-design' || !Array.isArray(content.slides) || content.slides.length === 0) {
      throw createError(400, 'Export disponível apenas para posts html-design');
    }

    const width = typeof content.width === 'number' ? content.width : 1080;
    const height = typeof content.height === 'number' ? content.height : 1080;
    const requested = Number(req.query.slide ?? 0) || 0;
    const slideIdx = Math.max(0, Math.min(requested, content.slides.length - 1));

    const doc = buildSlideDocument(content.slides[slideIdx], content.fonts ?? [], width, height);
    const png = await renderHtmlToPng(doc, { width, height, maxDim: 0 }); // full-res

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="post-${id.slice(0, 8)}-slide-${slideIdx + 1}.png"`);
    res.send(png);
  } catch (error) {
    next(error);
  }
});

// GET /api/posts/:id - Get single post with its content
postsRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const post = await prisma.post.findFirst({
      where: {
        id,
        brand: { userId: req.user?.userId }
      },
      include: {
        brand: true
      }
    });

    if (!post) throw createError(404, 'Post not found');
    res.json({ data: post });
  } catch (error) {
    next(error);
  }
});

// PUT /api/posts/:id - Update post content
postsRouter.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { content, status, folderId } = req.body;

    const post = await prisma.post.findFirst({
      where: {
        id,
        brand: { userId: req.user?.userId }
      },
      select: { id: true, brandId: true }
    });

    if (!post) throw createError(404, 'Post not found');

    const dataToUpdate: Prisma.PostUncheckedUpdateInput = {};
    if (content !== undefined) {
      dataToUpdate.content = content as Prisma.InputJsonValue;
    }

    const statusValue =
      status === 'DRAFT' || status === 'GENERATING' || status === 'READY' || status === 'FAILED'
        ? status
        : undefined;
    if (statusValue) {
      dataToUpdate.status = statusValue;
    }

    if (folderId !== undefined) {
      if (folderId === null) {
        dataToUpdate.folderId = null;
      }
      
      if (folderId !== null && typeof folderId === 'string') {
        const folder = await prisma.folder.findFirst({
          where: {
            id: folderId,
            brandId: post.brandId,
            brand: { userId: req.user?.userId }
          },
          select: { id: true }
        });

        if (!folder) throw createError(404, 'Folder not found');
        dataToUpdate.folderId = folderId;
      }
      
      if (folderId !== null && typeof folderId !== 'string') {
        throw createError(400, 'Invalid folderId');
      }
    }

    const updatedPost = await prisma.post.update({
      where: { id: post.id },
      data: dataToUpdate,
    });

    res.json({ data: updatedPost });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/posts/:id - Delete a post
postsRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const post = await prisma.post.findFirst({
      where: {
        id,
        brand: { userId: req.user?.userId }
      },
      select: { id: true }
    });

    if (!post) throw createError(404, 'Post not found');

    await prisma.post.delete({
      where: { id: post.id },
    });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
