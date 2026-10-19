import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import { listPhotoSlots } from '../../lib/photoSlot.js';
import { mergeSlidesIntoPost, type PostWithSlides } from '../../lib/postHelper.js';
import { applySlidePhoto } from '../../lib/slidePhoto.js';
import { READ_SCOPE, WRITE_SCOPE } from '../config.js';
import { editorUrl, loadMutableDesign, loadReadableDesign } from './designs.js';
import { ToolUserError, type McpToolDefinition } from './types.js';

/**
 * Espaços de foto de um slide (`<div data-photo-slot="N">`): ver o que há e colocar, trocar, reenquadrar ou esvaziar a
 * foto — sempre com arquivo REAL da biblioteca da marca (`list_assets`). Nenhuma foto é gerada.
 */

const brandSlug = z.string().trim().min(1).max(100).describe('Slug da marca, de list_brands.');
const postId = z.string().uuid().describe('Id da peça, de list_designs ou save_presentation.');
const slideNumber = z.number().int().min(1).max(60).describe('Número do slide, a partir de 1 (o mesmo de get_design).');

const slotSchema = z.object({
  slot: z.string(),
  hasPhoto: z.boolean(),
  src: z.string().nullable(),
  /** Enquadramento em %, 0 a 100 (50/50 = centro). */
  position: z.object({ x: z.number(), y: z.number() }),
  fit: z.enum(['cover', 'contain']),
});

type SlotInfo = { slot: string; hasPhoto: boolean; src?: string; position: { x: number; y: number }; fit: 'cover' | 'contain' };

const toSlot = (s: SlotInfo) => ({ slot: s.slot, hasPhoto: s.hasPhoto, src: s.src ?? null, position: s.position, fit: s.fit });

const describeSlots = (slots: ReturnType<typeof toSlot>[]): string =>
  slots.length
    ? slots.map((s) => `- espaço "${s.slot}": ${s.hasPhoto ? `foto ${s.src} (posição ${s.position.x}/${s.position.y}, ${s.fit})` : 'vazio'}`).join('\n')
    : 'Este slide não tem espaço de foto (<div data-photo-slot>).';

// ── get_photo_slots ─────────────────────────────────────────────────────────────────────────────

const getInput = { brandSlug, postId, slide: slideNumber };
const getOutput = { postId: z.string(), slide: z.number(), slots: z.array(slotSchema) };

export const getPhotoSlotsTool: McpToolDefinition<typeof getInput, typeof getOutput> = {
  name: 'get_photo_slots',
  title: 'Ver os espaços de foto de um slide',
  description:
    'Lista os espaços de foto (`data-photo-slot`) de um slide: qual está vazio, qual tem foto (com a URL), o enquadramento e o ajuste. ' +
    'Use antes de set_slide_photo para saber o nome do espaço.',
  scope: READ_SCOPE,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: getInput,
  outputSchema: getOutput,
  brandArg: 'brandSlug',

  async handler(ctx, args) {
    await loadReadableDesign(ctx, args.postId);
    const post = await prisma.post.findFirst({
      where: { id: args.postId, brandId: ctx.brand!.id },
      include: { slides: { orderBy: { position: 'asc' } } },
    });
    const content = post ? (mergeSlidesIntoPost(post as unknown as PostWithSlides).content as { kind?: string; slides?: Array<{ html: string }> } | null) : null;
    const slide = content?.kind === 'html-design' ? content.slides?.[args.slide - 1] : undefined;
    if (!slide) throw new ToolUserError('Slide não encontrado nesta peça (ou a peça não é um deck de slides).', 'slide_not_found');

    const slots = listPhotoSlots(slide.html).map(toSlot);
    return { text: `Slide ${args.slide}:\n${describeSlots(slots)}`, structured: { postId: args.postId, slide: args.slide, slots } };
  },
};

// ── set_slide_photo ─────────────────────────────────────────────────────────────────────────────

const setInput = {
  brandSlug,
  postId,
  slide: slideNumber,
  slot: z.string().trim().min(1).max(40).describe('Nome do espaço, de get_photo_slots (ex.: "1").'),
  assetUrl: z
    .string()
    .url()
    .max(2048)
    .nullable()
    .optional()
    .describe(
      'URL EXATA de um arquivo de list_assets: coloca ou troca a foto. `null` esvazia o espaço (ele continua lá para outra foto). ' +
        'Omitido: só muda o enquadramento da foto que já está no espaço (informe position e/ou fit).',
    ),
  position: z
    .object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) })
    .optional()
    .describe('Enquadramento em %, 0 a 100 (50/50 = centro). Sem ele, uma foto nova é enquadrada pelo assunto (rosto/pessoa).'),
  fit: z.enum(['cover', 'contain']).optional().describe('cover preenche o espaço cortando; contain mostra a foto inteira.'),
};

const setOutput = {
  postId: z.string(),
  slide: z.number(),
  slots: z.array(slotSchema),
  framing: z.object({ mode: z.enum(['manual', 'kept', 'auto', 'center']), faceVisible: z.number().nullable().optional() }),
  editorUrl: z.string().nullable(),
};

export const setSlidePhotoTool: McpToolDefinition<typeof setInput, typeof setOutput> = {
  name: 'set_slide_photo',
  title: 'Colocar ou trocar a foto de um slide',
  description:
    'Coloca, troca, reenquadra ou esvazia a foto de um espaço de um slide, com um arquivo REAL da biblioteca (list_assets) — nunca ' +
    'uma URL inventada nem uma imagem gerada. A versão anterior é guardada (restore_version). Foto nova é enquadrada pelo assunto ' +
    'quando você não informa a posição. Só peças que você criou por esta conexão — ou qualquer apresentação/carrossel com ' +
    'o escopo designer.edit_all.',
  scope: WRITE_SCOPE,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: setInput,
  outputSchema: setOutput,
  brandArg: 'brandSlug',

  async handler(ctx, args) {
    await loadMutableDesign(ctx, args.postId);
    if (args.assetUrl === undefined && !args.position && !args.fit) {
      throw new ToolUserError('Informe assetUrl (foto de list_assets, ou null para esvaziar) ou position/fit para reenquadrar.', 'nothing_to_change');
    }

    // Biblioteca da marca e, num collab, a do projeto-base — a mesma que list_assets oferece.
    const parent = await prisma.brand.findUnique({ where: { id: ctx.brand!.id }, select: { parentBrandId: true } });
    const allowedBrandIds = [ctx.brand!.id, ...(parent?.parentBrandId ? [parent.parentBrandId] : [])];

    let applied;
    try {
      applied = await applySlidePhoto({
        postId: args.postId,
        index: args.slide - 1,
        slot: args.slot,
        assetUrl: args.assetUrl,
        position: args.position,
        fit: args.fit,
        userId: ctx.userId,
        source: 'AI',
        allowedBrandIds,
      });
    } catch (err) {
      // applySlidePhoto fala em HTTP (createError); o agente recebe a frase, não o status.
      const status = (err as { statusCode?: number }).statusCode;
      if (err instanceof Error && status !== undefined && status >= 400 && status < 500) {
        throw new ToolUserError(err.message, 'photo_rejected');
      }
      throw err;
    }

    const slots = applied.slots.map(toSlot);
    const url = editorUrl(ctx.frontendOrigin, ctx.brand!.slug, args.postId);
    const text = [
      args.assetUrl === null ? `Foto removida do espaço "${args.slot}" do slide ${args.slide}.` : `Foto atualizada no espaço "${args.slot}" do slide ${args.slide} (enquadramento: ${applied.framing.mode}).`,
      describeSlots(slots),
      'A versão anterior ficou guardada (list_versions / restore_version).',
      url ? `Editor: ${url}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return { text, structured: { postId: args.postId, slide: args.slide, slots, framing: applied.framing, editorUrl: url } };
  },
};
