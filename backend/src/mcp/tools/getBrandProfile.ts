import { z } from 'zod';
import { brandProfileSchema, profileCompleteness, profileFromLegacy, type BrandProfileData } from '../../lib/brandProfile.js';
import prisma from '../../lib/prisma.js';
import { READ_SCOPE } from '../config.js';
import type { McpToolDefinition } from './types.js';

const inputSchema = {
  brandSlug: z.string().trim().min(1).max(100).describe('Slug da marca, de list_brands.'),
};

const outputSchema = {
  slug: z.string(),
  /** `true` quando a marca ainda não tem ficha salva: o conteúdo foi derivado do que o sistema já tinha. */
  derived: z.boolean(),
  profile: z.record(z.string(), z.unknown()),
  completeness: z.object({
    percent: z.number(),
    ready: z.boolean(),
    pending: z.array(z.object({ key: z.string(), label: z.string(), required: z.boolean() })),
  }),
};

export const getBrandProfileTool: McpToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: 'get_brand_profile',
  title: 'Ler a ficha do Cérebro da marca',
  description:
    'Devolve a ficha do projeto (Cérebro de IA): essência, tom, paleta com função de cada cor, tipografia, logos, direção de arte, ' +
    'regra de foto real, elementos gráficos, o que NUNCA fazer, ativos e critério de aprovação — e o que ainda falta preencher. ' +
    'Leia antes de desenhar: as regras da ficha valem mais que o seu gosto. `derived: true` significa que a marca ainda não ' +
    'salvou uma ficha e o conteúdo veio dos campos antigos (cores, fontes, logo, diretrizes).',
  scope: READ_SCOPE,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema,
  outputSchema,
  brandArg: 'brandSlug',

  async handler(ctx) {
    const brand = ctx.brand!;
    const row = await prisma.brandProfile.findUnique({ where: { brandId: brand.id } });

    let profile: BrandProfileData;
    if (row) {
      // Mesma tolerância da tela: dado gravado fora do esquema cai na ficha vazia e a pendência aparece.
      const parsed = brandProfileSchema.safeParse(row.data);
      profile = parsed.success ? parsed.data : {};
    } else {
      const config = await prisma.brandConfig.findUnique({ where: { brandId: brand.id } });
      profile = profileFromLegacy(config);
    }

    const completeness = profileCompleteness(profile);
    const structured = {
      slug: brand.slug,
      derived: !row,
      profile: profile as Record<string, unknown>,
      completeness,
    };
    const text = [
      `Ficha de ${brand.name} (${brand.slug}): ${completeness.percent}% preenchida, ${completeness.ready ? 'pronta' : 'NÃO pronta'} para criar.${row ? '' : ' (derivada dos campos antigos; nada salvo)'}`,
      completeness.pending.length
        ? `Pendências: ${completeness.pending.map((p) => `${p.label}${p.required ? ' (obrigatório)' : ''}`).join('; ')}.`
        : 'Sem pendências.',
      '',
      JSON.stringify(profile),
    ].join('\n');
    return { text, structured };
  },
};
