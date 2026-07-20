import { Router, Response, NextFunction } from 'express';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { brandMemberFilter, ANY_MEMBER, EDITORS } from '../middleware/brandAccess.js';
import { renderHtmlToPng } from '../lib/htmlRaster.js';
import { buildSlideDocument, editHtmlSlide, sanitizeSlideHtml, sanitizeSlideCss } from '../lib/htmlDesign.js';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { generateWithRetry } from '../lib/geminiRetry.js';
import { extractJsonObject } from '../lib/jsonHelper.js';
import { resolveBrandContext } from '../lib/brandContext.js';
import { uploadPngToR2 } from '../lib/r2.js';
import { mergeSlidesIntoPost, syncPostSlides } from '../lib/postHelper.js';
import { snapshotPost, restorePostVersion } from '../lib/postVersions.js';
import { enrichAiContext } from '../lib/aiContext.js';
import { enqueueCanvaExport, canvaExportQueue, enqueueDeckExport, deckExportQueue } from '../lib/queue.js';
import { z } from 'zod';
import { parseBody } from '../lib/validate.js';

const exportFileSchema = z.object({
  format: z.enum(['pdf', 'zip', 'pptx', 'html'], {
    errorMap: () => ({ message: "format deve ser 'pdf', 'zip', 'pptx' ou 'html'" }),
  }),
});
const createVersionSchema = z.object({ label: z.string().optional() });
const exportCanvaSchema = z.object({ slideIndex: z.number().int().nonnegative().optional() });
import { resolveRenderableDeck } from '../lib/renderableDeck.js';
import { generateIRPatchForSlide } from '../lib/designIR/aiPatch.js';
import type { SlideNode as IRSlideNode } from '../lib/designIR/types.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

export const postsRouter = Router();

// POST /api/posts/render-batch - renderiza múltiplos slides HTML/CSS em paralelo e envia para o R2
postsRouter.post('/render-batch', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { slides, fonts, width, height } = (req.body ?? {}) as {
      slides?: Array<{ html: string; css?: string }>;
      fonts?: string[];
      width?: number;
      height?: number;
    };

    if (!Array.isArray(slides) || slides.length === 0) {
      throw createError(400, 'slides é obrigatório e deve ser um array não vazio');
    }

    const slideWidth = Number(width) || 1080;
    const slideHeight = Number(height) || 1080;
    const slideFonts = Array.isArray(fonts) ? fonts : ['Inter'];

    // Compila cada slide para um documento HTML completo e agenda a renderização em paralelo
    const renderPromises = slides.map(async (slide, index) => {
      try {
        const doc = buildSlideDocument(slide, slideFonts, slideWidth, slideHeight);
        // maxDim: 0 significa resolução cheia (fiel ao viewport configurado)
        const buffer = await renderHtmlToPng(doc, { width: slideWidth, height: slideHeight, maxDim: 0 });
        const url = await uploadPngToR2(buffer);
        return { index, url, success: true };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return { index, error: errMsg, success: false };
      }
    });

    const results = await Promise.all(renderPromises);

    res.json({ data: results });
  } catch (error) {
    next(error);
  }
});

// POST /api/posts/:id/edit-slide - edição cirúrgica de um slide html-design via instrução
postsRouter.post('/:id/edit-slide', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { slideIndex, instruction, isolate, target } = (req.body ?? {}) as {
      slideIndex?: number;
      instruction?: string;
      isolate?: boolean;
      /** Elemento clicado no preview (seletor "inspecionar" do editor). */
      target?: { identifier?: string; path?: string; text?: string; outerHTML?: string };
    };
    if (typeof instruction !== 'string' || !instruction.trim()) throw createError(400, 'instruction é obrigatória');

    // Só strings, truncadas: o target vai para um prompt, não para o banco.
    const targetElement = target && typeof target === 'object'
      ? {
          identifier: typeof target.identifier === 'string' ? target.identifier.slice(0, 200) : undefined,
          path: typeof target.path === 'string' ? target.path.slice(0, 400) : undefined,
          text: typeof target.text === 'string' ? target.text.slice(0, 200) : undefined,
          outerHTML: typeof target.outerHTML === 'string' ? target.outerHTML.slice(0, 1000) : undefined,
        }
      : undefined;

    const post = await prisma.post.findFirst({
      where: { id, brand: brandMemberFilter(req.user?.userId, EDITORS) },
      include: { brand: true, slides: { orderBy: { position: 'asc' } } },
    });
    if (!post) throw createError(404, 'Post not found');

    const postWithSlides = mergeSlidesIntoPost(post);
    const content = postWithSlides.content as unknown as {
      kind?: string;
      width?: number;
      height?: number;
      fonts?: string[];
      slides?: Array<{ html: string; css?: string }>;
    };
    if (!content || content.kind !== 'html-design' || !Array.isArray(content.slides) || content.slides.length === 0) {
      throw createError(400, 'Edição disponível apenas para posts html-design');
    }

    const idx = Math.max(0, Math.min(Number(slideIndex) || 0, content.slides.length - 1));

    // A rota não passa por requireBrandRole (a marca vem pelo post): sem isto o
    // gasto desta edição não cairia no teto diário da marca.
    enrichAiContext({ brandSlug: post.brand.slug, postId: post.id, feature: 'edit-slide' });

    // O estado de antes da IA vira versão. É o único jeito de o usuário voltar:
    // a edição escreve direto na tabela de slides.
    await snapshotPost(post.id, {
      source: 'AI',
      label: `Antes da IA editar o slide ${idx + 1}: "${instruction.trim().slice(0, 100)}"`,
      userId: req.user?.userId,
    });

    const brand = await resolveBrandContext(post.brand.slug);
    const model = config.models.artist;

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
        brand: {
          name: brand.name,
          colors: brand.colors,
          primaryFonts: brand.primaryFonts,
          guidelines: brand.guidelines,
          agentPrompt: brand.agentPrompt,
        },
        width: content.width ?? 1080,
        height: content.height ?? 1080,
        isolate: isolate !== false,
        targetElement,
      },
      extractJsonObject,
    );

    // Atualiza individualmente o registro do slide no banco
    const existingSlide = post.slides.find((s) => s.position === idx);
    if (existingSlide) {
      await prisma.slide.update({
        where: { id: existingSlide.id },
        data: {
          contentJson: edited as unknown as Prisma.InputJsonValue,
          htmlRender: buildSlideDocument(edited, content.fonts ?? ['Inter'], content.width ?? 1080, content.height ?? 1080),
        },
      });
    }

    // Toca o updatedAt do Post
    await prisma.post.update({
      where: { id: post.id },
      data: { updatedAt: new Date() },
    });

    res.json({ data: { slideIndex: idx, slide: edited } });
  } catch (error) {
    next(error);
  }
});

// PUT /api/posts/:id/slides/:index/code — A PRIMITIVA de edição do produto.
//
// O slide É um arquivo html/css. Este endpoint é a única porta de escrita desse
// arquivo, e TODOS os caminhos convergem nele conceitualmente: o humano editando
// o código na aba Fonte, a IA via editHtmlSlide (edit-slide/chat) e qualquer
// automação futura. O código chega CRU e sai SANITIZADO aqui (mesmo DOMPurify
// da geração — o que passar disto executa no chromium do raster), com versão
// snapshotada antes: errou, restaura.
postsRouter.put('/:id/slides/:index/code', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const idx = Math.max(0, parseInt(req.params.index as string, 10) || 0);
    const { html, css } = (req.body ?? {}) as { html?: string; css?: string };
    if (typeof html !== 'string' || !html.trim()) throw createError(400, 'html é obrigatório');

    const post = await prisma.post.findFirst({
      where: { id, brand: brandMemberFilter(req.user?.userId, EDITORS) },
      include: { slides: { orderBy: { position: 'asc' } } },
    });
    if (!post) throw createError(404, 'Post não encontrado');

    const content = mergeSlidesIntoPost(post).content as unknown as {
      kind?: string;
      width?: number;
      height?: number;
      fonts?: string[];
      slides?: Array<{ html: string; css?: string }>;
    };
    if (content?.kind !== 'html-design' || !Array.isArray(content.slides)) {
      throw createError(400, 'Edição de código disponível apenas para designs html-design');
    }
    if (idx >= content.slides.length) throw createError(400, 'slide fora do limite');

    // Sanitização server-side: NUNCA confiar no que veio do cliente.
    const clean = { html: sanitizeSlideHtml(html), css: css ? sanitizeSlideCss(css) : undefined };
    if (!clean.html.trim()) throw createError(400, 'html ficou vazio após a sanitização');

    await snapshotPost(post.id, {
      source: 'EDITOR',
      label: `Antes da edição de código do slide ${idx + 1}`,
      userId: req.user?.userId,
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

    res.json({ data: { slideIndex: idx, slide: clean } });
  } catch (error) {
    next(error);
  }
});

// POST /api/posts/:id/ai-patch - edição cirúrgica IR guiada por linguagem natural.
// Recebe uma instrução + (opcional) elementos selecionados de UM slide e devolve
// um IRPatch (lista de ops) que o editor aplica localmente via applyPatch. Não
// persiste — o salvamento do post é feito à parte pelo editor (PUT /posts/:id).
postsRouter.post('/:id/ai-patch', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { slideIndex, instruction, selectedElementIds } = (req.body ?? {}) as {
      slideIndex?: number;
      instruction?: string;
      selectedElementIds?: string[];
    };

    if (!instruction?.trim()) throw createError(400, 'instruction é obrigatória');

    const post = await prisma.post.findFirst({
      where: { id, brand: brandMemberFilter(req.user?.userId, EDITORS) },
      include: { brand: true, slides: { orderBy: { position: 'asc' } } },
    });
    if (!post) throw createError(404, 'Post não encontrado');

    const content = mergeSlidesIntoPost(post).content as {
      kind?: string;
      width?: number;
      height?: number;
      fonts?: string[];
      ir?: { slides?: IRSlideNode[] };
    };
    if (content?.kind !== 'ir-design' || !Array.isArray(content.ir?.slides) || content.ir!.slides.length === 0) {
      throw createError(400, 'Edição por IA disponível apenas para designs no formato ir-design');
    }

    const slides = content.ir!.slides;
    const idx = Math.max(0, Math.min(Number(slideIndex) || 0, slides.length - 1));

    enrichAiContext({ brandSlug: post.brand.slug, postId: post.id, feature: 'ai-patch' });

    // O patch é aplicado no editor e só depois salvo, mas o banco AGORA ainda tem o
    // estado pré-IA: é aqui que ele tem de ser congelado. Esperar o PUT não serve —
    // o snapshot do editor é debounced e engoliria justamente esta mudança.
    await snapshotPost(post.id, {
      source: 'AI',
      label: `Antes da IA editar o slide ${idx + 1}: "${instruction.trim().slice(0, 100)}"`,
      userId: req.user?.userId,
    });

    const slide = slides[idx]!;
    const brandColors = (post.brand as { colors?: string[] } | null)?.colors ?? [];

    const patch = await generateIRPatchForSlide({
      slide,
      instruction,
      brandColors,
      selectedElementIds: Array.isArray(selectedElementIds) ? selectedElementIds : [],
    });

    if (patch.ops.length === 0) {
      throw createError(422, 'Não consegui traduzir a instrução em uma alteração válida. Tente ser mais específico.');
    }

    // Devolve o patch e NÃO persiste: o editor aplica no canvas (entra no undo) e o
    // save normal grava. Persistir aqui sobrescreveria o que o usuário ainda não salvou.
    res.json({ data: { patch } });
  } catch (error) {
    next(error);
  }
});

// GET /api/posts/:id/export?slide=N&format=png|html - baixa UM slide.
//
// `html` é o "ver a fonte" do slide: o mesmo documento que vai para o chromium,
// devolvido como arquivo. Custa uma compilação e nenhum render — dá para baixar
// no meio de uma geração, porque os slides já estão na tabela relacional e o
// `mergeSlidesIntoPost` remonta o IR a partir dela.
postsRouter.get('/:id/export', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const post = await prisma.post.findFirst({
      where: { id, brand: brandMemberFilter(req.user?.userId, ANY_MEMBER) },
      include: { slides: { orderBy: { position: 'asc' } } },
    });
    if (!post) throw createError(404, 'Post not found');

    const postWithSlides = mergeSlidesIntoPost(post);
    const deck = resolveRenderableDeck(postWithSlides.content);
    if (!deck) {
      throw createError(400, 'Export disponível apenas para designs html-design ou ir-design');
    }

    const requested = Number(req.query.slide ?? 0) || 0;
    const slideIdx = Math.max(0, Math.min(requested, deck.count - 1));

    const doc = deck.docAt(slideIdx);
    const nomeBase = `post-${id.slice(0, 8)}-slide-${slideIdx + 1}`;

    if (req.query.format === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${nomeBase}.html"`);
      res.send(doc);
      return;
    }

    const png = await renderHtmlToPng(doc, { width: deck.width, height: deck.height, maxDim: 0 }); // full-res

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeBase}.png"`);
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
        brand: brandMemberFilter(req.user?.userId, ANY_MEMBER)
      },
      include: {
        brand: true,
        slides: { orderBy: { position: 'asc' } }
      }
    });

    if (!post) throw createError(404, 'Post not found');
    res.json({ data: mergeSlidesIntoPost(post) });
  } catch (error) {
    next(error);
  }
});

// PUT /api/posts/:id - Update post content
postsRouter.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { content, status, folderId, name } = req.body;

    const post = await prisma.post.findFirst({
      where: {
        id,
        brand: brandMemberFilter(req.user?.userId, EDITORS)
      },
      select: { id: true, brandId: true }
    });

    if (!post) throw createError(404, 'Post not found');

    const dataToUpdate: Prisma.PostUncheckedUpdateInput = {};
    if (name !== undefined) {
      dataToUpdate.name = name;
    }

    if (content !== undefined) {
      // Congela o estado anterior ANTES de sobrescrever. Debounce e dedupe ficam
      // no snapshotPost: o editor salva direto e não pode virar uma versão por tecla.
      await snapshotPost(post.id, { source: 'EDITOR', userId: req.user?.userId });

      if (content && content.kind === 'html-design' && Array.isArray(content.slides)) {
        // Sincroniza os slides relacionais primeiro
        await syncPostSlides(post.id, content);

        // Remove os slides do blob de conteúdo do post para economizar espaço
        const contentToSave = { ...content };
        delete contentToSave.slides;
        dataToUpdate.content = contentToSave as Prisma.InputJsonValue;
      } else if (content && content.kind === 'ir-design' && content.ir && Array.isArray(content.ir.slides)) {
        // ir-design guarda os slides na tabela relacional. Sem este sync, o
        // mergeSlidesIntoPost sobrescreve as edições com os slides antigos no
        // próximo load — as edições do editor IR seriam perdidas.
        await syncPostSlides(post.id, content);

        // Tira os slides do blob (a tabela relacional é a fonte de verdade; o
        // merge re-hidrata ir.slides na leitura).
        const contentToSave = { ...content, ir: { ...content.ir } };
        delete contentToSave.ir.slides;
        dataToUpdate.content = contentToSave as Prisma.InputJsonValue;
      } else {
        dataToUpdate.content = content as Prisma.InputJsonValue;
      }
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
            brand: brandMemberFilter(req.user?.userId, EDITORS)
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
      include: { brand: true, slides: { orderBy: { position: 'asc' } } }
    });

    res.json({ data: mergeSlidesIntoPost(updatedPost) });
  } catch (error) {
    next(error);
  }
});

/** Acha o post e checa a marca do usuário. `roles` decide se é leitura ou escrita. */
async function findPostForUser(postId: string, userId: string | undefined, roles = EDITORS) {
  const post = await prisma.post.findFirst({
    where: { id: postId, brand: brandMemberFilter(userId, roles) },
    select: { id: true },
  });
  if (!post) throw createError(404, 'Post not found');
  return post;
}

// GET /api/posts/:id/versions - histórico do post (sem o conteúdo: são MBs por versão)
postsRouter.get('/:id/versions', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    await findPostForUser(id, req.user?.userId, ANY_MEMBER);

    const versions = await prisma.postVersion.findMany({
      where: { postId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        label: true,
        source: true,
        slideCount: true,
        createdAt: true,
        createdBy: { select: { id: true, name: true } },
      },
    });

    res.json({ data: versions });
  } catch (error) {
    next(error);
  }
});

// POST /api/posts/:id/versions - marca uma versão à mão ("salvar como ponto de retorno")
postsRouter.post('/:id/versions', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { label } = parseBody(createVersionSchema, req.body ?? {});
    await findPostForUser(id, req.user?.userId);

    const version = await snapshotPost(id, {
      source: 'MANUAL',
      label: label?.trim() || undefined,
      userId: req.user?.userId,
    });

    // `null` = o conteúdo é idêntico à última versão. Não é erro: já está guardado.
    if (!version) {
      return res.status(200).json({ data: null, message: 'Nada mudou desde a última versão.' });
    }

    res.status(201).json({ data: version });
  } catch (error) {
    next(error);
  }
});

// POST /api/posts/:id/versions/:versionId/restore - volta o post para a versão
postsRouter.post('/:id/versions/:versionId/restore', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const versionId = req.params.versionId as string;
    await findPostForUser(id, req.user?.userId);

    const post = await restorePostVersion(id, versionId, req.user?.userId);
    res.json({ data: post });
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
        brand: brandMemberFilter(req.user?.userId, EDITORS)
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

// POST /api/posts/:id/export-file { format: 'pdf' | 'zip' } — ENFILEIRA o export do
// deck INTEIRO como arquivo e devolve o jobId. É o "baixar o arquivo" que faltava:
// até aqui o deck só saía daqui em pedaços (um PNG por request) ou rasterizado no
// Canva. O PDF sai com texto de verdade, não pixel.
postsRouter.post('/:id/export-file', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { format } = parseBody(exportFileSchema, req.body ?? {});
    const userId = req.user?.userId;

    // Valida barato ANTES de enfileirar: um job que morre no worker por post
    // inexistente ou formato não-renderizável é péssima experiência.
    const post = await prisma.post.findFirst({
      where: { id, brand: brandMemberFilter(userId, ANY_MEMBER) },
      include: { slides: { orderBy: { position: 'asc' } } },
    });
    if (!post) throw createError(404, 'Post não encontrado');

    const deck = resolveRenderableDeck(mergeSlidesIntoPost(post).content);
    if (!deck) {
      throw createError(400, 'Export disponível apenas para designs html-design ou ir-design');
    }
    if (deck.count === 0) throw createError(400, 'Este design ainda não tem slides.');

    const jobId = await enqueueDeckExport({ postId: id, userId: userId!, format });

    res.status(202).json({ data: { jobId, total: deck.count } });
  } catch (error) {
    next(error);
  }
});

// GET /api/posts/:id/export-file/:jobId — progresso do export do deck.
postsRouter.get('/:id/export-file/:jobId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const jobId = req.params.jobId as string;
    const job = await deckExportQueue.getJob(jobId);
    if (!job) throw createError(404, 'Job de export não encontrado');

    // O job carrega o userId de quem pediu: sem esta checagem, qualquer usuário
    // logado leria o progresso (e o link do arquivo) de um export alheio.
    if (job.data.userId !== req.user?.userId || job.data.postId !== req.params.id) {
      throw createError(403, 'Este export não pertence a você.');
    }

    const state = await job.getState();
    const progress = (job.progress ?? {}) as { done?: number; total?: number };

    // Corrida getJob→getState: se o job completa ENTRE as duas leituras, o
    // returnvalue lido junto com o job ainda é null e o cliente recebe
    // "completed sem resultado". O estado 'completed' é gravado junto com o
    // returnvalue (mesmo script Lua), então uma releitura resolve.
    let returnvalue: unknown = job.returnvalue;
    if (state === 'completed' && returnvalue == null) {
      returnvalue = (await deckExportQueue.getJob(jobId))?.returnvalue ?? null;
    }

    res.json({
      data: {
        jobId,
        status: state, // waiting | active | completed | failed
        done: progress.done ?? 0,
        total: progress.total ?? 0,
        result: state === 'completed' ? returnvalue : undefined,
        error: state === 'failed' ? job.failedReason : undefined,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/posts/:id/export-file/:jobId/download — entrega o ARQUIVO do export.
//
// O front não pode baixar direto do R2: a URL é de outra origem, então o
// atributo `download` do <a> é ignorado pelo navegador e o clique não vira
// arquivo. Aqui o backend faz proxy do R2 com Content-Disposition: attachment
// — mesma origem, download garantido, e o Bearer token continua no header
// (URL com token em query string está fora de cogitação).
postsRouter.get('/:id/export-file/:jobId/download', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const jobId = req.params.jobId as string;
    const job = await deckExportQueue.getJob(jobId);
    if (!job) throw createError(404, 'Job de export não encontrado');
    if (job.data.userId !== req.user?.userId || job.data.postId !== req.params.id) {
      throw createError(403, 'Este export não pertence a você.');
    }

    const state = await job.getState();
    if (state !== 'completed') throw createError(409, 'O export ainda não terminou.');

    // Mesma releitura anti-corrida do endpoint de status.
    let rv = job.returnvalue as { url?: string; fileName?: string } | null;
    if (!rv?.url) rv = ((await deckExportQueue.getJob(jobId))?.returnvalue ?? null) as typeof rv;
    if (!rv?.url) throw createError(500, 'Export sem arquivo associado.');

    const upstream = await fetch(rv.url);
    if (!upstream.ok || !upstream.body) throw createError(502, 'Não consegui buscar o arquivo no storage.');

    const fileName = (rv.fileName ?? 'deck').replace(/["\r\n]/g, '');
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    const len = upstream.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);

    Readable.fromWeb(upstream.body as WebReadableStream).pipe(res);
  } catch (error) {
    next(error);
  }
});

// POST /api/posts/:id/export-canva — ENFILEIRA o export e devolve o jobId.
//
// Antes esta rota renderizava e subia os slides dentro da requisição, e o
// frontend a chamava num laço, uma vez por slide. Um deck de 200 slides eram 200
// requisições, cada uma com um render full-res no chromium: timeout na certa e
// risco de OOM. Agora a resposta é imediata e o trabalho roda na fila.
postsRouter.post('/:id/export-canva', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { slideIndex } = parseBody(exportCanvaSchema, req.body ?? {});
    const userId = req.user?.userId;

    // Valida tudo o que dá pra validar de forma barata ANTES de enfileirar: um job
    // que morre no worker por Canva desconectado é péssima experiência.
    const post = await prisma.post.findFirst({
      where: { id, brand: brandMemberFilter(userId, EDITORS) },
      include: {
        slides: { orderBy: { position: 'asc' } },
      },
    });

    if (!post) throw createError(404, 'Post não encontrado');

    // Canva é a conta do DESIGNER que pediu o export (userId), não da marca.
    const requester = await prisma.user.findUnique({
      where: { id: userId },
      select: { canvaAccessToken: true },
    });
    if (!requester?.canvaAccessToken) {
      return res.status(401).json({
        error: { code: 'CANVA_NOT_CONNECTED', message: 'Canva não conectado para este usuário' },
      });
    }

    const deck = resolveRenderableDeck(mergeSlidesIntoPost(post).content);
    if (!deck) {
      throw createError(400, 'Export Canva disponível apenas para designs html-design ou ir-design');
    }

    if (typeof slideIndex === 'number' && (slideIndex < 0 || slideIndex >= deck.count)) {
      throw createError(400, 'slideIndex fora do limite');
    }

    const jobId = await enqueueCanvaExport({ postId: id, userId: userId!, slideIndex });

    res.status(202).json({
      data: { jobId, total: typeof slideIndex === 'number' ? 1 : deck.count },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/posts/:id/export-canva/:jobId — progresso do export.
postsRouter.get('/:id/export-canva/:jobId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const jobId = req.params.jobId as string;
    const job = await canvaExportQueue.getJob(jobId);
    if (!job) throw createError(404, 'Job de export não encontrado');

    // O job carrega o userId de quem pediu: sem esta checagem, qualquer usuário
    // logado leria o progresso (e o link do design) de um export alheio.
    if (job.data.userId !== req.user?.userId || job.data.postId !== req.params.id) {
      throw createError(403, 'Este export não pertence a você.');
    }

    const state = await job.getState();
    const progress = (job.progress ?? {}) as { done?: number; total?: number };

    // Mesma corrida getJob→getState do export-file: releitura se completou no meio.
    let returnvalue: unknown = job.returnvalue;
    if (state === 'completed' && returnvalue == null) {
      returnvalue = (await canvaExportQueue.getJob(jobId))?.returnvalue ?? null;
    }

    res.json({
      data: {
        jobId,
        status: state, // waiting | active | completed | failed
        done: progress.done ?? 0,
        total: progress.total ?? 0,
        result: state === 'completed' ? returnvalue : undefined,
        error: state === 'failed' ? job.failedReason : undefined,
      },
    });
  } catch (error) {
    next(error);
  }
});
