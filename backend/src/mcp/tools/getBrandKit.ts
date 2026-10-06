import { z } from 'zod';
import { resolveBrandContext } from '../../lib/brandContext.js';
import { READ_SCOPE } from '../config.js';
import type { McpToolDefinition } from './types.js';

/**
 * Teto do texto de diretrizes devolvido ao modelo. Diretrizes de marca podem ser
 * longas (brandbooks colados inteiros); mandar tudo gasta o contexto do ChatGPT sem
 * ajudar. Quando corta, `guidelinesTruncated` avisa — não é um corte silencioso.
 */
const MAX_GUIDELINES_CHARS = 4000;

const inputSchema = {
  brandSlug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe('Slug da marca, exatamente como devolvido por list_brands (ex.: "minha-marca").'),
};

const outputSchema = {
  slug: z.string(),
  name: z.string(),
  role: z.enum(['OWNER', 'ADMIN', 'EDITOR', 'VIEWER']),
  colors: z.array(z.string()),
  fonts: z.array(z.string()),
  logoUrl: z.string().nullable(),
  guidelines: z.string(),
  guidelinesTruncated: z.boolean(),
  visual: z.object({
    vibe: z.string().nullable(),
    paletteDirection: z.string().nullable(),
    approvedPalette: z.array(z.string()),
    photoPreference: z.string().nullable(),
    boldness: z.string().nullable(),
    allowSvgLayouts: z.boolean(),
  }),
};

export const getBrandKitTool: McpToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: 'get_brand_kit',
  title: 'Ler o kit de marca',
  description:
    'Devolve o kit visual de UMA marca: cores, fontes, logo, diretrizes de marca e preferências visuais (vibe, paleta, fotos, ousadia). ' +
    'Use antes de propor ou criar qualquer peça, para respeitar a identidade da marca. ' +
    'Exige o `brandSlug` obtido em list_brands; marcas que não estão nessa lista são recusadas.',
  scope: READ_SCOPE,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema,
  outputSchema,
  // O registro autoriza a marca (token × associação atual) antes de chegar aqui.
  brandArg: 'brandSlug',

  async handler(ctx) {
    const brand = ctx.brand!;
    // Reaproveita a mesma leitura que alimenta o pipeline de geração. Não autoriza nada
    // por si (ver o aviso em brandContext.ts) — a autorização já foi feita no registro.
    const context = await resolveBrandContext(brand.slug);

    const truncated = context.guidelines.length > MAX_GUIDELINES_CHARS;
    const guidelines = truncated ? context.guidelines.slice(0, MAX_GUIDELINES_CHARS) : context.guidelines;
    const presentation = context.presentationConfig ?? {};

    const structured = {
      slug: brand.slug,
      name: brand.name,
      role: brand.role,
      colors: context.colors,
      fonts: context.primaryFonts,
      logoUrl: context.logoUrl ?? null,
      guidelines,
      guidelinesTruncated: truncated,
      visual: {
        vibe: presentation.visualVibe ?? null,
        paletteDirection: presentation.paletteDirection ?? null,
        approvedPalette: presentation.paletteApproved ?? [],
        photoPreference: presentation.photoPreference ?? null,
        boldness: presentation.boldness ?? null,
        // O default do produto é permitir SVG; só `false` explícito desliga.
        allowSvgLayouts: presentation.allowSvgLayouts !== false,
      },
    };

    const lines = [
      `Marca: ${brand.name} (slug: ${brand.slug}) — seu papel: ${brand.role}`,
      `Cores: ${structured.colors.length ? structured.colors.join(', ') : '(nenhuma definida)'}`,
      `Fontes: ${structured.fonts.length ? structured.fonts.join(', ') : '(nenhuma definida)'}`,
      `Logo: ${structured.logoUrl ?? '(sem logo)'}`,
      structured.visual.vibe ? `Vibe visual: ${structured.visual.vibe}` : '',
      structured.visual.paletteDirection ? `Direção de paleta: ${structured.visual.paletteDirection}` : '',
      structured.visual.approvedPalette.length ? `Paleta aprovada: ${structured.visual.approvedPalette.join(', ')}` : '',
      structured.visual.photoPreference ? `Preferência de fotos: ${structured.visual.photoPreference}` : '',
      structured.visual.boldness ? `Ousadia: ${structured.visual.boldness}` : '',
      guidelines ? `Diretrizes${truncated ? ' (cortadas)' : ''}:\n${guidelines}` : 'Diretrizes: (nenhuma definida)',
    ].filter(Boolean);

    return { text: lines.join('\n'), structured };
  },
};
