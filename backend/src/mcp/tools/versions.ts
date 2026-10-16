import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import { restorePostVersion, snapshotPost } from '../../lib/postVersions.js';
import { READ_SCOPE, WRITE_SCOPE } from '../config.js';
import { editorUrl, loadMutableDesign, loadReadableDesign } from './designs.js';
import { ToolUserError, type McpToolDefinition } from './types.js';

/**
 * Histórico de versões de uma peça: ver, marcar um ponto de retorno e voltar.
 * O mesmo mecanismo do editor (`lib/postVersions.ts`); o estado atual sempre vira uma versão antes de ser sobrescrito.
 */

const brandSlug = z.string().trim().min(1).max(100).describe('Slug da marca, de list_brands.');
const postId = z.string().uuid().describe('Id da peça, de list_designs ou save_presentation.');

// ── list_versions ───────────────────────────────────────────────────────────────────────────────

const listInput = {
  brandSlug,
  postId,
  limit: z.number().int().min(1).max(50).default(20).describe('Quantas versões listar, das mais recentes.'),
};

const listOutput = {
  postId: z.string(),
  versions: z.array(
    z.object({
      versionId: z.string(),
      label: z.string().nullable(),
      source: z.string(),
      slideCount: z.number(),
      createdAt: z.string(),
      createdBy: z.string().nullable(),
    }),
  ),
};

export const listVersionsTool: McpToolDefinition<typeof listInput, typeof listOutput> = {
  name: 'list_versions',
  title: 'Listar versões de uma peça',
  description:
    'Lista o histórico de uma peça (mais recentes primeiro): id, rótulo, origem (MANUAL, EDITOR, AI, RESTORE), quantidade de slides e ' +
    'quando foi guardada. Use para saber a que ponto voltar com restore_version. Cada edição e cada save_presentation de ' +
    'atualização guardam a versão anterior.',
  scope: READ_SCOPE,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: listInput,
  outputSchema: listOutput,
  brandArg: 'brandSlug',

  async handler(ctx, args) {
    await loadReadableDesign(ctx, args.postId);
    const rows = await prisma.postVersion.findMany({
      where: { postId: args.postId },
      orderBy: { createdAt: 'desc' },
      take: args.limit ?? 20,
      select: {
        id: true,
        label: true,
        source: true,
        slideCount: true,
        createdAt: true,
        createdBy: { select: { name: true } },
      },
    });
    const versions = rows.map((v) => ({
      versionId: v.id,
      label: v.label ?? null,
      source: String(v.source),
      slideCount: v.slideCount,
      createdAt: v.createdAt.toISOString(),
      createdBy: v.createdBy?.name ?? null,
    }));
    const text = versions.length
      ? [
          `${versions.length} versão(ões):`,
          ...versions.map((v) => `- ${v.versionId} · ${v.createdAt} · ${v.source} · ${v.slideCount} slides${v.label ? ` · ${v.label}` : ''}`),
        ].join('\n')
      : 'Esta peça ainda não tem versões guardadas.';
    return { text, structured: { postId: args.postId, versions } };
  },
};

// ── create_version ──────────────────────────────────────────────────────────────────────────────

const createInput = {
  brandSlug,
  postId,
  label: z.string().trim().min(1).max(160).optional().describe('Nome do ponto de retorno (ex.: "antes de trocar a capa").'),
};

const createOutput = {
  postId: z.string(),
  created: z.boolean(),
  versionId: z.string().nullable(),
};

export const createVersionTool: McpToolDefinition<typeof createInput, typeof createOutput> = {
  name: 'create_version',
  title: 'Marcar um ponto de retorno',
  description:
    'Guarda o estado atual da peça como uma versão com rótulo, para poder voltar a ele depois com restore_version. ' +
    'Faça antes de uma mudança grande. Se nada mudou desde a última versão, devolve `created: false` (já está guardado).',
  scope: WRITE_SCOPE,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: createInput,
  outputSchema: createOutput,
  brandArg: 'brandSlug',

  async handler(ctx, args) {
    await loadMutableDesign(ctx, args.postId);
    const version = await snapshotPost(args.postId, { source: 'MANUAL', label: args.label, userId: ctx.userId });
    const text = version
      ? `Versão guardada (${version.id})${args.label ? `: ${args.label}` : ''}.`
      : 'Nada mudou desde a última versão: já está guardado.';
    return { text, structured: { postId: args.postId, created: !!version, versionId: version?.id ?? null } };
  },
};

// ── restore_version ─────────────────────────────────────────────────────────────────────────────

const restoreInput = {
  brandSlug,
  postId,
  versionId: z.string().uuid().describe('Id da versão, de list_versions.'),
};

const restoreOutput = {
  postId: z.string(),
  restoredVersionId: z.string(),
  slideCount: z.number(),
  editorUrl: z.string().nullable(),
};

export const restoreVersionTool: McpToolDefinition<typeof restoreInput, typeof restoreOutput> = {
  name: 'restore_version',
  title: 'Voltar a uma versão da peça',
  description:
    'Volta a peça ao estado de uma versão guardada. O estado atual vira uma nova versão antes de ser sobrescrito, então dá para ' +
    'desfazer o próprio restore. Substitui TODO o conteúdo da peça: confirme com o usuário quando houver trabalho recente.',
  scope: WRITE_SCOPE,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  inputSchema: restoreInput,
  outputSchema: restoreOutput,
  brandArg: 'brandSlug',

  async handler(ctx, args) {
    await loadMutableDesign(ctx, args.postId);

    let restored;
    try {
      restored = await restorePostVersion(args.postId, args.versionId, ctx.userId);
    } catch (err) {
      // restorePostVersion fala em HTTP (createError 404); aqui vira erro de domínio, sem stack.
      if (err instanceof Error && /Versão não encontrada/.test(err.message)) {
        throw new ToolUserError('Versão não encontrada para esta peça. Use list_versions.', 'version_not_found');
      }
      throw err;
    }

    const content = restored.content as { slides?: unknown[] } | null;
    const slideCount = Array.isArray(content?.slides) ? content!.slides!.length : 0;
    const url = editorUrl(ctx.frontendOrigin, ctx.brand!.slug, args.postId);
    const text = [`Peça restaurada para a versão ${args.versionId} (${slideCount} slides). O estado anterior ficou guardado no histórico.`, url ? `Editor: ${url}` : '']
      .filter(Boolean)
      .join('\n');
    return { text, structured: { postId: args.postId, restoredVersionId: args.versionId, slideCount, editorUrl: url } };
  },
};
