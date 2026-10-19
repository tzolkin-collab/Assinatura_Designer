/** Utilidades compartilhadas pelas ferramentas de peças (save_presentation, list_designs, get_design e as de edição). */
import prisma from '../../lib/prisma.js';
import { ToolUserError, type McpCallContext } from './types.js';

export interface DesignRow {
  id: string;
  type: string;
  name: string | null;
  content: unknown;
}

/** Peça da MARCA AUTORIZADA (nunca de outra). Leitura: qualquer peça. Mesma recusa para "não existe" e "é de outra marca". */
export async function loadReadableDesign(ctx: McpCallContext, postId: string): Promise<DesignRow> {
  const row = await prisma.post.findFirst({
    where: { id: postId, brandId: ctx.brand!.id },
    select: { id: true, type: true, name: true, content: true },
  });
  if (!row) throw new ToolUserError('Peça não encontrada nesta marca.', 'post_not_found');
  return row;
}

/**
 * Peça que este agente pode ALTERAR: a que o usuário criou por MCP, ou — com `designer.edit_all` — qualquer
 * apresentação ou carrossel da marca. A mesma regra do `save_presentation`; o papel (EDITOR+) já foi exigido
 * pelo escopo de escrita antes de chegar aqui.
 */
export async function loadMutableDesign(ctx: McpCallContext, postId: string): Promise<DesignRow> {
  const row = await prisma.post.findFirst({
    where: { id: postId, brandId: ctx.brand!.id },
    select: { id: true, type: true, name: true, content: true },
  });
  const owner = (row?.content as { mcp?: { userId?: string } } | null)?.mcp?.userId;
  const editableType = row?.type === 'PRESENTATION' || row?.type === 'CAROUSEL';
  if (!row || !(owner === ctx.userId || (ctx.canEditAll && editableType))) {
    throw new ToolUserError(
      ctx.canEditAll
        ? 'Peça não encontrada nesta marca, ou não é uma apresentação/carrossel.'
        : 'Peça não encontrada, ou não foi criada por você nesta conexão.',
      'post_unavailable',
    );
  }
  return row;
}

/** Link do editor da peça no frontend (onde o usuário acompanha e edita). `null` sem origem configurada. */
export function editorUrl(origin: string | undefined, brandSlug: string, postId: string): string | null {
  if (!origin) return null;
  return `${origin.replace(/\/+$/, '')}/${encodeURIComponent(brandSlug)}/editor/${encodeURIComponent(postId)}`;
}

/** Lista curta das divergências, para o texto que o agente lê. */
export function summarizeIssues(issues: Array<{ slide: number; description: string }>): string {
  return issues
    .slice(0, 12)
    .map((i) => `- Slide ${i.slide}: ${i.description}`)
    .join('\n');
}
