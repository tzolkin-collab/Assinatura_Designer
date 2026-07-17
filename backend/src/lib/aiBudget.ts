import { redis } from './redis.js';
import { config } from '../config.js';
import { getAiContext } from './aiContext.js';
import { createError } from '../middleware/errorHandler.js';
import { logger } from './logger.js';

/**
 * Teto de gasto de IA + contabilidade por modelo.
 *
 * Não havia nenhum teto: um deck de 200 slides dispara `pipelineConcurrency ×
 * generationConcurrency` chamadas simultâneas ao Gemini, e um brief mal formado
 * (ou um loop de retry) queimava caixa sem ninguém ver. Aqui o consumo é medido e,
 * passado o teto do dia, a próxima chamada é recusada em vez de cobrada.
 *
 * A conta CRUA é em TOKENS, não em reais: token vem exato do provedor (`usageMetadata`),
 * enquanto tabela de preço envelhece calada e passaria a mentir sem avisar. O valor em
 * dinheiro é uma camada por cima — estimativa, com preço por modelo (config.aiModelPrices),
 * câmbio e imposto separados — para a tela de billing e o widget de transparência.
 *
 * Dois níveis de granularidade convivem:
 *  - DIÁRIO (3 dias): janela de depuração e o "gasto de hoje" do widget.
 *  - MENSAL (~400 dias): o histórico que a aba de billing precisa — o diário some rápido
 *    demais para ser fatura.
 * Cada nível é registrado global e por marca, quebrado por modelo.
 */

const DAILY_RETENTION_SECONDS = 3 * 24 * 60 * 60; // 3 dias: o suficiente para depurar ontem
const MONTHLY_RETENTION_SECONDS = 400 * 24 * 60 * 60; // ~13 meses: histórico de billing

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function thisMonth(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

// ── Keys ────────────────────────────────────────────────────────────────────────
// Os contadores de TOTAL (global/brand por dia) são os que o teto lê — mantidos como
// estavam para não mexer no caminho quente do assertWithinBudget.
function globalKey(dia = today()): string {
  return `ai:usage:${dia}:global`;
}
function brandKey(brandSlug: string, dia = today()): string {
  return `ai:usage:${dia}:brand:${brandSlug}`;
}

// Hashes por modelo (campos: calls, prompt, output, thinking, total) + índices (SET).
function dayModelKey(dia: string, model: string): string {
  return `ai:usage:day:${dia}:model:${model}`;
}
function dayModelsIndex(dia: string): string {
  return `ai:usage:day:${dia}:models`;
}
function dayBrandModelKey(slug: string, dia: string, model: string): string {
  return `ai:usage:day:${dia}:brand:${slug}:model:${model}`;
}
function dayBrandModelsIndex(slug: string, dia: string): string {
  return `ai:usage:day:${dia}:brand:${slug}:models`;
}
function monthModelKey(mes: string, model: string): string {
  return `ai:usage:month:${mes}:model:${model}`;
}
function monthModelsIndex(mes: string): string {
  return `ai:usage:month:${mes}:models`;
}
function monthsIndex(): string {
  return `ai:usage:months`;
}
function monthBrandModelKey(slug: string, mes: string, model: string): string {
  return `ai:usage:month:${mes}:brand:${slug}:model:${model}`;
}
function monthBrandModelsIndex(slug: string, mes: string): string {
  return `ai:usage:month:${mes}:brand:${slug}:models`;
}
function brandMonthsIndex(slug: string): string {
  return `ai:usage:brand:${slug}:months`;
}

async function readCounter(key: string): Promise<number> {
  const raw = await redis.get(key);
  return raw ? Number(raw) || 0 : 0;
}

// ── Custo (estimativa) ────────────────────────────────────────────────────────────
export type Currency = 'USD' | 'BRL';

export interface Cost {
  currency: Currency;
  /** Gasto base estimado (preço do modelo × tokens, convertido pelo câmbio). */
  base: number;
  /** Imposto sobre o gasto, mostrado SEPARADO — nunca embutido no preço. */
  tax: number;
  /** base + tax. */
  total: number;
}

function round(n: number): number {
  return Number(n.toFixed(4));
}

/**
 * Estima o custo de um consumo. Thinking é cobrado como output pelo Gemini, então
 * entra no lado de output. Modelo fora da tabela cai no preço de reserva
 * (aiUsdPerMillionTokens); se este for 0, o custo estimado é 0 (não chutamos preço).
 */
export function computeCost(prompt: number, output: number, thinking: number, model: string): Cost {
  const price = config.aiModelPrices[model] ?? {
    input: config.aiUsdPerMillionTokens,
    output: config.aiUsdPerMillionTokens,
  };
  const billedOutput = output + thinking;
  const usd = (prompt / 1_000_000) * price.input + (billedOutput / 1_000_000) * price.output;

  const currency: Currency = config.aiUsdToBrl > 0 ? 'BRL' : 'USD';
  const fx = config.aiUsdToBrl > 0 ? config.aiUsdToBrl : 1;
  const base = round(usd * fx);
  const tax = round(base * config.aiTaxRate);
  return { currency, base, tax, total: round(base + tax) };
}

function emptyCost(): Cost {
  return { currency: config.aiUsdToBrl > 0 ? 'BRL' : 'USD', base: 0, tax: 0, total: 0 };
}

function sumCosts(rows: ModelUsageRow[]): Cost {
  const total = rows.reduce(
    (acc, r) => {
      acc.base += r.cost.base;
      acc.tax += r.cost.tax;
      acc.total += r.cost.total;
      return acc;
    },
    emptyCost(),
  );
  return { currency: total.currency, base: round(total.base), tax: round(total.tax), total: round(total.total) };
}

// ── Snapshots ────────────────────────────────────────────────────────────────────
export interface ModelUsageRow {
  model: string;
  calls: number;
  promptTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  cost: Cost;
}

export interface UsageSnapshot {
  day: string;
  globalTokens: number;
  globalBudget: number;
  brandSlug?: string;
  brandTokens?: number;
  brandBudget: number;
  /** Quebra do consumo de HOJE por modelo (por marca quando há marca; senão, global). */
  models: ModelUsageRow[];
  /** Custo estimado de hoje (soma das linhas de `models`). */
  cost: Cost;
  currency: Currency;
  taxRate: number;
}

export interface BillingReport {
  brandSlug?: string;
  month: string;
  /** Meses com algum registro, mais novos primeiro — para o seletor da tela. */
  availableMonths: string[];
  models: ModelUsageRow[];
  totals: {
    calls: number;
    promptTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    totalTokens: number;
    cost: Cost;
  };
  currency: Currency;
  taxRate: number;
  /** Preço vigente por modelo, para a tela mostrar de onde saiu a conta. */
  prices: Record<string, { input: number; output: number }>;
}

/** Lê um hash de modelo e monta a linha (com custo). Hash ausente → zeros. */
function rowFromHash(model: string, hash: Record<string, string> | null): ModelUsageRow {
  const h = hash ?? {};
  const promptTokens = Number(h.prompt ?? 0) || 0;
  const outputTokens = Number(h.output ?? 0) || 0;
  const thinkingTokens = Number(h.thinking ?? 0) || 0;
  const totalTokens = Number(h.total ?? 0) || 0;
  const calls = Number(h.calls ?? 0) || 0;
  return {
    model,
    calls,
    promptTokens,
    outputTokens,
    thinkingTokens,
    totalTokens,
    cost: computeCost(promptTokens, outputTokens, thinkingTokens, model),
  };
}

/** Lê todas as linhas por modelo de um índice de modelos + prefixo de key. */
async function readModelRows(
  indexKey: string,
  keyFor: (model: string) => string,
): Promise<ModelUsageRow[]> {
  const models = await redis.smembers(indexKey);
  if (models.length === 0) return [];
  const pipeline = redis.multi();
  for (const model of models) pipeline.hgetall(keyFor(model));
  const results = await pipeline.exec();
  const rows = models.map((model, i) => {
    const hash = (results?.[i]?.[1] ?? null) as Record<string, string> | null;
    return rowFromHash(model, hash);
  });
  // Mais caro primeiro: é o que a tela quer destacar.
  rows.sort((a, b) => b.cost.total - a.cost.total || b.totalTokens - a.totalTokens);
  return rows;
}

/** Consumo do dia — para o log, para o widget de transparência e para o teste. */
export async function getUsage(brandSlug?: string): Promise<UsageSnapshot> {
  const day = today();
  const globalTokens = await readCounter(globalKey(day));
  const brandTokens = brandSlug ? await readCounter(brandKey(brandSlug, day)) : undefined;

  const models = brandSlug
    ? await readModelRows(dayBrandModelsIndex(brandSlug, day), (m) => dayBrandModelKey(brandSlug, day, m))
    : await readModelRows(dayModelsIndex(day), (m) => dayModelKey(day, m));

  return {
    day,
    globalTokens,
    globalBudget: config.aiDailyTokenBudget,
    brandSlug,
    brandTokens,
    brandBudget: config.aiBrandDailyTokenBudget,
    models,
    cost: sumCosts(models),
    currency: config.aiUsdToBrl > 0 ? 'BRL' : 'USD',
    taxRate: config.aiTaxRate,
  };
}

/** Billing de um mês por modelo (por marca quando há marca; senão, global). */
export async function getBilling(brandSlug?: string, month?: string): Promise<BillingReport> {
  const mes = month && /^\d{4}-\d{2}$/.test(month) ? month : thisMonth();

  const availableMonths = (
    await redis.smembers(brandSlug ? brandMonthsIndex(brandSlug) : monthsIndex())
  ).sort((a, b) => b.localeCompare(a));
  // O mês corrente pode ainda não estar no índice (primeira chamada do mês): garante que
  // o seletor sempre ofereça pelo menos "agora".
  if (!availableMonths.includes(thisMonth())) availableMonths.unshift(thisMonth());

  const models = brandSlug
    ? await readModelRows(monthBrandModelsIndex(brandSlug, mes), (m) => monthBrandModelKey(brandSlug, mes, m))
    : await readModelRows(monthModelsIndex(mes), (m) => monthModelKey(mes, m));

  const totals = models.reduce(
    (acc, r) => {
      acc.calls += r.calls;
      acc.promptTokens += r.promptTokens;
      acc.outputTokens += r.outputTokens;
      acc.thinkingTokens += r.thinkingTokens;
      acc.totalTokens += r.totalTokens;
      return acc;
    },
    { calls: 0, promptTokens: 0, outputTokens: 0, thinkingTokens: 0, totalTokens: 0 },
  );

  return {
    brandSlug,
    month: mes,
    availableMonths,
    models,
    totals: { ...totals, cost: sumCosts(models) },
    currency: config.aiUsdToBrl > 0 ? 'BRL' : 'USD',
    taxRate: config.aiTaxRate,
    prices: config.aiModelPrices,
  };
}

/**
 * Recusa a chamada se o teto do dia já estourou. Roda ANTES de gastar.
 *
 * O corte é por chamada, não por token: a última chamada pode passar um pouco do
 * teto (só sabemos o custo dela depois). Isso é de propósito — cortar no meio de
 * uma geração deixaria o deck pela metade, e o excesso é de uma chamada, não de mil.
 */
export async function assertWithinBudget(): Promise<void> {
  const { brandSlug } = getAiContext();

  if (config.aiDailyTokenBudget > 0) {
    const usados = await readCounter(globalKey());
    if (usados >= config.aiDailyTokenBudget) {
      logger.error('Teto diário de IA estourado (global)', {
        usedTokens: usados,
        budget: config.aiDailyTokenBudget,
      });
      throw createError(
        429,
        'O teto diário de uso de IA foi atingido. Novas gerações voltam amanhã ou quando o limite for elevado.',
      );
    }
  }

  if (brandSlug && config.aiBrandDailyTokenBudget > 0) {
    const usados = await readCounter(brandKey(brandSlug));
    if (usados >= config.aiBrandDailyTokenBudget) {
      logger.error('Teto diário de IA estourado (marca)', {
        brandSlug,
        usedTokens: usados,
        budget: config.aiBrandDailyTokenBudget,
      });
      throw createError(
        429,
        'Esta marca atingiu o teto diário de uso de IA. Tente novamente amanhã ou eleve o limite.',
      );
    }
  }
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  thoughtsTokenCount?: number;
}

/**
 * Acumula um consumo por modelo num hash (5 campos) e registra o modelo no índice,
 * renovando o TTL. É a mesma forma para diário e mensal, só muda a retenção.
 */
function accumulateModel(
  pipeline: ReturnType<typeof redis.multi>,
  hashKey: string,
  indexKey: string,
  model: string,
  prompt: number,
  output: number,
  thinking: number,
  total: number,
  ttl: number,
): void {
  pipeline.hincrby(hashKey, 'calls', 1);
  pipeline.hincrby(hashKey, 'prompt', prompt);
  pipeline.hincrby(hashKey, 'output', output);
  pipeline.hincrby(hashKey, 'thinking', thinking);
  pipeline.hincrby(hashKey, 'total', total);
  pipeline.expire(hashKey, ttl);
  pipeline.sadd(indexKey, model);
  pipeline.expire(indexKey, ttl);
}

/** Soma o consumo de uma chamada nos contadores do dia/mês. Nunca derruba a geração. */
export async function recordUsage(model: string, usage: GeminiUsageMetadata | undefined): Promise<void> {
  const total = Number(usage?.totalTokenCount ?? 0);
  if (!Number.isFinite(total) || total <= 0) return;

  const prompt = Number(usage?.promptTokenCount ?? 0) || 0;
  const output = Number(usage?.candidatesTokenCount ?? 0) || 0;
  const thinking = Number(usage?.thoughtsTokenCount ?? 0) || 0;

  const { brandSlug, feature, sessionId } = getAiContext();
  const dia = today();
  const mes = thisMonth();

  try {
    const pipeline = redis.multi();

    // Contadores de TOTAL do dia (o que o teto lê) — inalterados.
    pipeline.incrby(globalKey(dia), total);
    pipeline.expire(globalKey(dia), DAILY_RETENTION_SECONDS);
    if (brandSlug) {
      pipeline.incrby(brandKey(brandSlug, dia), total);
      pipeline.expire(brandKey(brandSlug, dia), DAILY_RETENTION_SECONDS);
    }

    // Quebra por modelo — diária (global + marca).
    accumulateModel(pipeline, dayModelKey(dia, model), dayModelsIndex(dia), model, prompt, output, thinking, total, DAILY_RETENTION_SECONDS);
    if (brandSlug) {
      accumulateModel(pipeline, dayBrandModelKey(brandSlug, dia, model), dayBrandModelsIndex(brandSlug, dia), model, prompt, output, thinking, total, DAILY_RETENTION_SECONDS);
    }

    // Quebra por modelo — mensal (global + marca), retenção longa para o billing.
    accumulateModel(pipeline, monthModelKey(mes, model), monthModelsIndex(mes), model, prompt, output, thinking, total, MONTHLY_RETENTION_SECONDS);
    pipeline.sadd(monthsIndex(), mes);
    if (brandSlug) {
      accumulateModel(pipeline, monthBrandModelKey(brandSlug, mes, model), monthBrandModelsIndex(brandSlug, mes), model, prompt, output, thinking, total, MONTHLY_RETENTION_SECONDS);
      pipeline.sadd(brandMonthsIndex(brandSlug), mes);
    }

    await pipeline.exec();
  } catch (err) {
    // Perder a contagem é ruim; derrubar a geração do usuário por causa dela é pior.
    logger.error('Falha ao registrar consumo de IA', { error: (err as Error).message });
  }

  const cost = computeCost(prompt, output, thinking, model);
  logger.info('Chamada de IA', {
    model,
    feature,
    brandSlug,
    sessionId,
    promptTokens: usage?.promptTokenCount,
    outputTokens: usage?.candidatesTokenCount,
    thinkingTokens: usage?.thoughtsTokenCount,
    totalTokens: total,
    estimatedCost: cost.total,
    costCurrency: cost.currency,
  });
}
