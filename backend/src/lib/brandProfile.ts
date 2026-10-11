import { z } from 'zod';
import { httpsUrl } from './brandCollab.js';

// Ficha do projeto (Cérebro de IA, §10 "Modelo para cadastrar qualquer projeto").
//
// É a memória estruturada de UM projeto-base: o que ele pensa, como escreve, como aparece e o que
// nunca faz. Substitui, para o cérebro, o texto solto de `guidelines` + `agentPrompt` +
// `presentationConfig`. Tudo o que muda de um projeto para outro vive aqui, como dado; as regras
// globais (fidelidade, foto real, revisão) ficam no código e nunca mudam por projeto.
//
// Todos os campos são opcionais no esquema: a ficha se preenche aos poucos, e o que falta aparece
// como pendência (§13), nunca como valor inventado.

const text = (max: number) => z.string().trim().max(max);

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use o formato #RRGGBB.')
  .transform((v) => v.toUpperCase());

export const paletteColorSchema = z.object({
  hex: hexColor,
  name: text(80).optional(),
  /** Função da cor: principal, destaque, fundo claro... (Cérebro de IA, §11.4). */
  role: text(200).optional(),
});

export const typographySchema = z.object({
  family: text(80).min(1),
  /** Para que serve: títulos e capas, textos e dados... */
  role: text(200).optional(),
  /**
   * `google`: o sistema carrega. `custom`: arquivo enviado. `reference`: só imagem de referência,
   * a fonte oficial ainda não está instalada (o sistema avisa e usa uma substituta).
   */
  source: z.enum(['google', 'custom', 'reference']).optional(),
  fileUrl: httpsUrl.optional(),
  referenceImageUrl: httpsUrl.optional(),
});

export const logoFileSchema = z.object({
  url: httpsUrl,
  /** Ex.: "wordmark sobre fundo escuro", "monograma". */
  label: text(120).optional(),
});

export const brandProfileSchema = z.object({
  /** 1. Quem é a marca, o que pensa, fala e defende; sensação que deve transmitir. */
  essence: text(4000).optional(),
  /** 2. Vocabulário, formalidade, ritmo, o que evitar. */
  writingDirection: text(3000).optional(),
  /** 3. Paleta oficial, com a função de cada cor. */
  palette: z.array(paletteColorSchema).max(24).optional(),
  /** 4. Fontes oficiais e a função de cada uma. */
  typography: z.array(typographySchema).max(12).optional(),
  /** 5. Logo e assinaturas: arquivos e regras de uso. */
  logo: z
    .object({
      files: z.array(logoFileSchema).max(40).optional(),
      rules: text(2000).optional(),
    })
    .optional(),
  /** Manual visual condensado em UMA imagem (a referência visual principal). */
  visualManual: z.object({ imageUrl: httpsUrl.optional(), notes: text(2000).optional() }).optional(),
  /** 6. Composição, grid, respiro, escala, intensidade, referências. */
  artDirection: text(4000).optional(),
  /** 7. Tipo de foto aprovada, tratamento permitido, recortes. A biblioteca de fotos é a de ativos. */
  realPhoto: text(3000).optional(),
  /** 8. Linhas, formas, ícones, monograma, texturas. */
  graphicElements: text(2000).optional(),
  /** 9. Proibições específicas do projeto. */
  neverDo: z.array(text(300).min(1)).max(60).optional(),
  /** 11. Como saber se a peça pertence à marca. */
  approvalCriterion: text(1500).optional(),
  /** Texto de antes da ficha (diretrizes e instruções do agente), mantido até alguém reorganizar. */
  legacyNotes: text(8000).optional(),
});

export type BrandProfileData = z.infer<typeof brandProfileSchema>;

// ── Completude (§13: o que falta saber) ─────────────────────────────────────────

export interface ProfileSection {
  key: string;
  label: string;
  /** Obrigatório para o projeto contar como "pronto" (§4: campos marcados "Sim"). */
  required: boolean;
  filled: (p: BrandProfileData) => boolean;
}

const hasText = (v: string | undefined): boolean => Boolean(v && v.trim());

export const PROFILE_SECTIONS: ProfileSection[] = [
  { key: 'essence', label: 'Essência e posicionamento', required: true, filled: (p) => hasText(p.essence) },
  { key: 'writingDirection', label: 'Tom e direção de escrita', required: false, filled: (p) => hasText(p.writingDirection) },
  { key: 'palette', label: 'Paleta', required: true, filled: (p) => (p.palette?.length ?? 0) > 0 },
  { key: 'typography', label: 'Tipografia', required: true, filled: (p) => (p.typography?.length ?? 0) > 0 },
  { key: 'logo', label: 'Logo e assinatura', required: false, filled: (p) => (p.logo?.files?.length ?? 0) > 0 },
  { key: 'visualManual', label: 'Manual visual', required: true, filled: (p) => Boolean(p.visualManual?.imageUrl) },
  { key: 'artDirection', label: 'Direção de arte', required: true, filled: (p) => hasText(p.artDirection) },
  { key: 'realPhoto', label: 'Fotografia real', required: false, filled: (p) => hasText(p.realPhoto) },
  { key: 'graphicElements', label: 'Elementos gráficos', required: false, filled: (p) => hasText(p.graphicElements) },
  { key: 'neverDo', label: 'O que nunca fazer', required: true, filled: (p) => (p.neverDo?.length ?? 0) > 0 },
  { key: 'approvalCriterion', label: 'Critério de aprovação', required: true, filled: (p) => hasText(p.approvalCriterion) },
];

export interface ProfileCompleteness {
  /** 0 a 100: seções preenchidas sobre o total. */
  percent: number;
  /** Todas as seções obrigatórias preenchidas: o projeto está pronto para criar. */
  ready: boolean;
  pending: Array<{ key: string; label: string; required: boolean }>;
}

export function profileCompleteness(profile: BrandProfileData): ProfileCompleteness {
  const pending = PROFILE_SECTIONS.filter((s) => !s.filled(profile)).map(({ key, label, required }) => ({ key, label, required }));
  const filledCount = PROFILE_SECTIONS.length - pending.length;
  return {
    percent: Math.round((filledCount / PROFILE_SECTIONS.length) * 100),
    ready: !pending.some((s) => s.required),
    pending,
  };
}

// ── Ficha a partir do que o sistema já tem (migração sem perda) ─────────────────

export interface LegacyBrandFields {
  colors?: string[] | null;
  primaryFonts?: string[] | null;
  logoUrl?: string | null;
  guidelines?: string | null;
  agentPrompt?: string | null;
}

const isHex = (v: string): boolean => /^#[0-9a-fA-F]{6}$/.test(v.trim());
const isHttps = (v: string): boolean => {
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Monta uma ficha a partir de `BrandConfig`. Não inventa função de cor nem fonte: o que o sistema
 * não sabia continua faltando e aparece como pendência. Diretrizes e instruções do agente vão para
 * `legacyNotes` sem serem reinterpretadas.
 */
export function profileFromLegacy(config: LegacyBrandFields | null | undefined): BrandProfileData {
  const c = config ?? {};
  const palette = (c.colors ?? []).filter(isHex).map((hex) => ({ hex: hex.trim().toUpperCase() }));
  const typography = (c.primaryFonts ?? []).map((f) => f.trim()).filter(Boolean).map((family) => ({ family }));
  const logoFiles = c.logoUrl && isHttps(c.logoUrl) ? [{ url: c.logoUrl, label: 'Logo' }] : [];
  const notes = [
    c.guidelines?.trim() ? `Diretrizes (antes da ficha):\n${c.guidelines.trim()}` : '',
    c.agentPrompt?.trim() ? `Instruções do agente (antes da ficha):\n${c.agentPrompt.trim()}` : '',
  ].filter(Boolean).join('\n\n');

  return {
    ...(palette.length ? { palette } : {}),
    ...(typography.length ? { typography } : {}),
    ...(logoFiles.length ? { logo: { files: logoFiles } } : {}),
    ...(notes ? { legacyNotes: notes.slice(0, 8000) } : {}),
  };
}

// ── Ficha como texto: o formato do §10.1, o que o cérebro lê ────────────────────

const block = (n: number, title: string, body: string | undefined): string =>
  body && body.trim() ? `${n}. ${title}\n${body.trim()}` : '';

/**
 * Renderiza a ficha no formato do documento (§10.1), pulando o que está vazio. É a "memória do
 * projeto-base" que `assembleDesignerBrain` recebe. Seção vazia some: o cérebro não recebe
 * "a definir" para tratar como regra.
 */
export function renderProjectMemory(name: string, profile: BrandProfileData): string {
  const palette = profile.palette?.map((c) => `${c.hex}${c.name ? ` ${c.name}` : ''}${c.role ? ` — ${c.role}` : ''}`).join('\n');
  const typography = profile.typography
    ?.map((t) => {
      const origem =
        t.source === 'reference'
          ? ' (referência visual; a fonte oficial não está instalada)'
          : t.source === 'custom'
            ? ' (arquivo oficial enviado)'
            : '';
      return `${t.family}${t.role ? ` — ${t.role}` : ''}${origem}`;
    })
    .join('\n');
  const logo = [
    profile.logo?.files?.length ? profile.logo.files.map((f) => `- ${f.label ?? 'Logo'}`).join('\n') : '',
    profile.logo?.rules?.trim() ?? '',
  ].filter(Boolean).join('\n');
  const neverDo = profile.neverDo?.map((n) => `- ${n}`).join('\n');
  const assets = [
    profile.visualManual?.imageUrl ? '- Manual visual em imagem' : '',
    profile.logo?.files?.length ? `- Logo (${profile.logo.files.length} arquivo${profile.logo.files.length > 1 ? 's' : ''})` : '',
    profile.typography?.some((t) => t.source === 'custom') ? '- Fontes oficiais enviadas' : '',
  ].filter(Boolean).join('\n');

  return [
    `PROJETO: ${name}`,
    block(1, 'ESSÊNCIA E POSICIONAMENTO', profile.essence),
    block(2, 'TOM E DIREÇÃO DE ESCRITA', profile.writingDirection),
    block(3, 'PALETA', palette),
    block(4, 'TIPOGRAFIA', typography),
    block(5, 'LOGO E ASSINATURA', logo),
    block(6, 'DIREÇÃO DE ARTE', [profile.visualManual?.notes, profile.artDirection].filter((v) => v?.trim()).join('\n')),
    block(7, 'FOTOGRAFIA REAL', profile.realPhoto),
    block(8, 'ELEMENTOS GRÁFICOS', profile.graphicElements),
    block(9, 'O QUE NUNCA FAZER', neverDo),
    block(10, 'ATIVOS DISPONÍVEIS', assets),
    block(11, 'CRITÉRIO DE APROVAÇÃO', profile.approvalCriterion),
    profile.legacyNotes?.trim() ? `OBSERVAÇÕES ANTERIORES À FICHA\n${profile.legacyNotes.trim()}` : '',
  ].filter(Boolean).join('\n\n');
}
