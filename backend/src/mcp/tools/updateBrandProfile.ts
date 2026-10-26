import { z } from 'zod';
import { brandProfileSchema, profileCompleteness, type BrandProfileData } from '../../lib/brandProfile.js';
import { ProfileFilesError, loadBrandProfile, saveBrandProfile } from '../../lib/brandProfileStore.js';
import { legacyContextOf, reviewLegacyNotes } from '../../lib/legacyConflicts.js';
import { BRAND_SCOPE } from '../config.js';
import { ToolUserError, type McpToolDefinition } from './types.js';

const inputSchema = {
  brandSlug: z.string().trim().min(1).max(100).describe('Slug da marca, de list_brands.'),
  changes: z
    .record(z.string(), z.unknown())
    .describe(
      'Campos da ficha a mudar, com a mesma forma que get_brand_profile devolve em `profile` (essence, palette, typography, logo, ' +
        'neverDo, legacyNotes...). Cada chave troca o campo INTEIRO (uma lista nova substitui a lista antiga); o que você não ' +
        'mandar fica como está. Valor null apaga o campo. Com replace=true, `changes` é a ficha toda.',
    ),
  replace: z
    .boolean()
    .default(false)
    .describe('true = `changes` vira a ficha inteira (campos ausentes são apagados). Use para restaurar o `previous` de uma chamada anterior.'),
};

const outputSchema = {
  slug: z.string(),
  profile: z.record(z.string(), z.unknown()),
  /** A ficha de ANTES desta gravação. Guarde-a: mandá-la de volta com replace=true desfaz a mudança. */
  previous: z.record(z.string(), z.unknown()),
  changedKeys: z.array(z.string()),
  completeness: z.object({
    percent: z.number(),
    ready: z.boolean(),
    pending: z.array(z.object({ key: z.string(), label: z.string(), required: z.boolean() })),
  }),
  legacyConflicts: z.array(z.object({ kind: z.string(), rule: z.string(), excerpt: z.string() })),
};

export const updateBrandProfileTool: McpToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: 'update_brand_profile',
  title: 'Atualizar a ficha do Cérebro da marca',
  description:
    'Grava mudanças na ficha do projeto (Cérebro de IA): essência, tom, paleta, tipografia, logos, direção de arte, o que NUNCA fazer, ' +
    'critério de aprovação. CUIDADO: a ficha vale para TODAS as peças futuras da marca. Só mude o que o usuário pediu, leia antes com ' +
    'get_brand_profile e guarde o `previous` devolvido: mandá-lo de volta com replace=true restaura a ficha. Logos, manual visual e ' +
    'arquivos de fonte precisam estar na biblioteca da marca (use upload_asset antes). O fundo exato e a versão transparente dos logos ' +
    'são medidos pelo servidor ao gravar. Exige o escopo designer.brand, que o usuário precisa ter liberado ao conectar.',
  scope: BRAND_SCOPE,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  inputSchema,
  outputSchema,
  brandArg: 'brandSlug',

  async handler(ctx, args) {
    const brand = ctx.brand!;
    const { profile: before } = await loadBrandProfile(brand.id);

    const base: Record<string, unknown> = args.replace ? {} : { ...before };
    for (const [key, value] of Object.entries(args.changes)) {
      if (value === null) delete base[key];
      else base[key] = value;
    }

    const parsed = brandProfileSchema.safeParse(base);
    if (!parsed.success) {
      const first = parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || 'ficha'}: ${i.message}`)
        .join('; ');
      throw new ToolUserError(`Ficha inválida, nada foi gravado. ${first}`, 'invalid_profile');
    }

    let saved: BrandProfileData;
    try {
      saved = await saveBrandProfile(brand.id, parsed.data);
    } catch (err) {
      if (err instanceof ProfileFilesError) throw new ToolUserError(err.message, 'profile_files_not_in_library');
      throw err;
    }

    const changedKeys = [...new Set([...Object.keys(saved), ...Object.keys(before)])].filter(
      (k) => JSON.stringify((saved as Record<string, unknown>)[k]) !== JSON.stringify((before as Record<string, unknown>)[k]),
    );
    const completeness = profileCompleteness(saved);
    const legacyConflicts = reviewLegacyNotes(saved.legacyNotes, legacyContextOf(saved)).conflicts;
    const structured = {
      slug: brand.slug,
      profile: saved as Record<string, unknown>,
      previous: before as Record<string, unknown>,
      changedKeys,
      completeness,
      legacyConflicts,
    };
    const text = [
      changedKeys.length
        ? `Ficha de ${brand.name} (${brand.slug}) atualizada. Campos alterados: ${changedKeys.join(', ')}.`
        : `Ficha de ${brand.name} (${brand.slug}) sem alterações: o conteúdo enviado já era o que estava salvo.`,
      `${completeness.percent}% preenchida, ${completeness.ready ? 'pronta' : 'NÃO pronta'} para criar.`,
      'A ficha anterior está em `previous`: guarde-a; para desfazer, chame de novo com replace=true e changes = previous.',
      legacyConflicts.length ? `Avisos: ${legacyConflicts.length} linha(s) das notas antigas contradizem a ficha ou as regras e são desconsideradas.` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return { text, structured };
  },
};
