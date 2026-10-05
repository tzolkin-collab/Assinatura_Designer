import { formatTokens, prettyModel } from './aiUsageFormat';

/**
 * Formatação do "custo estimado do deck". Tudo aqui é função pura (sem React, sem rede)
 * para ser testada sem montar componente — a tela só liga estes números ao JSX.
 *
 * O backend (GET /api/posts/:id/cost) devolve SEMPRE uma estimativa: tokens gravados no
 * rastro × tabela de preços. Por isso todo texto daqui evita a palavra "custo" solta:
 * é "custo estimado", e o que ficou de fora vira aviso, não silêncio.
 */

export interface CostRole {
  usd: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export interface GenerationCostAvailable {
  available: true;
  estimated: true;
  totalUsd: number;
  /** Algo ficou fora da conta (modelo sem preço ou chamada sem contagem de tokens). */
  partial: boolean;
  runs: number;
  inProgress: boolean;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  byRole: Record<string, CostRole>;
  imageCount: number;
  durationMs: number | null;
  unpricedModels: string[];
  unmeteredSteps: number;
}

export interface GenerationCostUnavailable {
  available: false;
  reason: string;
}

export type GenerationCost = GenerationCostAvailable | GenerationCostUnavailable;

/** US$ 0,31 · "< US$ 0,01" para centavos quebrados (um deck pequeno não pode virar "US$ 0,00"). */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'US$ 0,00';
  if (value < 0.01) return '< US$ 0,01';
  return `US$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Texto do chip. Total parcial vira piso ("≥"): dizer o valor exato seria mentir para menos. */
export function formatChipLabel(cost: GenerationCostAvailable): string {
  return `Custo estimado ${cost.partial ? '≥ ' : ''}${formatUsd(cost.totalUsd)}`;
}

/** 45s → "45 s" · 150s → "2 min 30 s" · 3.600s → "1 h 00 min". null → "—". */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total} s`;
  const min = Math.floor(total / 60);
  const sec = total % 60;
  if (min < 60) return sec === 0 ? `${min} min` : `${min} min ${String(sec).padStart(2, '0')} s`;
  const h = Math.floor(min / 60);
  return `${h} h ${String(min % 60).padStart(2, '0')} min`;
}

/** Ordem em que os papéis aparecem e como se chamam. Os que não estão aqui vão para o fim. */
const ROLE_ORDER = ['fast', 'artist', 'image', 'brain', 'utility'] as const;

const ROLE_LABEL: Record<string, string> = {
  // `fast` é o modelo do planejador E do revisor de texto: o rastro não os distingue.
  fast: 'Planejador e revisor de texto',
  // O revisor visual roda no modelo do artista, então cai neste papel.
  artist: 'Artista e revisor visual',
  image: 'Imagens',
  brain: 'Chat (cérebro)',
  utility: 'Tarefas auxiliares',
};

export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? 'Outros';
}

export interface RoleRow extends CostRole {
  role: string;
  label: string;
}

/** Linhas do detalhamento: só quem teve chamada, em ordem estável (não pela ordem do objeto). */
export function roleRows(byRole: Record<string, CostRole>): RoleRow[] {
  const known = ROLE_ORDER.filter((r) => byRole[r]?.calls);
  const other = Object.keys(byRole)
    .filter((r) => !(ROLE_ORDER as readonly string[]).includes(r) && byRole[r]!.calls > 0)
    .sort();
  return [...known, ...other].map((role) => ({ role, label: roleLabel(role), ...byRole[role]! }));
}

/** "10,2 mil entrada · 3,1 mil saída". */
export function formatRoleTokens(row: Pick<CostRole, 'inputTokens' | 'outputTokens'>): string {
  return `${formatTokens(row.inputTokens)} entrada · ${formatTokens(row.outputTokens)} saída`;
}

/** "6 imagens" / "1 imagem" / "nenhuma imagem". */
export function formatImageCount(n: number): string {
  if (n <= 0) return 'nenhuma imagem';
  return `${n} ${n === 1 ? 'imagem' : 'imagens'}`;
}

/**
 * Avisos que precisam aparecer junto do número. Cada um existe porque omiti-lo faria a
 * estimativa parecer mais confiável do que é.
 */
export function costWarnings(cost: GenerationCostAvailable): string[] {
  const out: string[] = [];

  if (cost.inProgress) {
    out.push('Geração em andamento: o valor ainda vai subir.');
  }
  if (cost.unpricedModels.length > 0) {
    const nomes = cost.unpricedModels.map((m) => (m === 'desconhecido' ? 'modelo não identificado' : prettyModel(m))).join(', ');
    out.push(
      `Sem preço na tabela para: ${nomes}. Esses tokens estão contados, mas não valorados — o total é um mínimo.`,
    );
  }
  if (cost.unmeteredSteps > 0) {
    const n = cost.unmeteredSteps;
    out.push(
      n === 1
        ? '1 chamada respondeu sem informar tokens e ficou fora da conta.'
        : `${n} chamadas responderam sem informar tokens e ficaram fora da conta.`,
    );
  }
  // Sem thinking gravado, o artista (que "pensa" bastante) FICA subestimado — mas só
  // quando o raciocínio de fato rodou. Um deck legítimo com o raciocínio desligado
  // (GEMINI_THINKING_BUDGET=0) também bate thinkingTokens===0, e nesse caso o aviso
  // seria falso alarme. Sem o backend dizer se o raciocínio estava ligado, o texto
  // aqui é deliberadamente condicional ("se usou") em vez de afirmar que o deck
  // está subestimado. Só avisa quando o deck tem chamadas: num deck vazio não há o
  // que subestimar.
  if (cost.thinkingTokens === 0 && cost.calls > 0) {
    out.push(
      'Este deck não tem tokens de raciocínio gravados — pode ser porque o raciocínio estava desligado nessa geração, ou porque é anterior ao rastreamento. Se usou raciocínio, o valor real tende a ser maior.',
    );
  }
  return out;
}

/** Linha de resumo do popover: "6 imagens · 2 min 30 s · 3 execuções". */
export function formatSummaryLine(cost: GenerationCostAvailable): string {
  const parts = [formatImageCount(cost.imageCount)];
  if (cost.durationMs !== null) parts.push(formatDuration(cost.durationMs));
  if (cost.runs > 1) parts.push(`${cost.runs} execuções`);
  return parts.join(' · ');
}
