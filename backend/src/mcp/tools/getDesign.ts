import { z } from 'zod';
import { visibleText } from '../../lib/designerBrain/textCheck.js';
import prisma from '../../lib/prisma.js';
import { READ_SCOPE, ROLES_FOR_SCOPE, WRITE_SCOPE } from '../config.js';
import { editorUrl } from './designs.js';
import { ToolUserError, type McpToolDefinition } from './types.js';

/** Teto do HTML/CSS devolvido por slide: peça longa estoura o contexto do agente. */
const MAX_SLIDE_CHARS = 20_000;

const inputSchema = {
  brandSlug: z.string().trim().min(1).max(100).describe('Slug da marca, de list_brands.'),
  postId: z.string().uuid().describe('Id da peça, de list_designs ou save_presentation.'),
  includeSource: z
    .boolean()
    .default(false)
    .describe('true devolve o HTML/CSS de cada slide (para você editar). false devolve só o texto visível.'),
};

const outputSchema = {
  postId: z.string(),
  name: z.string().nullable(),
  type: z.string(),
  status: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  fonts: z.array(z.string()),
  editorUrl: z.string().nullable(),
  editableViaAgent: z.boolean(),
  slides: z.array(
    z.object({
      index: z.number(),
      text: z.string(),
      html: z.string().optional(),
      css: z.string().optional(),
      truncated: z.boolean().optional(),
    }),
  ),
};

export const getDesignTool: McpToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: 'get_design',
  title: 'Ler uma peça',
  description:
    'Lê uma apresentação ou carrossel da marca: tamanho, fontes e, por slide, o texto visível (e o HTML/CSS com includeSource). ' +
    'Use para continuar ou ajustar uma peça: leia, altere o que for pedido e salve de novo com save_presentation e o mesmo postId ' +
    '(por padrão só peças que você mesmo criou por esta conexão; com o escopo designer.edit_all, qualquer apresentação ou carrossel ' +
    'da marca — `editableViaAgent` informa).',
  scope: READ_SCOPE,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema,
  outputSchema,
  brandArg: 'brandSlug',

  async handler(ctx, args) {
    const brand = ctx.brand!;
    const post = await prisma.post.findFirst({
      where: { id: args.postId, brandId: brand.id },
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        content: true,
        slides: { orderBy: { position: 'asc' }, select: { position: true, contentJson: true } },
      },
    });
    if (!post) throw new ToolUserError('Peça não encontrada nesta marca.', 'post_not_found');

    const content = (post.content ?? {}) as { width?: number; height?: number; fonts?: string[]; mcp?: { userId?: string } };
    const slides = post.slides.map((s) => {
      const cj = (s.contentJson ?? {}) as { html?: string; css?: string };
      const html = typeof cj.html === 'string' ? cj.html : '';
      const css = typeof cj.css === 'string' ? cj.css : '';
      const base = { index: s.position + 1, text: html ? visibleText(html) : '' };
      if (!args.includeSource) return base;
      const truncated = html.length > MAX_SLIDE_CHARS || css.length > MAX_SLIDE_CHARS;
      return { ...base, html: html.slice(0, MAX_SLIDE_CHARS), css: css.slice(0, MAX_SLIDE_CHARS), truncated };
    });

    const structured = {
      postId: post.id,
      name: post.name,
      type: String(post.type),
      status: String(post.status),
      width: typeof content.width === 'number' ? content.width : null,
      height: typeof content.height === 'number' ? content.height : null,
      fonts: Array.isArray(content.fonts) ? content.fonts.filter((f): f is string => typeof f === 'string') : [],
      editorUrl: editorUrl(ctx.frontendOrigin, brand.slug, post.id),
      // Mesma regra do save_presentation: criou por esta via, ou tem designer.edit_all e é deck/carrossel.
      // O papel na marca (EDITOR+) segue sendo o teto, como no save_presentation.
      editableViaAgent:
        content.mcp?.userId === ctx.userId ||
        (ctx.canEditAll &&
          ROLES_FOR_SCOPE[WRITE_SCOPE].includes(brand.role) &&
          (post.type === 'PRESENTATION' || post.type === 'CAROUSEL')),
      slides,
    };
    const text = [
      `${post.name ?? '(sem nome)'} — ${structured.type}, ${structured.status}, ${slides.length} slides` +
        (structured.width ? ` (${structured.width}x${structured.height})` : ''),
      structured.editableViaAgent
        ? 'Você pode atualizar esta peça com save_presentation (postId).'
        : ctx.canEditAll
          ? 'Somente leitura: não é apresentação/carrossel, ou o papel do usuário nesta marca não permite editar.'
          : 'Somente leitura para esta conexão (ela só atualiza peças que criou).',
      ...slides.map((s) => `Slide ${s.index}: ${s.text || '(vazio)'}`),
    ].join('\n');
    return { text, structured };
  },
};
