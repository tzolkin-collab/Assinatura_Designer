import { config, type ModelPrice } from '../config.js';

/**
 * Custo ESTIMADO de uma geração (ou de um deck inteiro), a partir do rastro que a
 * pipeline já grava em GenerationRun/GenerationStep.
 *
 * Função pura: recebe as linhas, devolve números. Nada de banco, Redis ou rede — por
 * isso serve igual à rota, ao script de baseline e aos testes.
 *
 * É ESTIMATIVA, e o payload diz isso (`estimated: true`). Duas razões para não chamar
 * de fatura: (1) a tabela de preço (config.aiModelPrices) envelhece e o Google é quem
 * cobra de verdade; (2) só entra o que foi gravado no step. Quando falta preço ou falta
 * contagem de token, o total é marcado como PARCIAL em vez de fingir um zero: um
 * "US$ 0,00" errado é pior do que um "pelo menos US$ 0,31".
 */

/** O que precisamos de um GenerationRun (subconjunto do model do Prisma). */
export interface CostRunInput {
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
}

/** O que precisamos de um GenerationStep. Sem prompt/resposta: são MBs e não custam nada aqui. */
export interface CostStepInput {
  kind: 'MODEL' | 'TOOL' | 'IMAGE';
  role?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  error?: string | null;
  /** `thinkingTokens` é gravado pelo geminiRetry desde esta versão; steps antigos não têm. */
  metadata?: unknown;
}

export interface RoleCost {
  usd: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export interface ModelCost extends RoleCost {
  /** false = o modelo não está na tabela de preço; `usd` fica 0 mas NÃO significa grátis. */
  priced: boolean;
}

export interface CostEstimate {
  /** Sempre true: nunca é fatura. A UI precisa rotular como estimativa. */
  estimated: true;
  totalUsd: number;
  /** true quando algo ficou fora da conta (modelo sem preço ou step sem contagem). */
  partial: boolean;
  calls: number;
  inputTokens: number;
  /** Já inclui os tokens de raciocínio, que o Gemini cobra como output. */
  outputTokens: number;
  /** Fatia de `outputTokens` que veio do raciocínio (só existe em steps novos). */
  thinkingTokens: number;
  byRole: Record<string, RoleCost>;
  byModel: Record<string, ModelCost>;
  imageCount: number;
  /** null quando o run ainda não terminou (ou não tem os dois carimbos de tempo). */
  durationMs: number | null;
  unpricedModels: string[];
  /** Steps de modelo que responderam sem informar tokens: o custo deles é desconhecido. */
  unmeteredSteps: number;
}

const PER_MILLION = 1_000_000;

/** Casas decimais de saída: 4 é o mesmo grão do computeCost do aiBudget. */
function round(n: number): number {
  return Number(n.toFixed(4));
}

/** Token vindo do banco pode ser null/NaN/negativo; aqui vira um inteiro seguro. */
function tokens(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function thinkingOf(step: CostStepInput): number {
  const meta = step.metadata;
  if (meta && typeof meta === 'object' && 'thinkingTokens' in meta) {
    return tokens((meta as { thinkingTokens?: unknown }).thinkingTokens);
  }
  return 0;
}

function toMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Duração de um run; null se ele não tem começo e fim (ainda rodando, ou run implícito). */
export function runDurationMs(run: CostRunInput): number | null {
  const start = toMs(run.startedAt);
  const end = toMs(run.finishedAt);
  if (start === null || end === null || end < start) return null;
  return end - start;
}

/** Papel que a tela mostra. Imagem não tem `role` no step: o `kind` é que diz. */
function roleOf(step: CostStepInput): string {
  if (step.kind === 'IMAGE') return 'image';
  return step.role || 'unknown';
}

function emptyRole(): RoleCost {
  return { usd: 0, inputTokens: 0, outputTokens: 0, calls: 0 };
}

/** Núcleo compartilhado: run único e deck (vários runs) só diferem em quais steps e qual duração. */
function estimate(
  steps: CostStepInput[],
  durationMs: number | null,
  prices: Record<string, ModelPrice>,
): CostEstimate {
  const byRole: Record<string, RoleCost> = {};
  const byModel: Record<string, ModelCost> = {};
  const unpriced = new Set<string>();
  let totalUsd = 0;
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let thinkingTokens = 0;
  let imageCount = 0;
  let unmeteredSteps = 0;

  for (const step of steps) {
    // Ferramenta não chama modelo: não tem custo nem token.
    if (step.kind === 'TOOL') continue;

    // A imagem existe mesmo que o provedor não tenha devolvido a contagem de tokens;
    // o step de falha final (sem modelo, com erro) é que não conta.
    if (step.kind === 'IMAGE' && step.model && !step.error) imageCount += 1;

    const input = tokens(step.inputTokens);
    const thinking = thinkingOf(step);
    // Thinking é cobrado como output pelo Gemini (mesma regra do computeCost).
    const output = tokens(step.outputTokens) + thinking;

    if (input + output === 0) {
      // Falha registrada (com `error`) não foi cobrada. Já um step que respondeu sem
      // contagem de token custou algo que não sabemos: tem que aparecer como parcial.
      if (!step.error && step.model) unmeteredSteps += 1;
      continue;
    }

    const model = step.model || 'desconhecido';
    const price = step.model ? prices[step.model] : undefined;
    const usd = price ? (input / PER_MILLION) * price.input + (output / PER_MILLION) * price.output : 0;
    if (!price) unpriced.add(model);

    const role = (byRole[roleOf(step)] ??= emptyRole());
    role.usd += usd;
    role.inputTokens += input;
    role.outputTokens += output;
    role.calls += 1;

    const m = (byModel[model] ??= { ...emptyRole(), priced: Boolean(price) });
    m.usd += usd;
    m.inputTokens += input;
    m.outputTokens += output;
    m.calls += 1;

    totalUsd += usd;
    calls += 1;
    inputTokens += input;
    outputTokens += output;
    thinkingTokens += thinking;
  }

  // Arredonda só no fim: somar valores já arredondados acumularia erro em deck grande.
  for (const r of Object.values(byRole)) r.usd = round(r.usd);
  for (const m of Object.values(byModel)) m.usd = round(m.usd);

  const unpricedModels = [...unpriced].sort();
  return {
    estimated: true,
    totalUsd: round(totalUsd),
    partial: unpricedModels.length > 0 || unmeteredSteps > 0,
    calls,
    inputTokens,
    outputTokens,
    thinkingTokens,
    byRole,
    byModel,
    imageCount,
    durationMs,
    unpricedModels,
    unmeteredSteps,
  };
}

/** Janela dentro da qual um run 'pipeline' RUNNING ainda conta como "em andamento" —
 *  ver isPostInProgress logo abaixo. 30min é folgado o bastante pro maior deck real
 *  (dezenas de slides, lotes em paralelo) e curto o bastante pra não travar pra
 *  sempre um pipeline que morreu no meio (processo caiu, pod reiniciado) sem passar
 *  pelo closeRun do runPipeline. */
export const IN_PROGRESS_WINDOW_MS = 30 * 60 * 1000;

/** O que precisamos de um GenerationRun pra decidir se o deck está "em andamento". */
export interface InProgressRunInput {
  status: string;
  /** Só existe a partir desta versão do schema; runs antigos podem vir undefined/null. */
  feature?: string | null;
  startedAt?: Date | string | null;
}

/**
 * Se o DECK tem alguma geração de verdade em andamento agora (pro popover "o valor
 * ainda vai subir").
 *
 * Antes bastava UM run RUNNING, de QUALQUER feature, pra acender "em andamento". Só
 * que quem fecha um run (closeRun) é só o runPipeline — toda chamada de IA FORA do
 * pipeline (edit-slide, chat com postId, ai-patch) abre um run IMPLÍCITO via
 * ensureRun()/openRun() que ninguém fecha. Resultado: qualquer deck que já recebeu
 * UMA edição por IA mostrava "em andamento" para sempre, falsamente — mesmo meses
 * depois, com o run implícito eternamente RUNNING.
 *
 * Dois filtros resolvem os dois lados do bug: (1) só `feature === 'pipeline'` — é o
 * único fluxo que de fato fecha o run no final; (2) só se `startedAt` está dentro da
 * janela — cobre o caso de um pipeline de verdade que morreu no meio sem chamar
 * closeRun (aí o run também fica RUNNING para sempre, mas não é mais "em andamento":
 * o valor já parou de subir).
 */
export function isPostInProgress(runs: InProgressRunInput[], now: number = Date.now()): boolean {
  return runs.some((r) => {
    if (r.status !== 'RUNNING' || r.feature !== 'pipeline') return false;
    const startedMs = toMs(r.startedAt);
    if (startedMs === null) return false;
    return now - startedMs < IN_PROGRESS_WINDOW_MS;
  });
}

/** Custo estimado de UM run. */
export function estimateRunCost(
  run: CostRunInput,
  steps: CostStepInput[],
  prices: Record<string, ModelPrice> = config.aiModelPrices,
): CostEstimate {
  return estimate(steps, runDurationMs(run), prices);
}

/**
 * Custo estimado do DECK: um post acumula vários runs (a geração inicial, cada edição
 * de slide, cada rodada de chat). A duração é a soma dos runs que têm começo e fim;
 * se nenhum tem, fica null em vez de 0.
 */
export function estimatePostCost(
  runs: Array<{ run: CostRunInput; steps: CostStepInput[] }>,
  prices: Record<string, ModelPrice> = config.aiModelPrices,
): CostEstimate {
  const durations = runs.map((r) => runDurationMs(r.run)).filter((d): d is number => d !== null);
  const durationMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) : null;
  return estimate(
    runs.flatMap((r) => r.steps),
    durationMs,
    prices,
  );
}
