import { z } from 'zod';
import { checkApprovedText, textIssuesToDeviations } from '../../lib/designerBrain/index.js';
import { normalizeEmptyPhotoSlots } from '../../lib/photoSlot.js';
import { applySlideCode } from '../../lib/slideEdit.js';
import { WRITE_SCOPE } from '../config.js';
import { editorUrl, loadMutableDesign, summarizeIssues } from './designs.js';
import { ToolUserError, type McpToolDefinition } from './types.js';

const MAX_HTML_CHARS = 60_000;
const MAX_CSS_CHARS = 40_000;
const MAX_TEXT_CHARS = 4_000;

const inputSchema = {
  brandSlug: z.string().trim().min(1).max(100).describe('Slug da marca, de list_brands.'),
  postId: z.string().uuid().describe('Id da peça, de list_designs ou save_presentation.'),
  slide: z.number().int().min(1).max(60).describe('Número do slide, a partir de 1 (o mesmo de get_design).'),
  html: z.string().min(1).max(MAX_HTML_CHARS).describe('Conteúdo interno do .slide-root deste slide (sem <html>/<body>).'),
  css: z.string().max(MAX_CSS_CHARS).optional().describe('CSS do slide, sem a tag <style>. Mantenha as classes prefixadas do slide (s3-...).'),
  approvedText: z
    .string()
    .max(MAX_TEXT_CHARS)
    .optional()
    .describe('Texto APROVADO deste slide. Com ele, o texto da arte é conferido e as divergências voltam em `issues`.'),
};

const outputSchema = {
  postId: z.string(),
  slide: z.number(),
  slideCount: z.number(),
  textChecked: z.boolean(),
  ok: z.boolean(),
  issues: z.array(z.object({ slide: z.number(), type: z.string(), severity: z.string(), description: z.string(), fix: z.string() })),
  versionNote: z.string(),
  editorUrl: z.string().nullable(),
};

export const updateSlideTool: McpToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: 'update_slide',
  title: 'Atualizar UM slide',
  description:
    'Troca o HTML/CSS de um único slide de uma peça já salva, sem reenviar o deck inteiro. Leia o slide com get_design ' +
    '(includeSource: true), altere o que foi pedido e envie. O código é sanitizado no servidor (a mesma regra do editor) e a versão ' +
    'anterior é guardada: dá para voltar com restore_version. Passe `approvedText` para conferir o texto da arte. ' +
    'Só peças que você criou por esta conexão — ou qualquer apresentação/carrossel com o escopo designer.edit_all.',
  scope: WRITE_SCOPE,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema,
  outputSchema,
  brandArg: 'brandSlug',

  async handler(ctx, args) {
    await loadMutableDesign(ctx, args.postId);

    const html = normalizeEmptyPhotoSlots(args.html);
    let applied;
    try {
      applied = await applySlideCode({
        postId: args.postId,
        index: args.slide - 1,
        html,
        css: args.css,
        userId: ctx.userId,
        source: 'AI',
        label: `Antes da atualização do slide ${args.slide} pelo agente`,
      });
    } catch (err) {
      // applySlideCode fala em HTTP (createError); o agente recebe a frase, não o status.
      const status = (err as { statusCode?: number }).statusCode;
      if (err instanceof Error && status !== undefined && status >= 400 && status < 500) {
        throw new ToolUserError(err.message, 'slide_rejected');
      }
      throw err;
    }

    const textChecked = !!args.approvedText?.trim();
    const issues = textChecked
      ? textIssuesToDeviations(checkApprovedText([args.approvedText], [applied.slide.html])).map((d) => ({
          slide: args.slide,
          type: d.type,
          severity: d.severity,
          description: d.description,
          fix: d.fix,
        }))
      : [];
    const ok = issues.length === 0;
    const url = editorUrl(ctx.frontendOrigin, ctx.brand!.slug, args.postId);
    const versionNote = 'A versão anterior ficou guardada (list_versions / restore_version).';

    const text = [
      `Slide ${args.slide} atualizado (${applied.slideCount} slides na peça).`,
      textChecked ? (ok ? 'Texto conferido contra o aprovado: sem divergências.' : `Texto: ${issues.length} divergência(s). Corrija e chame update_slide de novo.\n${summarizeIssues(issues)}`) : 'Sem approvedText: o texto da arte NÃO foi conferido.',
      versionNote,
      url ? `Editor: ${url}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      text,
      structured: { postId: args.postId, slide: args.slide, slideCount: applied.slideCount, textChecked, ok, issues, versionNote, editorUrl: url },
    };
  },
};
