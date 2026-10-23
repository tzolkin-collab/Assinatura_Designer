import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { resolveBrandContext } from '../../lib/brandContext.js';
import { resolveCanvasSize } from '../../lib/canvasSize.js';
import { resolveFontRefs, type FontFaceRef } from '../../lib/customFonts.js';
import { checkApprovedText, loadBrainLayers, textIssuesToDeviations } from '../../lib/designerBrain/index.js';
import { HtmlDesignValidationError, normalizeFontFamilies, validateHtmlDesign } from '../../lib/htmlDesign.js';
import prisma from '../../lib/prisma.js';
import { normalizeEmptyPhotoSlots } from '../../lib/photoSlot.js';
import { syncPostSlides } from '../../lib/postHelper.js';
import { snapshotPost } from '../../lib/postVersions.js';
import { WRITE_SCOPE } from '../config.js';
import { editorUrl, summarizeIssues } from './designs.js';
import { ToolUserError, type McpToolDefinition } from './types.js';

/** Tetos de entrada: o HTML vem de um agente externo, e o servidor renderiza e guarda tudo. */
const MAX_SLIDES = 30;
const MAX_HTML_CHARS = 60_000;
const MAX_CSS_CHARS = 40_000;
const MAX_TEXT_CHARS = 4_000;

const slideSchema = z.object({
  html: z.string().min(1).max(MAX_HTML_CHARS).describe('Conteúdo interno do .slide-root do slide (sem <html>/<body>).'),
  css: z.string().max(MAX_CSS_CHARS).optional().describe('CSS do slide, sem a tag <style>. Classes prefixadas (s1-, s2-...).'),
  approvedText: z
    .string()
    .max(MAX_TEXT_CHARS)
    .optional()
    .describe('Texto APROVADO deste slide, exatamente como o usuário entregou. É contra ele que o texto da arte é conferido.'),
});

const inputSchema = {
  brandSlug: z.string().trim().min(1).max(100).describe('Slug da marca, de list_brands.'),
  name: z.string().trim().min(1).max(255).optional().describe('Nome da peça. Padrão: o primeiro título aprovado.'),
  format: z.enum(['presentation', 'carousel']).default('presentation'),
  aspectRatio: z.enum(['1:1', '4:5', '3:4', '9:16', '16:9']).optional().describe('Só carousel. Padrão 1:1.'),
  slides: z.array(slideSchema).min(1).max(MAX_SLIDES),
  fonts: z
    .array(z.string().trim().min(1).max(80))
    .max(6)
    .optional()
    .describe('Famílias do Google Fonts usadas (só o nome). As fontes próprias da marca são detectadas pelo CSS.'),
  postId: z
    .string()
    .uuid()
    .optional()
    .describe(
      'Para ATUALIZAR uma peça já existente. Por padrão só vale para peças que ESTA conexão criou (devolvidas por save_presentation); ' +
        'com o escopo designer.edit_all vale para qualquer apresentação ou carrossel da marca (get_design.editableViaAgent diz). ' +
        'A versão anterior fica no histórico. Sem postId, cria uma nova.',
    ),
};

const issueSchema = z.object({
  slide: z.number().int().describe('Número do slide, a partir de 1.'),
  type: z.string(),
  severity: z.string(),
  description: z.string(),
  fix: z.string(),
});

const outputSchema = {
  postId: z.string(),
  editorUrl: z.string().nullable(),
  slideCount: z.number(),
  canvas: z.object({ width: z.number(), height: z.number() }),
  created: z.boolean(),
  textChecked: z.boolean(),
  ok: z.boolean(),
  issues: z.array(issueSchema),
  warnings: z.array(z.string()),
  ownFontsUsed: z.array(z.string()),
  status: z.enum(['READY', 'DRAFT']),
  versionId: z.string().nullable(),
};

/** Famílias próprias que o deck realmente usa (nome no CSS/HTML ou em `fonts`). */
function usedOwnFonts(refs: FontFaceRef[], haystack: string, listed: string[]): FontFaceRef[] {
  const text = haystack.toLowerCase();
  const names = new Set(listed.map((f) => f.toLowerCase()));
  const families = new Set(refs.map((r) => r.family));
  const used = new Set([...families].filter((f) => names.has(f.toLowerCase()) || text.includes(f.toLowerCase())));
  return refs.filter((r) => used.has(r.family));
}

export const savePresentationTool: McpToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: 'save_presentation',
  title: 'Salvar apresentação ou carrossel',
  description:
    'Salva no Designer uma peça que VOCÊ desenhou: envie cada slide como HTML/CSS (veja o contrato em get_designer_brief) e, em ' +
    '`approvedText`, o texto aprovado de cada slide. O Designer sanitiza, confere o texto da arte contra o aprovado, normaliza ' +
    'as áreas de foto, embute as fontes próprias da marca e cria a peça no editor, onde o usuário acompanha e edita. ' +
    'Devolve `issues` (texto faltando ou acrescentado, por slide): se houver, corrija e chame de novo com o `postId` devolvido ' +
    'para ATUALIZAR a mesma peça (peças de outras origens só com o escopo designer.edit_all). Nunca coloque no slide texto que não esteja no aprovado, nem gere pessoas ou fotos.',
  scope: WRITE_SCOPE,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  inputSchema,
  outputSchema,
  brandArg: 'brandSlug',

  async handler(ctx, args) {
    const grant = ctx.brand!;
    const format = args.format ?? 'presentation';
    const canvas = resolveCanvasSize(format, args.aspectRatio);

    // ── Atualização: a peça que ESTE usuário criou por MCP — ou qualquer peça de deck/carrossel da ──
    // marca autorizada, quando a conexão tem designer.edit_all. O papel (EDITOR+) já foi exigido
    // por resolveBrandGrants para o escopo de escrita; a marca é sempre a do grant, nunca a da peça.
    let existing: { id: string; content: unknown } | null = null;
    if (args.postId) {
      const row = await prisma.post.findFirst({
        where: { id: args.postId, brandId: grant.id },
        select: { id: true, type: true, content: true },
      });
      const owner = (row?.content as { mcp?: { userId?: string } } | null)?.mcp?.userId;
      const ownedByUser = owner === ctx.userId;
      // Fora do caso "criei eu", o agente só reescreve o que sabe desenhar: decks e carrosséis.
      const editableType = row?.type === 'PRESENTATION' || row?.type === 'CAROUSEL';
      if (!row || !(ownedByUser || (ctx.canEditAll && editableType))) {
        throw new ToolUserError(
          ctx.canEditAll
            ? 'Peça não encontrada nesta marca, ou não é uma apresentação/carrossel.'
            : 'Peça não encontrada, ou não foi criada por você nesta conexão.',
          'post_unavailable',
        );
      }
      existing = row;
    }

    // ── Validação e sanitização (a mesma do pipeline) ────────────────────────────────────────────
    let validated;
    try {
      validated = validateHtmlDesign(
        { slides: args.slides.map((s) => ({ html: s.html, css: s.css })), fonts: args.fonts ?? [] },
        { width: canvas.width, height: canvas.height, format },
      );
    } catch (err) {
      if (err instanceof HtmlDesignValidationError) {
        throw new ToolUserError(`Slides inválidos: ${err.message}. Cada slide precisa de "html" com conteúdo.`, 'invalid_slides');
      }
      throw err;
    }
    // validateHtmlDesign descarta slides sem HTML; o número dos slides tem de bater com o que foi enviado.
    if (validated.slides.length !== args.slides.length) {
      throw new ToolUserError('Algum slide ficou vazio depois da limpeza. Envie HTML com conteúdo em todos os slides.', 'empty_slide');
    }
    const slides = validated.slides.map((s) => ({ ...s, html: normalizeEmptyPhotoSlots(s.html) }));

    // ── Fontes: próprias (embutidas) e do Google ─────────────────────────────────────────────────
    const [brand, layers] = await Promise.all([resolveBrandContext(grant.slug), loadBrainLayers(grant.slug)]);
    const refs = layers?.projectProfile ? await resolveFontRefs(layers.projectProfile.typography ?? [], brand.libraryBrandIds) : [];
    const blob = slides.map((s) => `${s.html}\n${s.css ?? ''}`).join('\n');
    const own = usedOwnFonts(refs, blob, args.fonts ?? []);
    const ownFamilies = new Set(own.map((r) => r.family.toLowerCase()));
    const remote = normalizeFontFamilies(args.fonts).filter((f) => !ownFamilies.has(f.toLowerCase()));
    const fonts = [...new Set([...own.map((r) => r.family), ...remote])];

    // ── Texto aprovado × texto da arte (código, não prompt) ──────────────────────────────────────
    const approved = args.slides.map((s) => s.approvedText);
    const textChecked = approved.some((t) => t?.trim());
    const issues = textChecked
      ? textIssuesToDeviations(checkApprovedText(approved, slides.map((s) => s.html))).map((d) => ({
          slide: d.slideIndex + 1,
          type: d.type,
          severity: d.severity,
          description: d.description,
          fix: d.fix,
        }))
      : [];

    const warnings: string[] = [];
    if (!textChecked) {
      warnings.push('Sem `approvedText`: o texto da arte NÃO foi conferido. Envie o texto aprovado de cada slide para a checagem rodar.');
    }
    // Aqui o aviso depende de a marca ter ficha (`layers`). O pipeline interno trata todo projeto como cérebro
    // ligado (cérebro global); este MCP segue com o comportamento de antes.
    if (layers && !textChecked) {
      warnings.push('Esta marca usa o cérebro do Designer: sem texto aprovado a peça não pode ser tratada como final.');
    }

    // ── Persistência ─────────────────────────────────────────────────────────────────────────────
    const name = args.name ?? (approved.find((t) => t?.trim())?.trim().split(/\r?\n/)[0] ?? 'Peça do agente').slice(0, 255);
    const envelope = {
      kind: 'html-design' as const,
      version: 1 as const,
      width: canvas.width,
      height: canvas.height,
      format: validated.format,
      fonts: fonts.length ? fonts : ['Inter'],
      ...(own.length ? { fontFaces: own } : {}),
      slides,
    };
    const { slides: _slides, ...stored } = envelope;
    const content = {
      ...stored,
      // Procedência: quem criou (para a atualização e para o usuário saber que veio de um agente).
      mcp: { userId: ctx.userId, clientId: ctx.clientId, familyId: ctx.familyId, savedAt: new Date().toISOString() },
    };

    // Peça com divergência de texto não é entrega: fica em rascunho até uma chamada limpa.
    const ok = issues.length === 0;
    const status = ok ? ('READY' as const) : ('DRAFT' as const);

    const postId = existing?.id ?? randomUUID();
    let versionId: string | null = null;
    if (existing) {
      // Congela o estado ANTES de sobrescrever: o usuário pode ter editado a peça depois do agente,
      // e a atualização troca o deck inteiro. Sem isto não havia como desfazer (o editor e o cérebro já fazem).
      const version = await snapshotPost(postId, {
        source: 'AI',
        userId: ctx.userId,
        label: 'Antes da atualização pelo agente',
      });
      versionId = version?.id ?? null;
      await prisma.post.update({
        where: { id: postId },
        data: { name, status, content: content as unknown as Prisma.InputJsonValue },
      });
    } else {
      await prisma.post.create({
        data: {
          id: postId,
          brandId: grant.id,
          name,
          type: format === 'presentation' ? 'PRESENTATION' : 'CAROUSEL',
          status,
          createdById: ctx.userId,
          content: content as unknown as Prisma.InputJsonValue,
        },
      });
    }
    await syncPostSlides(postId, envelope);

    const url = editorUrl(ctx.frontendOrigin, grant.slug, postId);
    const structured = {
      postId,
      editorUrl: url,
      slideCount: slides.length,
      canvas: { width: canvas.width, height: canvas.height },
      created: !existing,
      textChecked,
      ok,
      issues,
      warnings,
      ownFontsUsed: [...new Set(own.map((r) => r.family))],
      status,
      versionId,
    };
    const text = [
      `${existing ? 'Peça atualizada' : 'Peça criada'}: ${name} (${slides.length} slides, ${canvas.width}x${canvas.height}). postId: ${postId}`,
      url ? `Acompanhe e edite em: ${url}` : '',
      versionId ? 'A versão anterior ficou guardada no histórico da peça (o usuário pode restaurá-la).' : '',
      textChecked
        ? ok
          ? 'Texto conferido contra o aprovado: sem divergências.'
          : `Texto: ${issues.length} divergência(s). Corrija e chame save_presentation de novo com este postId.\n${summarizeIssues(issues)}`
        : '',
      ...warnings.map((w) => `Aviso: ${w}`),
    ]
      .filter(Boolean)
      .join('\n');
    return { text, structured };
  },
};
