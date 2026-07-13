import { GoogleGenAI } from '@google/genai';
import { assertWithinBudget, recordUsage } from './aiBudget.js';
import { logger } from './logger.js';

// Modelos de fallback — se o primário falhar (503/429/rede), tenta o próximo.
// Modernizados: modelos capazes que produzem JSON confiável. Os antigos
// (1.5-flash / 2.0-flash-lite) geravam saída inválida em prompts complexos.
const MODEL_FALLBACK_CHAIN = [
  'gemini-3.5-flash',
  'gemini-2.5-flash',
] as const;

export type GeminiModel = typeof MODEL_FALLBACK_CHAIN[number];

/** Blip de rede merece insistência: o mesmo modelo volta a funcionar em 1s. */
const MAX_NETWORK_RETRIES = 3;

/**
 * Sobrecarga (503 "high demand" / 429) NÃO merece: o modelo não está com soluço,
 * está lotado, e insistir nele é esperar por nada. Uma tentativa e cai para o
 * próximo modelo. Medido em produção: o gemini-3.5-flash lotado custava ~17s de
 * retries (3 tentativas + backoff de 1s e 2s) ANTES de a chamada útil começar.
 */
const MAX_OVERLOAD_ATTEMPTS = 1;

const BASE_DELAY_MS = 1000;

// ── Circuit breaker por modelo ───────────────────────────────────────────────
// Sem isto, cada chamada nova redescobre do zero que o modelo está lotado e paga
// o pedágio de novo. Depois de algumas recusas seguidas, o modelo fica "aberto"
// (pulado) por alguns minutos e as chamadas seguintes vão direto para o saudável.

const BREAKER_FAILURE_THRESHOLD = 2;
const BREAKER_COOLDOWN_MS = 3 * 60 * 1000;

interface BreakerState {
  failures: number;
  openUntil: number;
}

const breakers = new Map<string, BreakerState>();

function isBreakerOpen(model: string): boolean {
  const state = breakers.get(model);
  if (!state) return false;
  if (state.openUntil > Date.now()) return true;

  // Passou o cooldown: fecha e deixa o modelo ser testado de novo.
  if (state.openUntil !== 0) {
    breakers.delete(model);
    logger.info('Modelo volta a ser tentado (cooldown terminou)', { model });
  }
  return false;
}

function recordModelFailure(model: string, reason: string): void {
  const state = breakers.get(model) ?? { failures: 0, openUntil: 0 };
  state.failures += 1;

  if (state.failures >= BREAKER_FAILURE_THRESHOLD) {
    state.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
    logger.warn('Modelo marcado como indisponível; pulando até o cooldown passar', {
      model,
      failures: state.failures,
      cooldownMs: BREAKER_COOLDOWN_MS,
      reason,
    });
  }

  breakers.set(model, state);
}

function recordModelSuccess(model: string): void {
  if (breakers.delete(model)) {
    logger.info('Modelo respondeu de novo; circuito fechado', { model });
  }
}

/** Só para os testes: zera o estado entre casos. */
export function resetModelBreakers(): void {
  breakers.clear();
}

function isOverloaded(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { status?: number; message?: string };
  const msg = typeof e.message === 'string' ? e.message : '';
  return e.status === 503 || e.status === 429 ||
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('high demand') ||
    msg.includes('429') ||
    msg.includes('quota');
}

function isTransientNetwork(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { message?: string; code?: string; cause?: { code?: string } };
  const code = `${e.code ?? ''} ${e.cause?.code ?? ''}`;
  const msg = typeof e.message === 'string' ? e.message : '';
  return msg.includes('fetch failed') ||
    msg.includes('terminated') ||
    msg.toLowerCase().includes('timeout') ||
    code.includes('UND_ERR') ||
    code.includes('ECONNRESET') ||
    code.includes('ETIMEDOUT') ||
    code.includes('ECONNREFUSED') ||
    code.includes('EAI_AGAIN');
}

function isRetryable(error: unknown): boolean {
  return isOverloaded(error) || isTransientNetwork(error);
}

/**
 * Ordena os modelos a tentar, jogando para o fim os que estão com o circuito aberto.
 * Não os REMOVE: se todos estiverem abertos, tentar um lotado ainda é melhor que
 * falhar sem tentar.
 */
function orderModels(models: string[]): string[] {
  const saudaveis = models.filter((m) => !isBreakerOpen(m));
  const abertos = models.filter((m) => isBreakerOpen(m));
  if (abertos.length > 0) {
    logger.debug('Pulando modelo com circuito aberto', { skipped: abertos });
  }
  return [...saudaveis, ...abertos];
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
 * Núcleo de tentativa, compartilhado pelo streaming e pelo não-streaming: sem isto
 * a política de retry divergia entre os dois e o chat (que é stream) se comportava
 * diferente do resto sem ninguém perceber.
 *
 * Regras:
 * - Erro NÃO retentável (prompt inválido, chave errada): estoura na hora.
 * - Sobrecarga (503/429): UMA tentativa e vai para o próximo modelo. Insistir num
 *   modelo lotado é esperar por nada — era o que queimava ~17s por chamada.
 * - Blip de rede: até 3 tentativas com backoff, porque o mesmo modelo costuma voltar.
 * - Modelo que dá sobrecarga repetida entra em cooldown e é pulado nas chamadas
 *   seguintes (circuit breaker), em vez de cada chamada redescobrir a lotação.
 */
async function runWithFallback<T>(
  modelsToTry: string[],
  hooks: GeminiRetryHooks | undefined,
  executar: (model: string) => Promise<T>,
): Promise<T> {
  const ordenados = orderModels(modelsToTry);
  let lastError: unknown;

  for (let modelIndex = 0; modelIndex < ordenados.length; modelIndex++) {
    const model = ordenados[modelIndex]!;
    let attempt = 0;

    for (;;) {
      attempt++;
      try {
        const resultado = await executar(model);
        recordModelSuccess(model);
        return resultado;
      } catch (err) {
        lastError = err;

        if (!isRetryable(err)) throw err;

        const reason = getErrorReason(err);
        const sobrecarga = isOverloaded(err);
        if (sobrecarga) recordModelFailure(model, reason);

        const maxAttempts = sobrecarga ? MAX_OVERLOAD_ATTEMPTS : MAX_NETWORK_RETRIES;

        if (attempt < maxAttempts) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          hooks?.onRetry?.({ model, attempt, delayMs: delay, reason });
          await sleep(delay);
          continue;
        }

        const nextModel = ordenados[modelIndex + 1];
        if (nextModel) {
          hooks?.onFallback?.({ fromModel: model, toModel: nextModel, reason });
        }
        break; // acabou a paciência com ESTE modelo; tenta o próximo
      }
    }
  }

  throw lastError;
}

function buildModelList(preferredModel?: string): string[] {
  return preferredModel
    ? [preferredModel, ...MODEL_FALLBACK_CHAIN.filter((m) => m !== preferredModel)]
    : [...MODEL_FALLBACK_CHAIN];
}

/**
 * Chama ai.models.generateContent com retry, fallback de modelo e teto de gasto.
 */
export async function generateWithRetry(
  ai: GoogleGenAI,
  params: GenerateContentParams,
  preferredModel?: string,
  hooks?: GeminiRetryHooks,
): Promise<ReturnType<InstanceType<typeof GoogleGenAI>['models']['generateContent']>> {
  // Todo gasto de IA passa por aqui: é o único ponto onde dá para cortar antes de
  // cobrar. Fora do runner: estourar o teto NÃO é retentável — retentar seria
  // insistir em gastar o que já acabou.
  await assertWithinBudget();

  return runWithFallback(buildModelList(preferredModel), hooks, async (model) => {
    const result = await ai.models.generateContent({ ...params, model });
    await recordUsage(model, result.usageMetadata);
    return result;
  });
}

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

/**
 * Versão para streaming (generateContentStream).
 */
export async function generateStreamWithRetry(
  ai: GoogleGenAI,
  params: GenerateContentParams,
  preferredModel?: string,
  hooks?: GeminiRetryHooks,
): Promise<StreamResult> {
  await assertWithinBudget();

  return runWithFallback(buildModelList(preferredModel), hooks, async (model) => {
    const result = await ai.models.generateContentStream({ ...params, model });
    return meterStream(result, model);
  });
}
