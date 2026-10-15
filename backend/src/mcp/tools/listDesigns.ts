import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import { READ_SCOPE } from '../config.js';
import { editorUrl } from './designs.js';
import type { McpToolDefinition } from './types.js';

const inputSchema = {
  brandSlug: z.string().trim().min(1).max(100).describe('Slug da marca, de list_brands.'),
  limit: z.number().int().min(1).max(50).default(20).describe('Quantas peças listar, das mais recentes (até 50).'),
};

const outputSchema = {
  designs: z.array(
    z.object({
      postId: z.string(),
      name: z.string().nullable(),
      type: z.string(),
      status: z.string(),
      slideCount: z.number(),
      updatedAt: z.string(),
      viaAgent: z.boolean(),
      editorUrl: z.string().nullable(),
    }),
  ),
};

export const listDesignsTool: McpToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: 'list_designs',
  title: 'Listar peças da marca',
  description:
    'Lista as apresentações e carrosséis já criados para uma marca (mais recentes primeiro): id, nome, tipo, status, quantidade ' +
    'de slides e link do editor. Use para continuar uma peça existente (get_design) ou para não duplicar o que já existe.',
  scope: READ_SCOPE,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema,
  outputSchema,
  brandArg: 'brandSlug',

  async handler(ctx, args) {
    const brand = ctx.brand!;
    const rows = await prisma.post.findMany({
      where: { brandId: brand.id },
      orderBy: { updatedAt: 'desc' },
      take: args.limit ?? 20,
      select: { id: true, name: true, type: true, status: true, updatedAt: true, content: true, _count: { select: { slides: true } } },
    });
    const designs = rows.map((r) => ({
      postId: r.id,
      name: r.name,
      type: String(r.type),
      status: String(r.status),
      slideCount: r._count.slides,
      updatedAt: r.updatedAt.toISOString(),
      viaAgent: Boolean((r.content as { mcp?: unknown } | null)?.mcp),
      editorUrl: editorUrl(ctx.frontendOrigin, brand.slug, r.id),
    }));
    const text =
      designs.length === 0
        ? 'Nenhuma peça nesta marca ainda.'
        : [
            `Peças de ${brand.name} (${designs.length}):`,
            ...designs.map((d) => `- ${d.name ?? '(sem nome)'} [${d.type}, ${d.status}, ${d.slideCount} slides] postId: ${d.postId}`),
          ].join('\n');
    return { text, structured: { designs } };
  },
};
