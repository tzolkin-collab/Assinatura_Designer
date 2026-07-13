import { GoogleGenAI } from '@google/genai';
import { assertWithinBudget, recordUsage } from './aiBudget.js';

// Modelos de fallback — se o primário falhar (503/429/rede), tenta o próximo.
// Modernizados: modelos capazes que produzem JSON confiável. Os antigos
// (1.5-flash / 2.0-flash-lite) geravam saída inválida em prompts complexos.
const MODEL_FALLBACK_CHAIN = [
  'gemini-3.5-flash',
  'gemini-2.5-flash',
] as const;

export type GeminiModel = typeof MODEL_FALLBACK_CHAIN[number];

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function isRetryable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { status?: number; message?: string; code?: string; cause?: { code?: string } };
  const code = `${e.code ?? ''} ${e.cause?.code ?? ''}`;
  const msg = typeof e.message === 'string' ? e.message : '';
  return e.status === 503 || e.status === 429 ||
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('high demand') ||
    msg.includes('429') ||
    msg.includes('quota') ||
    // Erros de rede transitórios (fetch/undici) — antes não eram retentados e
    // um blip de rede matava a geração inteira.
    msg.includes('fetch failed') ||
    msg.includes('terminated') ||
    msg.toLowerCase().includes('timeout') ||
    code.includes('UND_ERR') ||
    code.includes('ECONNRESET') ||
    code.includes('ETIMEDOUT') ||
    code.includes('ECONNREFUSED') ||
    code.includes('EAI_AGAIN');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type GenerateContentParams = Parameters<InstanceType<typeof GoogleGenAI>['models']['generateContent']>[0];

export interface GeminiRetryHooks {
  onRetry?: (info: { model: string; attempt: number; delayMs: number; reason: string }) => void;
  onFallback?: (info: { fromModel: string; toModel: string; reason: string }) => void;
}

function getErrorReason(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Erro temporário do provedor de IA';
  const e = error as { status?: number; message?: string };
  if (e.status === 503 || e.message?.includes('UNAVAILABLE') || e.message?.includes('high demand')) {
    return 'O modelo está com alta demanda no momento';
  }
  if (e.status === 429 || e.message?.includes('quota')) {
    return 'O provedor atingiu o limite temporário de uso';
  }
  return e.message || 'Erro temporário do provedor de IA';
}

export function humanizeGeminiError(error: unknown): string {
  const reason = getErrorReason(error);
  if (reason.includes('alta demanda')) {
    return 'O modelo está com alta demanda agora. Tente novamente em alguns segundos.';
  }
  if (reason.includes('limite temporário')) {
    return 'O provedor de IA atingiu um limite temporário. Tente novamente daqui a pouco.';
  }
  return 'Houve uma falha temporária na IA. Tente novamente em instantes.';
}

/**
 * Chama ai.models.generateContent com retry automático e fallback de modelo.
 * Tenta MODEL_FALLBACK_CHAIN em sequência se os erros forem 503/429.
 */
export async function generateWithRetry(
  ai: GoogleGenAI,
  params: GenerateContentParams,
  preferredModel?: string,
  hooks?: GeminiRetryHooks,
): Promise<ReturnType<InstanceType<typeof GoogleGenAI>['models']['generateContent']>> {
  const modelsToTry = preferredModel
    ? [preferredModel, ...MODEL_FALLBACK_CHAIN.filter((m) => m !== preferredModel)]
    : [...MODEL_FALLBACK_CHAIN];

  // Todo gasto de IA passa por aqui: é o único ponto onde dá para cortar antes de
  // cobrar. Fora do try: estourar o teto NÃO é retentável — retentar seria insistir
  // em gastar o que já acabou.
  await assertWithinBudget();

  let lastError: unknown;

  for (let modelIndex = 0; modelIndex < modelsToTry.length; modelIndex++) {
    const model = modelsToTry[modelIndex]!;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await ai.models.generateContent({ ...params, model });
        await recordUsage(model, result.usageMetadata);
        return result;
      } catch (err) {
        lastError = err;

        if (!isRetryable(err)) {
          throw err;
        }

        const reason = getErrorReason(err);
        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          hooks?.onRetry?.({ model, attempt, delayMs: delay, reason });
          await sleep(delay);
          continue;
        }

        const nextModel = modelsToTry[modelIndex + 1];
        if (nextModel) {
          hooks?.onFallback?.({ fromModel: model, toModel: nextModel, reason });
        }
      }
    }
  }

  throw lastError;
}

/**
 * Versão para streaming (generateContentStream).
 */
type StreamResult = Awaited<ReturnType<InstanceType<typeof GoogleGenAI>['models']['generateContentStream']>>;

/**
 * O consumo de um stream só aparece no último chunk. Sem envolver o iterador, todo
 * o gasto do chat ficaria fora da conta — e o teto seria furado pelo caminho mais
 * usado do produto.
 */
async function* meterStream(stream: StreamResult, model: string): StreamResult {
  let ultimoUso: unknown;
  for await (const chunk of stream) {
    if (chunk.usageMetadata) ultimoUso = chunk.usageMetadata;
    yield chunk;
  }
  await recordUsage(model, ultimoUso as Parameters<typeof recordUsage>[1]);
}

export async function generateStreamWithRetry(
  ai: GoogleGenAI,
  params: GenerateContentParams,
  preferredModel?: string,
  hooks?: GeminiRetryHooks,
): Promise<StreamResult> {
  const modelsToTry = preferredModel
    ? [preferredModel, ...MODEL_FALLBACK_CHAIN.filter((m) => m !== preferredModel)]
    : [...MODEL_FALLBACK_CHAIN];

  await assertWithinBudget();

  let lastError: unknown;

  for (let modelIndex = 0; modelIndex < modelsToTry.length; modelIndex++) {
    const model = modelsToTry[modelIndex]!;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await ai.models.generateContentStream({ ...params, model });
        return meterStream(result, model);
      } catch (err) {
        lastError = err;
        if (!isRetryable(err)) throw err;
        const reason = getErrorReason(err);
        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          hooks?.onRetry?.({ model, attempt, delayMs: delay, reason });
          await sleep(delay);
          continue;
        }
        const nextModel = modelsToTry[modelIndex + 1];
        if (nextModel) {
          hooks?.onFallback?.({ fromModel: model, toModel: nextModel, reason });
        }
      }
    }
  }

  throw lastError;
}
