import { redis } from './redis.js';
import { config } from '../config.js';
import { getAiContext } from './aiContext.js';
import { createError } from '../middleware/errorHandler.js';
import { logger } from './logger.js';

/**
 * Teto de gasto de IA.
 *
 * Não havia nenhum: um deck de 200 slides dispara `pipelineConcurrency ×
 * generationConcurrency` chamadas simultâneas ao Gemini, e um brief mal formado
 * (ou um loop de retry) queimava caixa sem ninguém ver. Aqui o consumo é medido e,
 * passado o teto do dia, a próxima chamada é recusada em vez de cobrada.
 *
 * A conta é em TOKENS, não em reais: token vem exato do provedor (`usageMetadata`),
 * enquanto tabela de preço envelhece calada e passaria a mentir sem avisar. O valor
 * em dólar é só uma estimativa opcional para log (AI_USD_PER_MILLION_TOKENS).
 */

const RETENTION_SECONDS = 3 * 24 * 60 * 60; // 3 dias: o suficiente para depurar ontem

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function globalKey(dia = today()): string {
  return `ai:usage:${dia}:global`;
}

function brandKey(brandSlug: string, dia = today()): string {
  return `ai:usage:${dia}:brand:${brandSlug}`;
}

async function readCounter(key: string): Promise<number> {
  const raw = await redis.get(key);
  return raw ? Number(raw) || 0 : 0;
}

export interface UsageSnapshot {
  day: string;
  globalTokens: number;
  globalBudget: number;
  brandSlug?: string;
  brandTokens?: number;
  brandBudget: number;
}

/** Consumo do dia — para o log, para a rota de status e para o teste. */
export async function getUsage(brandSlug?: string): Promise<UsageSnapshot> {
  const day = today();
  const globalTokens = await readCounter(globalKey(day));
  const brandTokens = brandSlug ? await readCounter(brandKey(brandSlug, day)) : undefined;

  return {
    day,
    globalTokens,
    globalBudget: config.aiDailyTokenBudget,
    brandSlug,
    brandTokens,
    brandBudget: config.aiBrandDailyTokenBudget,
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

/** Soma o consumo de uma chamada nos contadores do dia. Nunca derruba a geração. */
export async function recordUsage(model: string, usage: GeminiUsageMetadata | undefined): Promise<void> {
  const total = Number(usage?.totalTokenCount ?? 0);
  if (!Number.isFinite(total) || total <= 0) return;

  const { brandSlug, feature, sessionId } = getAiContext();

  try {
    const pipeline = redis.multi();
    pipeline.incrby(globalKey(), total);
    pipeline.expire(globalKey(), RETENTION_SECONDS);
    if (brandSlug) {
      pipeline.incrby(brandKey(brandSlug), total);
      pipeline.expire(brandKey(brandSlug), RETENTION_SECONDS);
    }
    await pipeline.exec();
  } catch (err) {
    // Perder a contagem é ruim; derrubar a geração do usuário por causa dela é pior.
    logger.error('Falha ao registrar consumo de IA', { error: (err as Error).message });
  }

  logger.info('Chamada de IA', {
    model,
    feature,
    brandSlug,
    sessionId,
    promptTokens: usage?.promptTokenCount,
    outputTokens: usage?.candidatesTokenCount,
    thinkingTokens: usage?.thoughtsTokenCount,
    totalTokens: total,
    estimatedUsd: estimateUsd(total),
  });
}

/** Estimativa grosseira, só para log. 0 (default) = não estima. */
function estimateUsd(tokens: number): number | undefined {
  if (config.aiUsdPerMillionTokens <= 0) return undefined;
  return Number(((tokens / 1_000_000) * config.aiUsdPerMillionTokens).toFixed(4));
}
