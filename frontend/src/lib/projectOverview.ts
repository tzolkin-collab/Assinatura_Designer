// Lógica da Visão geral do projeto (mockup da Gabriela, Cérebro de IA §1.1.2).
//
// Tudo o que a tela mostra como número ou status sai daqui, em funções puras, para ser testável
// sem montar a página. A tela só desenha o resultado. Nada é inventado: o que o sistema não
// sabe (por exemplo, quantos materiais um desdobramento tem) não aparece.

export interface ProfileCompleteness {
  /** 0 a 100: seções da ficha preenchidas sobre o total. */
  percent: number;
  /** Todas as seções obrigatórias preenchidas. */
  ready: boolean;
  pending: Array<{ key: string; label: string; required: boolean }>;
}

/** Só o que a visão geral lê da ficha (o formato completo vive no backend). */
export interface ProfileSummary {
  palette?: unknown[];
  typography?: unknown[];
  logo?: { files?: unknown[] };
  visualManual?: { imageUrl?: string };
}

export interface ProjectProfileResponse {
  profile: ProfileSummary;
  derived: boolean;
  completeness: ProfileCompleteness;
  /** Linhas das notas antigas que contradizem a ficha ou as regras; a IA já as desconsidera. */
  legacyConflicts?: Array<{ kind: string; rule: string; excerpt: string }>;
}

export type BrandKind = 'BASE' | 'INTERNAL' | 'PARTNERSHIP';

export interface ProjectBrand {
  id: string;
  slug: string;
  name: string;
  kind?: BrandKind;
  parentBrandId?: string | null;
  collab?: { context?: string; baseProtagonism?: number; partner?: { name?: string } } | null;
  updatedAt?: string;
}

export interface LibraryAsset {
  fileType: string;
  source?: string | null;
}

export interface ProjectStatus {
  label: string;
  /** `ready` = projeto-base pronto; `pending` = ainda em configuração. */
  tone: 'ready' | 'pending';
  detail: string;
}

/** "Projeto-base pronto · 92% configurado" do mockup, só que verdadeiro. */
export function projectStatus(c: ProfileCompleteness, kind: BrandKind = 'BASE'): ProjectStatus {
  const noun = kind === 'BASE' ? 'Projeto-base' : 'Desdobramento';
  const requiredLeft = c.pending.filter((p) => p.required).length;
  if (c.ready) {
    return { label: `${noun} pronto`, tone: 'ready', detail: `${c.percent}% configurado` };
  }
  return {
    label: 'Em configuração',
    tone: 'pending',
    detail: `${c.percent}% configurado · ${requiredLeft} ${requiredLeft === 1 ? 'obrigatória pendente' : 'obrigatórias pendentes'}`,
  };
}

/**
 * Estado de um desdobramento. Ele não tem ficha própria: herda a da base, então só está pronto
 * quando a base está. Mostrar "0% configurado" para ele seria enganoso.
 */
export function collabStatus(parentName: string | undefined, parent: ProfileCompleteness | null | undefined): ProjectStatus {
  if (!parentName || !parent) {
    return { label: 'Desdobramento', tone: 'pending', detail: 'não consegui ler o projeto-base' };
  }
  if (parent.ready) {
    return { label: 'Desdobramento pronto', tone: 'ready', detail: `herda de ${parentName} · ficha ${parent.percent}%` };
  }
  return { label: 'Aguardando o projeto-base', tone: 'pending', detail: `a ficha de ${parentName} está em ${parent.percent}%` };
}

/** Os quatro selos do card "Identidade visual". */
export function identityChecklist(profile: ProfileSummary): Array<{ label: string; ok: boolean }> {
  return [
    { label: 'Manual', ok: Boolean(profile.visualManual?.imageUrl) },
    { label: 'Cores', ok: (profile.palette?.length ?? 0) > 0 },
    { label: 'Fontes', ok: (profile.typography?.length ?? 0) > 0 },
    { label: 'Logos', ok: (profile.logo?.files?.length ?? 0) > 0 },
  ];
}

export interface LibraryTotals {
  /** Imagens que alguém forneceu (tudo que não foi gerado pelo sistema). */
  images: number;
  /** Imagens que o sistema gerou: não são "foto real" e ficam separadas. */
  generated: number;
  /** Arquivos que não são imagem (PDF, SVG de elemento etc.). */
  otherFiles: number;
}

export function libraryTotals(assets: LibraryAsset[]): LibraryTotals {
  const totals: LibraryTotals = { images: 0, generated: 0, otherFiles: 0 };
  for (const a of assets) {
    const isImage = a.fileType.startsWith('image/');
    if (!isImage) totals.otherFiles += 1;
    else if (a.source === 'ai-generated') totals.generated += 1;
    else totals.images += 1;
  }
  return totals;
}

/** Desdobramentos de uma base, do mais recente para o mais antigo. */
export function collabsOf(brands: ProjectBrand[], parentId: string): ProjectBrand[] {
  return brands
    .filter((b) => b.parentBrandId === parentId)
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}

export function collabKindLabel(kind: BrandKind | undefined): string {
  if (kind === 'PARTNERSHIP') return 'Parceria';
  if (kind === 'INTERNAL') return 'Desdobramento interno';
  return 'Projeto-base';
}

/**
 * Lista vinda da API em qualquer dos dois formatos que o app já usa: `[...]` (o `api.get` desembrulha
 * o `data`) ou `{ data: [...] }` (a página de mídia trata assim). Qualquer outra coisa vira lista vazia.
 */
export function asList<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const inner = (res as { data?: unknown } | null | undefined)?.data;
  return Array.isArray(inner) ? (inner as T[]) : [];
}

/** "há 3 dias", "há 2 semanas": o formato do mockup. `now` entra por parâmetro para o teste. */
export function timeAgo(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'agora';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 14) return `há ${d} ${d === 1 ? 'dia' : 'dias'}`;
  const w = Math.floor(d / 7);
  if (d < 60) return `há ${w} semanas`;
  const mo = Math.floor(d / 30);
  return `há ${mo} ${mo === 1 ? 'mês' : 'meses'}`;
}
