import { Router, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { brandMemberFilter, ANY_MEMBER, EDITORS } from '../middleware/brandAccess.js';
import { renderHtmlToPng } from '../lib/htmlRaster.js';
import { buildSlideDocument, editHtmlSlide } from '../lib/htmlDesign.js';
import { compileSlideToDocument } from '../lib/designIR/compiler.js';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { generateWithRetry } from '../lib/geminiRetry.js';
import { extractJsonObject } from '../lib/designDocument.js';
import { resolveBrandContext } from '../lib/brandContext.js';
import { uploadPngToR2 } from '../lib/r2.js';
import { mergeSlidesIntoPost, syncPostSlides } from '../lib/postHelper.js';
import { uploadAsset } from '../lib/canvaClient.js';
import type { SlideNode as IRSlideNode } from '../lib/designIR/types.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

export const postsRouter = Router();

// Ops seguras para edição por IA de UM slide (structural ops como add/remove-slide
// e update-tokens ficam de fora de propósito). Espelha o applyPatch do front.
const AI_PATCH_OPS = new Set([
  'update-style', 'update-content', 'update-bounds', 'update-element',
  'update-background', 'reorder-element', 'remove-element',
]);

// Valida a resposta do modelo: mantém só ops permitidas, força o slideId real e
// exige elementId existente. Um LLM não pode corromper o design com isto no meio.
function sanitizeIRPatch(
  raw: unknown,
  slideId: string,
  elementIds: Set<string>,
): { ops: Array<Record<string, unknown>> } {
  const rawOps = raw && typeof raw === 'object' && Array.isArray((raw as { ops?: unknown }).ops)
    ? (raw as { ops: unknown[] }).ops
    : [];
  const ops: Array<Record<string, unknown>> = [];

  for (const item of rawOps) {
    if (!item || typeof item !== 'object') continue;
    const op = item as Record<string, unknown>;
    const kind = op.op;
    if (typeof kind !== 'string' || !AI_PATCH_OPS.has(kind)) continue;

    const base: Record<string, unknown> = { ...op, slideId };

    if (kind !== 'update-background') {
      if (typeof base.elementId !== 'string' || !elementIds.has(base.elementId)) continue;
    }
    if (kind === 'update-style' && (typeof base.style !== 'object' || base.style === null)) continue;
    if (kind === 'update-content' && typeof base.content !== 'string') continue;
    if (kind === 'update-bounds' && (typeof base.bounds !== 'object' || base.bounds === null)) continue;
    if (kind === 'update-element' && (typeof base.changes !== 'object' || base.changes === null)) continue;
    if (kind === 'update-background' && (typeof base.background !== 'object' || base.background === null)) continue;
    if (kind === 'reorder-element' && typeof base.newZIndex !== 'number') continue;

    ops.push(base);
    if (ops.length >= 40) break;
  }

  return { ops };
}

// Normaliza um post (html-design OU ir-design) para um "deck renderizável": um
// jeito único de obter width/height/fonts e o documento HTML completo de cada
// slide (compilando o IR quando necessário). É o que destrava export/Canva para
// ir-design, o formato principal gerado hoje.
interface RenderableDeck {
  width: number;
  height: number;
  count: number;
  docAt: (idx: number) => string;
}

function resolveRenderableDeck(content: unknown): RenderableDeck | null {
  if (!content || typeof content !== 'object') return null;
  const c = content as {
    kind?: string;
    width?: number;
    height?: number;
    fonts?: string[];
    slides?: Array<{ html: string; css?: string }>;
    ir?: { width?: number; height?: number; fonts?: string[]; slides?: unknown[] };
  };

  if (c.kind === 'html-design' && Array.isArray(c.slides) && c.slides.length > 0) {
    const width = typeof c.width === 'number' ? c.width : 1080;
    const height = typeof c.height === 'number' ? c.height : 1080;
    const fonts = Array.isArray(c.fonts) ? c.fonts : ['Inter'];
    const slides = c.slides;
    return { width, height, count: slides.length, docAt: (i) => buildSlideDocument(slides[i]!, fonts, width, height) };
  }

  if (c.kind === 'ir-design' && c.ir && Array.isArray(c.ir.slides) && c.ir.slides.length > 0) {
    const width = typeof c.ir.width === 'number' ? c.ir.width : (typeof c.width === 'number' ? c.width : 1080);
    const height = typeof c.ir.height === 'number' ? c.ir.height : (typeof c.height === 'number' ? c.height : 1080);
    const fonts = Array.isArray(c.ir.fonts) ? c.ir.fonts : (Array.isArray(c.fonts) ? c.fonts : ['Inter']);
    const slides = c.ir.slides;
    return { width, height, count: slides.length, docAt: (i) => compileSlideToDocument(slides[i] as IRSlideNode, fonts, width, height) };
  }

  return null;
}

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
    const { slideIndex, instruction, isolate } = (req.body ?? {}) as { slideIndex?: number; instruction?: string; isolate?: boolean };
    if (typeof instruction !== 'string' || !instruction.trim()) throw createError(400, 'instruction é obrigatória');

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
    const brand = await resolveBrandContext(post.brand.slug);
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
    const slide = slides[idx]!;
    const elementIds = new Set((slide.elements ?? []).map((e) => e.id));
    const selected = (Array.isArray(selectedElementIds) ? selectedElementIds : []).filter((eid) => elementIds.has(eid));

    // Só o essencial vai pro modelo (id/tipo/papel/conteúdo/bounds/estilo) — o
    // suficiente pra decidir a edição sem inflar o prompt com o slide inteiro.
    const slideForModel = {
      id: slide.id,
      background: slide.background,
      elements: (slide.elements ?? []).map((e) => ({
        id: e.id, type: e.type, role: e.role, content: e.content, src: e.src, bounds: e.bounds, style: e.style,
      })),
    };

    const model = config.geminiDesignDocumentModel || 'gemini-3.1-pro-preview';
    const brandColors = (post.brand as { colors?: string[] } | null)?.colors ?? [];

    const systemInstruction = [
      'Você edita UM slide de um design representado como DesignIR (JSON). A partir de uma instrução em linguagem natural, devolva um PATCH mínimo — apenas as mudanças necessárias.',
      'Responda SOMENTE com JSON puro (sem markdown) no formato: { "ops": [ ... ] }.',
      'Operações permitidas (use exatamente estes formatos):',
      '- { "op": "update-style", "slideId": string, "elementId": string, "style": { ...campos CSS parciais } }',
      '- { "op": "update-content", "slideId": string, "elementId": string, "content": string }',
      '- { "op": "update-bounds", "slideId": string, "elementId": string, "bounds": { "x"?, "y"?, "width"?, "height"?, "rotation"? } }',
      '- { "op": "update-element", "slideId": string, "elementId": string, "changes": { ...campos parciais do elemento } }',
      '- { "op": "update-background", "slideId": string, "background": { "type": "solid"|"gradient"|"image", "color"?, "gradient"?, "src"? } }',
      '- { "op": "reorder-element", "slideId": string, "elementId": string, "newZIndex": number }',
      '- { "op": "remove-element", "slideId": string, "elementId": string }',
      `SEMPRE use "slideId": "${slide.id}". Só referencie "elementId" que existam no slide fornecido.`,
      selected.length > 0 ? `O usuário selecionou estes elementos — priorize editá-los: ${selected.join(', ')}.` : 'Nenhum elemento selecionado — infira o alvo pela instrução.',
      brandColors.length ? `Paleta da marca (prefira estas cores em hex): ${brandColors.join(', ')}.` : '',
      'Tamanhos em px (fontSize, bounds). Não invente elementos novos a menos que a instrução peça explicitamente.',
    ].filter(Boolean).join('\n');

    const userPrompt = `Slide atual (DesignIR):\n${JSON.stringify(slideForModel)}\n\nInstrução do usuário:\n${instruction.trim()}\n\nDevolva só o JSON { "ops": [...] }.`;

    const raw = (await generateWithRetry(ai, {
      model,
      contents: userPrompt,
      config: { systemInstruction, responseMimeType: 'application/json', maxOutputTokens: 8192 },
    }, model)).text ?? '{}';

    const patch = sanitizeIRPatch(extractJsonObject(raw), slide.id, elementIds);
    if (patch.ops.length === 0) {
      throw createError(422, 'Não consegui traduzir a instrução em uma alteração válida. Tente ser mais específico.');
    }

    res.json({ data: { patch } });
  } catch (error) {
    next(error);
  }
});

// GET /api/posts/:id/export?slide=N - renderiza um slide html-design em PNG full-res
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
    const png = await renderHtmlToPng(doc, { width: deck.width, height: deck.height, maxDim: 0 }); // full-res

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

// POST /api/posts/:id/export-canva - Renderiza e faz o upload de slides para o Canva Connect
postsRouter.post('/:id/export-canva', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { slideIndex } = (req.body ?? {}) as { slideIndex?: number };

    // Busca o post com a marca e a integração do Canva inclusas
    const post = await prisma.post.findFirst({
      where: { id, brand: brandMemberFilter(req.user?.userId, EDITORS) },
      include: {
        brand: {
          include: { canvaIntegration: true }
        },
        slides: { orderBy: { position: 'asc' } }
      }
    });

    if (!post) throw createError(404, 'Post não encontrado');

    const brand = post.brand;
    if (!brand.canvaIntegration || !brand.canvaIntegration.canvaAccessToken) {
      return res.status(401).json({
        error: {
          code: 'CANVA_NOT_CONNECTED',
          message: 'Canva não conectado para esta marca'
        }
      });
    }

    const postWithSlides = mergeSlidesIntoPost(post);
    const deck = resolveRenderableDeck(postWithSlides.content);
    if (!deck) {
      throw createError(400, 'Export Canva disponível apenas para designs html-design ou ir-design');
    }

    const uploadSingleSlide = async (idx: number) => {
      const doc = deck.docAt(idx);
      const pngBuffer = await renderHtmlToPng(doc, { width: deck.width, height: deck.height, maxDim: 0 });

      const name = `post-${id.slice(0, 8)}-slide-${idx + 1}.png`;
      const canvaResult = await uploadAsset(brand.id, pngBuffer, name, 'image/png');
      return { index: idx, canvaResult };
    };

    if (typeof slideIndex === 'number') {
      if (slideIndex < 0 || slideIndex >= deck.count) {
        throw createError(400, 'slideIndex fora do limite');
      }
      const result = await uploadSingleSlide(slideIndex);
      return res.json({ data: result });
    }

    // Exporta todos sequencialmente se slideIndex não for fornecido
    const results = [];
    for (let i = 0; i < deck.count; i++) {
      const result = await uploadSingleSlide(i);
      results.push(result);
    }

    res.json({ data: results });
  } catch (error) {
    next(error);
  }
});
