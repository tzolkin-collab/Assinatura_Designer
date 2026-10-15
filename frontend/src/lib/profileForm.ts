// Conversão entre a ficha do projeto (como a API guarda) e o estado do formulário da tela
// "Cérebro da IA". O formulário trabalha com texto puro (uma linha por item, itens separados por
// vírgula); a ficha trabalha com listas e objetos. É aqui que isso se traduz, em função pura, para
// ser testável sem montar a página.
//
// Regra de ouro: campo vazio não vira valor. A ficha só leva o que a pessoa preencheu; o resto
// continua pendente, e o sistema não inventa.

export type FontSource = 'google' | 'custom' | 'reference';

export interface BrandProfile {
  essence?: string;
  writingDirection?: string;
  palette?: Array<{ hex: string; name?: string; role?: string }>;
  typography?: Array<{ family: string; role?: string; source?: FontSource; fileUrl?: string; referenceImageUrl?: string }>;
  logo?: { files?: Array<{ url: string; label?: string }>; rules?: string };
  visualManual?: { imageUrl?: string; notes?: string };
  artDirection?: string;
  realPhoto?: string;
  graphicElements?: string;
  neverDo?: string[];
  approvalCriterion?: string;
  brandCodes?: Array<{ category: string; items: string[] }>;
  mayVary?: string[];
  mustKeep?: string[];
  collabRules?: string;
  legacyNotes?: string;
}

export interface PaletteRow { hex: string; name: string; role: string }
export interface TypographyRow { family: string; role: string; source: FontSource | ''; fileUrl: string; referenceImageUrl: string }
export interface LogoRow { url: string; label: string }
export interface CodeRow { category: string; items: string }

export interface ProfileFormState {
  essence: string;
  writingDirection: string;
  palette: PaletteRow[];
  typography: TypographyRow[];
  logoFiles: LogoRow[];
  logoRules: string;
  manualImageUrl: string;
  manualNotes: string;
  artDirection: string;
  realPhoto: string;
  graphicElements: string;
  /** Uma proibição por linha. */
  neverDo: string;
  approvalCriterion: string;
  brandCodes: CodeRow[];
  /** Um item por linha. */
  mayVary: string;
  mustKeep: string;
  collabRules: string;
  legacyNotes: string;
}

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Uma linha, um item: apara os espaços e descarta as vazias. */
export function splitLines(s: string): string[] {
  return s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** Itens separados por vírgula ou quebra de linha. */
export function splitItems(s: string): string[] {
  return s.split(/[,\n]/).map((i) => i.trim()).filter(Boolean);
}

export function emptyForm(): ProfileFormState {
  return {
    essence: '', writingDirection: '', palette: [], typography: [], logoFiles: [], logoRules: '',
    manualImageUrl: '', manualNotes: '', artDirection: '', realPhoto: '', graphicElements: '',
    neverDo: '', approvalCriterion: '', brandCodes: [], mayVary: '', mustKeep: '', collabRules: '', legacyNotes: '',
  };
}

export function profileToForm(p: BrandProfile): ProfileFormState {
  return {
    essence: p.essence ?? '',
    writingDirection: p.writingDirection ?? '',
    palette: (p.palette ?? []).map((c) => ({ hex: c.hex, name: c.name ?? '', role: c.role ?? '' })),
    typography: (p.typography ?? []).map((t) => ({
      family: t.family, role: t.role ?? '', source: t.source ?? '', fileUrl: t.fileUrl ?? '', referenceImageUrl: t.referenceImageUrl ?? '',
    })),
    logoFiles: (p.logo?.files ?? []).map((f) => ({ url: f.url, label: f.label ?? '' })),
    logoRules: p.logo?.rules ?? '',
    manualImageUrl: p.visualManual?.imageUrl ?? '',
    manualNotes: p.visualManual?.notes ?? '',
    artDirection: p.artDirection ?? '',
    realPhoto: p.realPhoto ?? '',
    graphicElements: p.graphicElements ?? '',
    neverDo: (p.neverDo ?? []).join('\n'),
    approvalCriterion: p.approvalCriterion ?? '',
    brandCodes: (p.brandCodes ?? []).map((c) => ({ category: c.category, items: c.items.join(', ') })),
    mayVary: (p.mayVary ?? []).join('\n'),
    mustKeep: (p.mustKeep ?? []).join('\n'),
    collabRules: p.collabRules ?? '',
    legacyNotes: p.legacyNotes ?? '',
  };
}

const text = (s: string): string | undefined => (s.trim() ? s.trim() : undefined);

/** O que vai para a API: só o que foi preenchido. */
export function formToProfile(f: ProfileFormState): BrandProfile {
  const out: BrandProfile = {};

  const essence = text(f.essence); if (essence) out.essence = essence;
  const writing = text(f.writingDirection); if (writing) out.writingDirection = writing;

  const palette = f.palette
    .filter((c) => c.hex.trim())
    .map((c) => ({ hex: c.hex.trim(), ...(text(c.name) ? { name: text(c.name) } : {}), ...(text(c.role) ? { role: text(c.role) } : {}) }));
  if (palette.length) out.palette = palette;

  const typography = f.typography
    .filter((t) => t.family.trim())
    .map((t) => ({
      family: t.family.trim(),
      ...(text(t.role) ? { role: text(t.role) } : {}),
      ...(t.source ? { source: t.source } : {}),
      // O arquivo só vale para o tipo de fonte a que pertence: trocar o tipo não deixa lixo para trás.
      ...(t.source === 'custom' && text(t.fileUrl) ? { fileUrl: text(t.fileUrl) } : {}),
      ...(t.source === 'reference' && text(t.referenceImageUrl) ? { referenceImageUrl: text(t.referenceImageUrl) } : {}),
    }));
  if (typography.length) out.typography = typography;

  const files = f.logoFiles.filter((l) => l.url.trim()).map((l) => ({ url: l.url.trim(), ...(text(l.label) ? { label: text(l.label) } : {}) }));
  const logoRules = text(f.logoRules);
  if (files.length || logoRules) out.logo = { ...(files.length ? { files } : {}), ...(logoRules ? { rules: logoRules } : {}) };

  const manualImage = text(f.manualImageUrl);
  const manualNotes = text(f.manualNotes);
  if (manualImage || manualNotes) out.visualManual = { ...(manualImage ? { imageUrl: manualImage } : {}), ...(manualNotes ? { notes: manualNotes } : {}) };

  const art = text(f.artDirection); if (art) out.artDirection = art;
  const photo = text(f.realPhoto); if (photo) out.realPhoto = photo;
  const graphic = text(f.graphicElements); if (graphic) out.graphicElements = graphic;

  const never = splitLines(f.neverDo); if (never.length) out.neverDo = never;
  const approval = text(f.approvalCriterion); if (approval) out.approvalCriterion = approval;

  const codes = f.brandCodes.filter((c) => c.category.trim()).map((c) => ({ category: c.category.trim(), items: splitItems(c.items) }));
  if (codes.length) out.brandCodes = codes;

  const vary = splitLines(f.mayVary); if (vary.length) out.mayVary = vary;
  const keep = splitLines(f.mustKeep); if (keep.length) out.mustKeep = keep;
  const collab = text(f.collabRules); if (collab) out.collabRules = collab;
  const legacy = text(f.legacyNotes); if (legacy) out.legacyNotes = legacy;

  return out;
}

/** Erros que dá para apontar antes de enviar, com o texto que a pessoa lê. */
export function formErrors(f: ProfileFormState): string[] {
  const errors: string[] = [];
  const badHex = f.palette.filter((c) => c.hex.trim() && !HEX_RE.test(c.hex.trim()));
  if (badHex.length) errors.push(`Cor inválida na paleta (${badHex.map((c) => c.hex.trim()).join(', ')}): use o formato #RRGGBB.`);
  const noFamily = f.typography.filter((t) => !t.family.trim() && (t.role.trim() || t.source));
  if (noFamily.length) errors.push('Tem fonte sem nome da família.');
  const noCategory = f.brandCodes.filter((c) => !c.category.trim() && c.items.trim());
  if (noCategory.length) errors.push('Tem código sem categoria (ex.: Tom, Personalidade).');
  return errors;
}
