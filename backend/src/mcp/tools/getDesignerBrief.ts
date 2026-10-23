import { z } from 'zod';
import { buildBrandContextSummary, resolveBrandContext } from '../../lib/brandContext.js';
import { resolveCanvasSize } from '../../lib/canvasSize.js';
import { resolveFontRefs } from '../../lib/customFonts.js';
import {
  DesignerBrainSetupError,
  buildPipelineBrainContext,
  loadBrainLayers,
  onlyProvidedAssets,
} from '../../lib/designerBrain/index.js';
import { PHOTO_SLOT_RULE, brainTextRule, logoBackgroundRule } from '../../lib/htmlDesign.js';
import { READ_SCOPE } from '../config.js';
import { DESIGNER_WORKFLOW_CHECKLIST, HTML_OUTPUT_CONTRACT } from './htmlContract.js';
import type { McpToolDefinition } from './types.js';

/** Teto de assets devolvidos: lista longa gasta o contexto do agente sem ajudar. */
const MAX_ASSETS = 40;
/** Teto do bloco de regras. As regras de marca costumam caber folgadas; o corte é avisado. */
const MAX_RULES_CHARS = 14_000;

const inputSchema = {
  brandSlug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe('Slug da marca, exatamente como devolvido por list_brands.'),
  format: z
    .enum(['presentation', 'carousel'])
    .default('presentation')
    .describe('"presentation" (16:9, slides) ou "carousel" (peças sociais; use aspectRatio).'),
  aspectRatio: z
    .enum(['1:1', '4:5', '3:4', '9:16', '16:9'])
    .optional()
    .describe('Só para carousel. Padrão 1:1. Apresentação é sempre 16:9.'),
  pageCount: z.number().int().min(1).max(60).optional().describe('Quantidade de slides pedida, quando fechada.'),
};

const outputSchema = {
  brand: z.object({ slug: z.string(), name: z.string() }),
  canvas: z.object({ width: z.number(), height: z.number(), format: z.string(), aspectRatio: z.string() }),
  rules: z.string(),
  rulesTruncated: z.boolean(),
  brainActive: z.boolean(),
  pending: z.array(z.string()),
  htmlContract: z.string(),
  textRule: z.string(),
  photoSlotRule: z.string(),
  checklist: z.array(z.string()),
  palette: z.array(z.string()),
  fonts: z.object({
    own: z.array(z.object({ family: z.string(), faces: z.array(z.object({ weight: z.string(), style: z.string() })) })),
    google: z.array(z.string()),
  }),
  logoUrl: z.string().nullable(),
  logoVariants: z.array(z.object({ label: z.string(), url: z.string() })),
  logoRule: z.string(),
  assets: z.array(z.object({ name: z.string(), url: z.string(), source: z.string().nullable() })),
  assetsTotal: z.number(),
  assetsTruncated: z.boolean(),
};

export const getDesignerBriefTool: McpToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: 'get_designer_brief',
  title: 'Ler o brief do Designer',
  description:
    'Devolve TUDO que você precisa para desenhar uma peça desta marca: regras da marca e do estúdio (fidelidade ao texto, ' +
    'foto real, identidade, proibições), o tamanho do canvas, o contrato do HTML, as fontes (próprias, com os pesos disponíveis, ' +
    'e do Google), a paleta, o logo e a lista de arquivos de imagem reais que você pode usar. ' +
    'Chame DEPOIS de list_brands e ANTES de escrever os slides; releia se o usuário mudar o formato. ' +
    'As regras do campo `rules` têm prioridade sobre o seu gosto: o texto aprovado é literal e nenhuma pessoa ou foto é gerada.',
  scope: READ_SCOPE,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema,
  outputSchema,
  brandArg: 'brandSlug',

  async handler(ctx, args) {
    const grant = ctx.brand!;
    const format = args.format ?? 'presentation';
    const canvas = resolveCanvasSize(format, args.aspectRatio);
    const aspectRatio = format === 'presentation' ? '16:9' : (args.aspectRatio ?? '1:1');

    const [brand, layers] = await Promise.all([resolveBrandContext(grant.slug), loadBrainLayers(grant.slug)]);
    const profile = layers?.projectProfile ?? null;

    // Cérebro em camadas (global → projeto → collab → modo → foto → revisão). Sem memória de projeto (sem ficha,
    // sem "Instruções do agente" e sem seed) este brief cai no resumo de marca, como no legado. Já o pipeline
    // interno, com o cérebro global ligado (padrão), liga o cérebro em todo projeto e usa o resumo do cadastro
    // como memória, com a pendência avisada: o comportamento deste MCP é outro, e não foi alterado.
    let rules: string;
    let pending: string[] = [];
    let brainActive = false;
    try {
      const brain = buildPipelineBrainContext({
        brand: { slug: grant.slug, name: brand.name, agentPrompt: brand.agentPrompt },
        profile,
        projectName: layers?.projectName,
        collab: layers?.collab ?? null,
        format,
        aspectRatio: args.aspectRatio,
        pageCount: args.pageCount,
      });
      rules = brain.brandContext;
      pending = brain.pending;
      brainActive = true;
    } catch (err) {
      if (!(err instanceof DesignerBrainSetupError)) throw err;
      rules = buildBrandContextSummary(brand);
    }
    const rulesTruncated = rules.length > MAX_RULES_CHARS;
    if (rulesTruncated) rules = rules.slice(0, MAX_RULES_CHARS);

    // Fontes próprias (arquivo enviado à biblioteca): família + pesos reais que o agente pode pedir.
    const refs = profile ? await resolveFontRefs(profile.typography ?? [], brand.libraryBrandIds) : [];
    const ownByFamily = new Map<string, Array<{ weight: string; style: string }>>();
    for (const r of refs) {
      const list = ownByFamily.get(r.family) ?? [];
      list.push({ weight: r.weight ?? '100 900', style: r.style ?? 'normal' });
      ownByFamily.set(r.family, list);
    }
    const own = [...ownByFamily.entries()].map(([family, faces]) => ({ family, faces }));
    const ownNames = new Set(own.map((o) => o.family.toLowerCase()));
    const google = brand.primaryFonts.filter((f) => !ownNames.has(f.toLowerCase()));

    // Logos oficiais da ficha (uma variante por cor de fundo): o agente escolhe pela cor do slide, como o
    // artista interno. Saem da lista de arquivos para não aparecerem duas vezes.
    const logoVariants = (profile?.logo?.files ?? []).map((f) => ({ label: f.label ?? 'Logo', url: f.url }));
    const logoUrls = new Set(logoVariants.map((l) => l.url));

    // Só o que alguém FORNECEU (nunca o que o sistema gerou por IA): é a regra de foto real.
    const provided = onlyProvidedAssets(brand.assetUrls).filter((a) => !logoUrls.has(a.url));
    const assets = provided.slice(0, MAX_ASSETS).map((a) => ({ name: a.name, url: a.url, source: a.source ?? null }));

    const hasLogo = Boolean(brand.logoUrl) || logoVariants.length > 0;
    const structured = {
      brand: { slug: grant.slug, name: brand.name },
      canvas: { ...canvas, format, aspectRatio },
      rules,
      rulesTruncated,
      brainActive,
      pending,
      htmlContract: HTML_OUTPUT_CONTRACT,
      textRule: brainTextRule(hasLogo),
      photoSlotRule: PHOTO_SLOT_RULE,
      checklist: [...DESIGNER_WORKFLOW_CHECKLIST],
      palette: brand.colors,
      fonts: { own, google },
      logoUrl: brand.logoUrl ?? null,
      logoVariants,
      logoRule: logoBackgroundRule(logoVariants.length > 0),
      assets,
      assetsTotal: provided.length,
      assetsTruncated: provided.length > MAX_ASSETS,
    };

    const text = [
      `BRIEF DO DESIGNER — ${brand.name} (${grant.slug})`,
      `Canvas: ${canvas.width}x${canvas.height} (${format}, ${aspectRatio})`,
      rulesTruncated ? '(as regras foram cortadas no teto de tamanho)' : '',
      '',
      '=== REGRAS DA MARCA E DO ESTÚDIO ===',
      rules,
      pending.length ? `\nO que falta saber (não invente): ${pending.join('; ')}` : '',
      '',
      '=== TEXTO NA ARTE ===',
      structured.textRule,
      '',
      '=== ESPAÇO DE FOTO ===',
      PHOTO_SLOT_RULE,
      '',
      '=== ' + HTML_OUTPUT_CONTRACT.split('\n')[0]!.replace(/:$/, '') + ' ===',
      HTML_OUTPUT_CONTRACT.split('\n').slice(1).join('\n'),
      '',
      `Paleta: ${structured.palette.length ? structured.palette.join(', ') : '(nenhuma definida)'}`,
      own.length
        ? `Fontes PRÓPRIAS (já embutidas; use font-family exatamente assim): ${own
            .map((o) => `${o.family} [pesos ${o.faces.map((f) => `${f.weight}${f.style === 'italic' ? ' italic' : ''}`).join(', ')}]`)
            .join('; ')}`
        : '',
      google.length ? `Fontes do Google: ${google.join(', ')}` : '',
      structured.logoUrl ? `Logo: ${structured.logoUrl}` : '',
      logoVariants.length
        ? [
            'Logos oficiais (variantes; escolha pela cor do fundo do slide):',
            ...logoVariants.map((l) => `- ${l.label}: ${l.url}`),
            structured.logoRule,
          ].join('\n')
        : structured.logoUrl
          ? structured.logoRule
          : 'Logo: (sem logo cadastrado; não invente um nem escreva o nome da marca no lugar dele).',
      assets.length
        ? `Arquivos reais disponíveis (${assets.length} de ${provided.length}):\n${assets.map((a) => `- ${a.name}: ${a.url}`).join('\n')}`
        : 'Arquivos reais disponíveis: nenhum. Reserve a área de foto, vazia, onde fizer sentido.',
      '',
      'CHECKLIST ANTES DE ENVIAR:',
      ...DESIGNER_WORKFLOW_CHECKLIST.map((c) => `- ${c}`),
    ]
      .filter((l) => l !== null)
      .join('\n');

    return { text, structured };
  },
};
