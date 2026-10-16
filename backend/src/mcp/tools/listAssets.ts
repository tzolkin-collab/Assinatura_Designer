import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import { READ_SCOPE } from '../config.js';
import type { McpToolDefinition } from './types.js';

const MAX_LIMIT = 100;

const inputSchema = {
  brandSlug: z.string().trim().min(1).max(100).describe('Slug da marca, de list_brands.'),
  query: z.string().trim().max(100).optional().describe('Trecho do nome do arquivo.'),
  tag: z.string().trim().max(60).optional().describe('Só ativos com esta etiqueta (ex.: logo, foto, brandbook).'),
  source: z.enum(['upload', 'drive', 'asana', 'canva', 'branding', 'brandbook']).optional().describe('Origem do arquivo.'),
  imagesOnly: z
    .boolean()
    .default(true)
    .describe('true (padrão) devolve só imagens, que são o que entra num slide. false inclui fontes e outros arquivos.'),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(50).describe('Quantos devolver, dos mais recentes.'),
};

const assetSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  fileType: z.string(),
  source: z.string(),
  tags: z.array(z.string()),
  width: z.number().nullable(),
  height: z.number().nullable(),
  /** `base` quando o arquivo é do projeto-base de um collab. */
  origin: z.enum(['brand', 'base']),
});

const outputSchema = {
  assets: z.array(assetSchema),
  total: z.number(),
  truncated: z.boolean(),
};

export const listAssetsTool: McpToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: 'list_assets',
  title: 'Listar a biblioteca de mídia',
  description:
    'Lista os arquivos reais da biblioteca da marca (fotos, logos, elementos gráficos), com a URL exata para usar num slide. ' +
    'Só estes arquivos podem aparecer numa peça: nunca invente uma URL nem use banco de imagem. Imagens geradas por IA ficam de ' +
    'fora (a regra de foto real vale). Num collab, a biblioteca do projeto-base também aparece (`origin: "base"`).',
  scope: READ_SCOPE,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema,
  outputSchema,
  brandArg: 'brandSlug',

  async handler(ctx, args) {
    const brand = ctx.brand!;
    const limit = args.limit ?? 50;
    const imagesOnly = args.imagesOnly ?? true;

    const parent = await prisma.brand.findUnique({ where: { id: brand.id }, select: { parentBrandId: true } });
    const brandIds = [brand.id, ...(parent?.parentBrandId ? [parent.parentBrandId] : [])];

    const rows = await prisma.asset.findMany({
      where: {
        brandId: { in: brandIds },
        // Foto real: o que a IA gerou nunca é oferecido ao agente.
        NOT: { source: 'ai-generated' },
        ...(imagesOnly ? { fileType: { startsWith: 'image/' } } : {}),
        ...(args.source ? { source: args.source } : {}),
        ...(args.tag ? { tags: { has: args.tag } } : {}),
        ...(args.query ? { name: { contains: args.query, mode: 'insensitive' as const } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      select: { id: true, name: true, url: true, fileType: true, source: true, tags: true, width: true, height: true, brandId: true },
    });

    const truncated = rows.length > limit;
    const assets = rows.slice(0, limit).map((a) => ({
      id: a.id,
      name: a.name,
      url: a.url,
      fileType: a.fileType,
      source: a.source,
      tags: a.tags,
      width: a.width ?? null,
      height: a.height ?? null,
      origin: a.brandId === brand.id ? ('brand' as const) : ('base' as const),
    }));

    const text = assets.length
      ? [
          `${assets.length} arquivo(s)${truncated ? ' (há mais; refine com query, tag ou source)' : ''}:`,
          ...assets.map(
            (a) => `- ${a.name} [${a.tags.join(',') || 'sem etiqueta'}] ${a.width && a.height ? `${a.width}x${a.height} ` : ''}${a.url}`,
          ),
        ].join('\n')
      : 'Nenhum arquivo encontrado com esses filtros. Sem foto real, reserve a área com <div data-photo-slot> vazio.';
    return { text, structured: { assets, total: assets.length, truncated } };
  },
};
