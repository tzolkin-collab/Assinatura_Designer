import { z } from 'zod';
import { READ_SCOPE } from '../config.js';
import type { McpToolDefinition } from './types.js';

const inputSchema = {};
const outputSchema = {
  brands: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      role: z.enum(['OWNER', 'ADMIN', 'EDITOR', 'VIEWER']),
    }),
  ),
};

export const listBrandsTool: McpToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: 'list_brands',
  title: 'Listar marcas',
  description:
    'Lista as marcas do Designer que esta conexão pode acessar, com o slug, o nome e o papel do usuário em cada uma. ' +
    'Chame esta ferramenta primeiro: as demais exigem o `brandSlug` de uma marca desta lista. ' +
    'Não recebe parâmetros. Só devolve marcas que o usuário liberou ao conectar e de que ainda é membro.',
  scope: READ_SCOPE,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema,
  outputSchema,

  async handler(ctx) {
    // `ctx.grants` já é a interseção token × associação atual (ver authorization.ts).
    const brands = ctx.grants.map((g) => ({ slug: g.slug, name: g.name, role: g.role }));
    const text =
      brands.length === 0
        ? 'Nenhuma marca disponível para esta conexão.'
        : ['Marcas disponíveis:', ...brands.map((b) => `- ${b.name} (slug: ${b.slug}, papel: ${b.role})`)].join('\n');
    return { text, structured: { brands } };
  },
};
