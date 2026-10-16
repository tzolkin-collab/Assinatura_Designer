import { z } from 'zod';
import { logger } from '../../lib/logger.js';
import prisma from '../../lib/prisma.js';
import { r2KeyFromUrl } from '../../lib/r2.js';
import {
  CanvaNotConnectedError,
  readCanvaExportStatus,
  readDeckExportStatus,
  requestCanvaExport,
  requestDeckExport,
  type ExportablePost,
  type ExportStatus,
} from '../../lib/exportJobs.js';
import { EDITORS } from '../../middleware/brandAccess.js';
import { consumeRateLimit, type RateLimitPolicy } from '../../middleware/rateLimit.js';
import { EXPORT_SCOPE } from '../config.js';
import { editorUrl, loadReadableDesign } from './designs.js';
import { ToolUserError, type McpCallContext, type McpToolDefinition } from './types.js';

/**
 * Exportação de uma peça: arquivo (PDF, ZIP de PNGs, PPTX, HTML) e Canva.
 *
 * Trabalho longo é `export_*` (enfileira e devolve um job) + `get_*_status` (consulta): nenhuma chamada espera o render,
 * que passa de 60 s num deck grande. O arquivo sai como LINK; o binário nunca passa pelo MCP.
 *
 * Saída do Designer: escopo próprio (`designer.export`) e `openWorldHint: true`.
 */

/** Cada pedido renderiza no chromium do servidor: freia por conta, no mesmo balde para arquivo e Canva. */
export const EXPORT_RATE_LIMIT: RateLimitPolicy = { windowSec: 60, max: 6, keyPrefix: 'mcp-export' };

const brandSlug = z.string().trim().min(1).max(100).describe('Slug da marca, de list_brands.');
const postId = z.string().uuid().describe('Id da peça, de list_designs ou save_presentation.');
const jobId = z.string().trim().min(1).max(100).describe('Id do job devolvido pelo pedido de exportação.');

type Phase = 'queued' | 'running' | 'done' | 'failed';
const PHASES: Record<string, Phase> = { waiting: 'queued', delayed: 'queued', 'waiting-children': 'queued', prioritized: 'queued', active: 'running', completed: 'done', failed: 'failed' };
const phaseOf = (state: string): Phase => PHASES[state] ?? 'queued';

async function throttle(ctx: McpCallContext): Promise<void> {
  const limit = await consumeRateLimit(EXPORT_RATE_LIMIT, ctx.userId);
  if (!limit.allowed) {
    throw new ToolUserError(`Muitas exportações seguidas. Tente de novo em ${limit.retryAfterSec} s.`, 'rate_limited');
  }
}

/** Peça com os slides, que é o que a exportação lê. Mesma recusa para "não existe" e "é de outra marca". */
async function loadExportable(ctx: McpCallContext, id: string): Promise<ExportablePost> {
  await loadReadableDesign(ctx, id);
  const post = await prisma.post.findFirst({
    where: { id, brandId: ctx.brand!.id },
    include: { slides: { orderBy: { position: 'asc' } } },
  });
  if (!post) throw new ToolUserError('Peça não encontrada nesta marca.', 'post_not_found');
  return post as unknown as ExportablePost;
}

/** Erro 4xx de domínio da lib vira frase para o agente; o resto segue como erro interno (sem detalhe). */
function asToolError(err: unknown, code: string): never {
  const status = (err as { statusCode?: number }).statusCode;
  if (err instanceof Error && status !== undefined && status >= 400 && status < 500) throw new ToolUserError(err.message, code);
  throw err;
}

/** A falha do worker pode trazer caminho de arquivo e pilha: o agente recebe só uma frase, o detalhe vai para o log. */
function publicFailure(status: ExportStatus, ctx: McpCallContext, tool: string): string | undefined {
  if (status.status !== 'failed') return undefined;
  logger.warn('mcp.export_failed', { tool, userId: ctx.userId, jobId: status.jobId, reason: status.error });
  return 'A exportação falhou no servidor. Tente de novo; se repetir, avise o usuário.';
}

// ── export_file ─────────────────────────────────────────────────────────────────────────────────

const FORMATS = ['pdf', 'zip', 'pptx', 'html'] as const;

const fileInput = {
  brandSlug,
  postId,
  format: z
    .enum(FORMATS)
    .describe('pdf (texto de verdade, não imagem), zip (um PNG por slide), pptx (editável: texto continua texto) ou html.'),
};

const requestOutput = {
  postId: z.string(),
  jobId: z.string(),
  total: z.number(),
  status: z.literal('queued'),
};

export const exportFileTool: McpToolDefinition<typeof fileInput, typeof requestOutput> = {
  name: 'export_file',
  title: 'Exportar a peça como arquivo',
  description:
    'Pede a exportação da peça como PDF, ZIP de PNGs, PPTX editável ou HTML. É assíncrono: devolve um `jobId`; consulte ' +
    'get_export_status até `status: "done"` para receber o link de download. Só decks de slides (html-design). ' +
    'Há limite de pedidos por minuto: não repita a chamada enquanto o job está em andamento.',
  scope: EXPORT_SCOPE,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: fileInput,
  outputSchema: requestOutput,
  brandArg: 'brandSlug',

  async handler(ctx, args) {
    await throttle(ctx);
    const post = await loadExportable(ctx, args.postId);
    let requested;
    try {
      requested = await requestDeckExport(post, ctx.userId, args.format);
    } catch (err) {
      asToolError(err, 'export_rejected');
    }
    const text = `Exportação ${args.format.toUpperCase()} enfileirada (${requested.total} slides). jobId: ${requested.jobId}\nConsulte get_export_status com este jobId até ficar pronto.`;
    return { text, structured: { postId: args.postId, jobId: requested.jobId, total: requested.total, status: 'queued' as const } };
  },
};

// ── get_export_status ───────────────────────────────────────────────────────────────────────────

const statusInput = { brandSlug, postId, jobId };

const fileStatusOutput = {
  postId: z.string(),
  jobId: z.string(),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  done: z.number(),
  total: z.number(),
  downloadUrl: z.string().nullable(),
  fileName: z.string().nullable(),
  format: z.string().nullable(),
  error: z.string().nullable(),
};

export const getExportStatusTool: McpToolDefinition<typeof statusInput, typeof fileStatusOutput> = {
  name: 'get_export_status',
  title: 'Ver o andamento de uma exportação de arquivo',
  description:
    'Mostra o andamento de um export_file: queued, running (com slides prontos/total), done (com o link de download) ou failed. ' +
    'Só quem pediu a exportação a vê. Espere alguns segundos entre as consultas. O link é privado: entregue-o ao usuário, não o publique.',
  scope: EXPORT_SCOPE,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: statusInput,
  outputSchema: fileStatusOutput,
  brandArg: 'brandSlug',

  async handler(ctx, args) {
    await loadReadableDesign(ctx, args.postId);
    let st: ExportStatus;
    try {
      st = await readDeckExportStatus(args.jobId, ctx.userId, args.postId);
    } catch (err) {
      return asToolError(err, 'job_unavailable');
    }

    const result = (st.result ?? null) as { url?: string; fileName?: string; format?: string } | null;
    // Só devolve link do NOSSO storage: um resultado com URL de fora não chega ao agente.
    const downloadUrl = st.status === 'completed' && result?.url && r2KeyFromUrl(result.url) ? result.url : null;
    const phase = phaseOf(st.status);
    const structured = {
      postId: args.postId,
      jobId: args.jobId,
      status: phase,
      done: st.done,
      total: st.total,
      downloadUrl,
      fileName: downloadUrl ? (result?.fileName ?? null) : null,
      format: downloadUrl ? (result?.format ?? null) : null,
      error: publicFailure(st, ctx, 'get_export_status') ?? null,
    };
    const text =
      phase === 'done'
        ? downloadUrl
          ? `Pronto: ${structured.fileName ?? 'arquivo'}\n${downloadUrl}`
          : 'A exportação terminou sem arquivo associado. Peça de novo.'
        : phase === 'failed'
          ? structured.error!
          : `${phase === 'queued' ? 'Na fila' : 'Renderizando'}: ${st.done}/${st.total} slides.`;
    return { text, structured };
  },
};

// ── export_to_canva ─────────────────────────────────────────────────────────────────────────────

const canvaInput = {
  brandSlug,
  postId,
  mode: z
    .enum(['png', 'pptx'])
    .default('png')
    .describe('png: arte pronta, rasterizada (um design por slide ou um para o deck). pptx: design EDITÁVEL via importação do Canva.'),
  slide: z
    .number()
    .int()
    .min(1)
    .max(60)
    .optional()
    .describe('Só no modo png: exporta apenas este slide (a partir de 1). Sem ele, o deck inteiro. No pptx o deck sempre vai inteiro.'),
};

const canvaRequestOutput = {
  postId: z.string(),
  jobId: z.string(),
  total: z.number(),
  mode: z.enum(['png', 'pptx']),
  status: z.literal('queued'),
};

export const exportToCanvaTool: McpToolDefinition<typeof canvaInput, typeof canvaRequestOutput> = {
  name: 'export_to_canva',
  title: 'Exportar a peça para o Canva',
  description:
    'Envia a peça para a conta do Canva do USUÁRIO que está conectado (não a da marca). Exige que ele tenha conectado o Canva ' +
    '(veja get_integrations_status) e papel de editor, administrador ou dono na marca. É assíncrono: devolve um `jobId`; consulte ' +
    'get_canva_export_status até `status: "done"` para receber o link do design. Cria designs novos no Canva dele: não repita sem necessidade.',
  scope: EXPORT_SCOPE,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: canvaInput,
  outputSchema: canvaRequestOutput,
  brandArg: 'brandSlug',

  async handler(ctx, args) {
    // Como na rota (EDITORS): leitor pode baixar arquivo, mas não criar design na conta de Canva de quem pediu.
    if (!EDITORS.includes(ctx.brand!.role)) {
      throw new ToolUserError('Exportar para o Canva exige papel de editor, administrador ou dono nesta marca.', 'insufficient_role');
    }
    await throttle(ctx);
    const post = await loadExportable(ctx, args.postId);
    const mode = args.mode ?? 'png';

    let requested;
    try {
      requested = await requestCanvaExport(post, ctx.userId, { mode, slideIndex: args.slide === undefined ? undefined : args.slide - 1 });
    } catch (err) {
      if (err instanceof CanvaNotConnectedError) {
        throw new ToolUserError('O usuário não conectou o Canva. Peça a ele para conectar em Configurações > Integrações no Designer.', 'canva_not_connected');
      }
      asToolError(err, 'export_rejected');
    }
    const text = `Exportação para o Canva (${mode}) enfileirada (${requested.total} slide(s)). jobId: ${requested.jobId}\nConsulte get_canva_export_status com este jobId.`;
    return { text, structured: { postId: args.postId, jobId: requested.jobId, total: requested.total, mode, status: 'queued' as const } };
  },
};

// ── get_canva_export_status ─────────────────────────────────────────────────────────────────────

const canvaStatusOutput = {
  postId: z.string(),
  jobId: z.string(),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  done: z.number(),
  total: z.number(),
  designUrl: z.string().nullable(),
  designIds: z.array(z.string()),
  editorUrl: z.string().nullable(),
  error: z.string().nullable(),
};

export const getCanvaExportStatusTool: McpToolDefinition<typeof statusInput, typeof canvaStatusOutput> = {
  name: 'get_canva_export_status',
  title: 'Ver o andamento de uma exportação para o Canva',
  description:
    'Mostra o andamento de um export_to_canva: queued, running (slides enviados/total), done (com o link do design no Canva) ou failed. ' +
    'Só quem pediu a exportação a vê. Espere alguns segundos entre as consultas.',
  scope: EXPORT_SCOPE,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: statusInput,
  outputSchema: canvaStatusOutput,
  brandArg: 'brandSlug',

  async handler(ctx, args) {
    await loadReadableDesign(ctx, args.postId);
    let st: ExportStatus;
    try {
      st = await readCanvaExportStatus(args.jobId, ctx.userId, args.postId);
    } catch (err) {
      return asToolError(err, 'job_unavailable');
    }

    const result = (st.result ?? null) as { designUrl?: string; designIds?: string[]; designId?: string } | null;
    const phase = phaseOf(st.status);
    const done = st.status === 'completed';
    // O link do Canva só é aceito se for https: nada de esquema estranho chegando ao agente.
    const designUrl = done && typeof result?.designUrl === 'string' && /^https:\/\//i.test(result.designUrl) ? result.designUrl : null;
    const designIds = done ? (result?.designIds ?? (result?.designId ? [result.designId] : [])) : [];
    const structured = {
      postId: args.postId,
      jobId: args.jobId,
      status: phase,
      done: st.done,
      total: st.total,
      designUrl,
      designIds,
      editorUrl: editorUrl(ctx.frontendOrigin, ctx.brand!.slug, args.postId),
      error: publicFailure(st, ctx, 'get_canva_export_status') ?? null,
    };
    const text =
      phase === 'done'
        ? designUrl
          ? `Pronto no Canva: ${designUrl}`
          : `Exportado para o Canva (${designIds.length} design(s)); o Canva não devolveu um link direto.`
        : phase === 'failed'
          ? structured.error!
          : `${phase === 'queued' ? 'Na fila' : 'Enviando'}: ${st.done}/${st.total} slides.`;
    return { text, structured };
  },
};
