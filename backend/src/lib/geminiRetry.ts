import { getAiContext } from "./aiContext.js";
import { recordStep } from "./generationTracing.js";
import { GoogleGenAI } from '@google/genai';
import { assertWithinBudget, recordUsage } from './aiBudget.js';
import { acquireSlot, releaseSlot, onRateLimited, onSuccess } from './aiThrottle.js';
import { logger } from './logger.js';
import { config } from '../config.js';

/**
 * TIERS ESTÉTICOS — e não uma corrente única de fallback.
 *
 * Antes havia uma lista só (`[preferido, 3.5-flash, 2.5-flash]`) e qualquer tropeço do
 * modelo preferido derrubava a chamada nela. Só que o deck é gerado no PRO: cair para o
 * flash não é "usar o modelo reserva", é trocar de designer no meio do trabalho. Metade
 * das lâminas saía com uma mão, metade com outra — e inconsistência salta aos olhos
 * muito mais do que mediocridade uniforme.
 *
 * Agora uma chamada NUNCA cruza de tier. Um pro só cai para outro pro. Se o tier inteiro
 * acabar, a chamada falha (e o chamador decide: o `runBatch` do irDesign faz placeholder
 * on-brand, que é neutro, em vez de arte com outra assinatura).
 */
const MODEL_TIERS = {
  /**
   * Geração de deck e edição de slide: é a arte. Latência importa menos que a mão.
   * Banco de reservas fundo DE PROPÓSITO (os três existem, conferidos na API): quanto
   * mais irmãos da mesma mão, menor a chance de a geração ter de recorrer ao placeholder.
   */
  artista: ['gemini-3.1-pro-preview', 'gemini-2.5-pro'],
  /** Chat, planner, reviewer: precisa responder rápido; a estética não depende disto. */
  rapido: ['gemini-3.5-flash', 'gemini-2.5-flash'],
  /** Tarefas mecânicas (classificar, extrair). */
  barato: ['gemini-2.5-flash-lite'],
} as const;

export type Tier = keyof typeof MODEL_TIERS;
export type GeminiModel = typeof MODEL_TIERS[Tier][number];

const DEFAULT_TIER: Tier = 'rapido';

/**
 * A que tier um modelo pertence. Modelo desconhecido (um `gemini-4-pro` que apareça
 * amanhã no .env) é classificado pelo nome — melhor um palpite estruturado do que cair
 * silenciosamente no tier errado e degradar a arte sem ninguém notar.
 */
export function tierOf(model: string): Tier {
  for (const [tier, modelos] of Object.entries(MODEL_TIERS)) {
    if ((modelos as readonly string[]).includes(model)) return tier as Tier;
  }
  if (/lite/i.test(model)) return 'barato';
  if (/pro/i.test(model)) return 'artista';
  return DEFAULT_TIER;
}

/** Blip de rede merece insistência: o mesmo modelo volta a funcionar em 1s. */
const MAX_NETWORK_RETRIES = 3;

/**
 * Sobrecarga do PROVEDOR (503 "high demand") não merece: o modelo não está com soluço,
 * está lotado, e insistir nele é esperar por nada. Uma tentativa e cai para o próximo
 * modelo DO MESMO TIER. Medido: o gemini-3.5-flash lotado custava ~17s de retries
 * (3 tentativas + backoff de 1s e 2s) ANTES de a chamada útil começar.
 */
const MAX_OVERLOAD_ATTEMPTS = 1;

const BASE_DELAY_MS = 1000;

/** Teto de espera de um único backoff de rate limit. */
const RATE_LIMIT_MAX_DELAY_MS = 30_000;

// ── Circuit breaker por modelo ───────────────────────────────────────────────
// Para modelo DOENTE (lotado cronicamente, lento). NÃO para rate limit — ver `isRateLimited`.

const BREAKER_FAILURE_THRESHOLD = 2;
const BREAKER_COOLDOWN_MS = 3 * 60 * 1000;

/**
 * As falhas contam dentro de uma JANELA, não em sequência.
 *
 * A primeira versão contava falhas consecutivas e o sucesso zerava o contador. Contra
 * um modelo INTERMITENTE isso nunca abre o circuito: medido de verdade, o
 * gemini-3.5-flash estourou o tempo, depois respondeu (zerando a conta) e estourou de
 * novo — e a terceira chamada pagou os 25s de espera outra vez. Um modelo que falhou
 * duas vezes em cinco minutos não é confiável, tenha acertado no meio ou não.
 */
const BREAKER_WINDOW_MS = 5 * 60 * 1000;

interface BreakerState {
  /** Quando cada falha recente aconteceu (as antigas saem da janela). */
  failures: number[];
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
  const agora = Date.now();
  const state = breakers.get(model) ?? { failures: [], openUntil: 0 };

  state.failures = state.failures.filter((t) => agora - t < BREAKER_WINDOW_MS);
  state.failures.push(agora);

  if (state.failures.length >= BREAKER_FAILURE_THRESHOLD) {
    state.openUntil = agora + BREAKER_COOLDOWN_MS;
    logger.warn('Modelo marcado como indisponível; pulando até o cooldown passar', {
      model,
      failures: state.failures.length,
      windowMs: BREAKER_WINDOW_MS,
      cooldownMs: BREAKER_COOLDOWN_MS,
      reason,
    });
  }

  breakers.set(model, state);
}

/**
 * Um acerto isolado NÃO apaga o histórico da janela — é justamente o acerto ocasional
 * que mascarava a intermitência. Só o fim do cooldown reabilita o modelo.
 */
function recordModelSuccess(model: string): void {
  const state = breakers.get(model);
  if (state && state.openUntil === 0 && state.failures.length === 0) {
    breakers.delete(model);
  }
}

/** Só para os testes: zera o estado entre casos. */
export function resetModelBreakers(): void {
  breakers.clear();
}

/**
 * CRÉDITO ACABADO — um 429 que NÃO é rate limit, e o mais caro de confundir.
 *
 * O Google devolve 429 tanto para "você está indo rápido demais" quanto para "a conta
 * está sem crédito" (`Your prepayment credits are depleted`). São opostos: o primeiro
 * passa se você esperar; o segundo NUNCA passa — nenhum modelo, nenhuma espera, nenhum
 * tier. Tratados como iguais (o que acontecia aqui), uma conta zerada virava 6 tentativas
 * por modelo × 2 modelos = ~85s de espera por chamada, todos os lotes falhando, e o
 * usuário lendo "limite temporário, tente daqui a pouco" — uma mentira, porque esperar
 * não ia resolver nunca. Foi exatamente esse o bloqueio dos decks de 30 slides.
 *
 * Resposta correta: estourar na hora, dizer a verdade, e não gastar mais nada.
 */
function isCreditsDepleted(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { message?: string };
  const msg = (typeof e.message === 'string' ? e.message : '').toLowerCase();
  return msg.includes('credits are depleted') ||
    msg.includes('prepayment credits') ||
    // "check your plan and billing details" — cota da conta esgotada, mesma natureza:
    // é a conta que precisa de ação humana, não a nossa concorrência.
    msg.includes('billing');
}

/**
 * RATE LIMIT (429 / RESOURCE_EXHAUSTED / quota) — a distinção que este arquivo inteiro
 * existe para fazer.
 *
 * Isto NÃO é um defeito do modelo. É a nossa própria paralelização (até
 * pipelineConcurrency × generationConcurrency chamadas simultâneas) batendo no teto da
 * cota. O modelo está saudável; nós é que exageramos. Tratar isso como "modelo ruim"
 * era o bug: uma oscilação de cota bania o pro por 3 minutos (breaker) e o resto do
 * deck saía no flash.
 *
 * Resposta correta: esperar, insistir no MESMO modelo, e fechar a torneira (aiThrottle).
 */
function isRateLimited(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  // Crédito acabado também chega como 429 — e não é rate limit. Sem esta guarda, ele
  // entraria no laço de espera/insistência e no AIMD (que fecharia a torneira contra
  // um congestionamento que não existe: os logs mostram 429 com inFlight=0).
  if (isCreditsDepleted(error)) return false;

  const e = error as { status?: number; code?: number; message?: string };
  const msg = typeof e.message === 'string' ? e.message : '';
  return e.status === 429 || e.code === 429 ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.toLowerCase().includes('rate limit') ||
    msg.toLowerCase().includes('quota');
}

/**
 * Sobrecarga do PROVEDOR (503): o modelo está lotado para todo mundo, não só para nós.
 * Esperar não resolve — quem tem que resolver é o Google. Cai para o irmão do tier.
 *
 * Note que o 429 saiu daqui: era ele que contaminava esta função e fazia o modelo bom
 * ser demitido por um problema que era nosso.
 */
function isOverloaded(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { status?: number; message?: string };
  const msg = typeof e.message === 'string' ? e.message : '';
  return e.status === 503 ||
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('high demand') ||
    msg.includes('overloaded');
}

/**
 * O 429 do Google carrega quanto esperar (`RetryInfo.retryDelay: "12s"`) nos detalhes do
 * erro. Chutar backoff quando o provedor JÁ DISSE o número é adivinhar com a resposta na
 * mão. Se vier, obedecemos.
 */
function extractRetryDelayMs(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;

  const e = error as { message?: string; details?: unknown };

  const deDetalhes = (details: unknown): number | undefined => {
    if (!Array.isArray(details)) return undefined;
    for (const d of details) {
      if (d && typeof d === 'object') {
        const rec = d as { '@type'?: string; retryDelay?: string };
        if (typeof rec.retryDelay === 'string' && rec['@type']?.includes('RetryInfo')) {
          const seg = parseFloat(rec.retryDelay.replace('s', ''));
          if (Number.isFinite(seg)) return Math.round(seg * 1000);
        }
      }
    }
    return undefined;
  };

  const direto = deDetalhes(e.details);
  if (direto !== undefined) return direto;

  // O SDK frequentemente entrega o corpo do erro como JSON dentro da `message`.
  if (typeof e.message === 'string') {
    const m = e.message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
    if (m?.[1]) {
      const seg = parseFloat(m[1]);
      if (Number.isFinite(seg)) return Math.round(seg * 1000);
    }
  }
  return undefined;
}

/**
 * Quanto tempo esperar por UMA tentativa, decidido pelo peso do modelo.
 *
 * Não dá para decidir por feature: "editar um slide" parece leve, mas roda no pro e
 * legitimamente passa de 25s. Já uma chamada flash que demora 70s está doente — é o
 * caso real do gemini-3.5-flash, que responde "oi" em 70s porque pensa por padrão,
 * enquanto o 2.5-flash faz o mesmo em 0,8s.
 */
export function timeoutForModel(model: string): number {
  const pesado = /pro/i.test(model);
  return pesado ? config.aiTimeoutHeavyMs : config.aiTimeoutLightMs;
}

/**
 * Estourou o tempo desta tentativa. Tratado como sobrecarga: uma tentativa só e vai
 * para o próximo modelo do tier, e o modelo lento alimenta o circuit breaker — senão
 * toda chamada seguinte pagaria a mesma espera de novo.
 *
 * Ressalva honesta: abortar é client-side (o SDK avisa). A gente para de ESPERAR, mas
 * o provedor segue processando e a chamada ainda é cobrada. O ganho é o usuário não
 * ficar preso e a geração cair no modelo que responde.
 */
function isTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; message?: string };
  return e.name === 'AbortError' || e.name === 'TimeoutError' ||
    (typeof e.message === 'string' && e.message.includes('aborted'));
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
  // Conta sem crédito não se resolve tentando de novo, nem em outro modelo — a única
  // saída passa por um humano no AI Studio. Insistir só queima tempo do usuário.
  if (isCreditsDepleted(error)) return false;

  // `isTimeout` explícito: sem ele, o abort só era retentável por acidente (a mensagem
  // do DOMException contém "timeout"). Um abort com outra mensagem estouraria a
  // geração em vez de cair no próximo modelo.
  return isRateLimited(error) || isOverloaded(error) || isTimeout(error) || isTransientNetwork(error);
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

/**
 * Jitter TOTAL, não backoff limpo.
 *
 * Com 8 lotes em paralelo tomando 429 no mesmo instante, um backoff determinístico faz
 * os 8 dormirem o mesmo tanto e acordarem juntos — a rajada se reconstrói inteira e
 * provoca o 429 seguinte. O sorteio em [0, teto] espalha o retorno e quebra o comboio.
 */
function comJitter(tetoMs: number): number {
  return Math.floor(Math.random() * tetoMs);
}

type GenerateContentParams = Parameters<InstanceType<typeof GoogleGenAI>['models']['generateContent']>[0];

export interface GeminiRetryHooks {
  onRetry?: (info: { model: string; attempt: number; delayMs: number; reason: string }) => void;
  onFallback?: (info: { fromModel: string; toModel: string; reason: string }) => void;
}

function getErrorReason(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Erro temporário do provedor de IA';
  const e = error as { status?: number; message?: string };
  if (isCreditsDepleted(error)) return 'A conta do Gemini está sem créditos';
  if (isRateLimited(error)) return 'O provedor atingiu o limite temporário de uso';
  if (isOverloaded(error)) return 'O modelo está com alta demanda no momento';
  return e.message || 'Erro temporário do provedor de IA';
}

/**
 * Traduz um erro para o usuário — SEM inventar uma causa.
 *
 * Isto era chamado sobre QUALQUER erro da geração (pipeline.ts) e o ramo final dizia
 * "Houve uma falha temporária na IA. Tente novamente em instantes." Quando o que
 * quebrava era o Postgres, o Redis ou um bug nosso, o produto contava uma história
 * falsa sobre a IA e mandava a pessoa insistir — o que nunca ia funcionar. Custou horas
 * de caça a fantasma.
 *
 * Agora só afirmamos "problema temporário da IA" quando o erro REALMENTE é isso. Se não
 * for, dizemos que não é — e mostramos o que deu, porque insistir não vai resolver.
 */
export function humanizeGeminiError(error: unknown): string {
  if (isCreditsDepleted(error)) {
    return 'A conta do Gemini está SEM CRÉDITOS — o provedor recusa todas as chamadas (429). ' +
      'Isto não é instabilidade e não passa com o tempo: é preciso recarregar os créditos ' +
      'no Google AI Studio (https://ai.studio/projects). Nenhum design será gerado até lá.';
  }
  if (isRateLimited(error)) {
    return 'O provedor de IA atingiu um limite temporário. Tente novamente daqui a pouco.';
  }
  if (isOverloaded(error)) {
    return 'O modelo está com alta demanda agora. Tente novamente em alguns segundos.';
  }
  if (isTimeout(error) || isTransientNetwork(error)) {
    return 'A IA demorou demais para responder. Tente novamente em instantes.';
  }

  const detalhe = error instanceof Error && error.message ? `: ${error.message.slice(0, 200)}` : '';
  return `Falha na geração${detalhe}. Isto NÃO é uma instabilidade da IA — repetir tende a dar o mesmo erro.`;
}

/**
 * Núcleo de tentativa, compartilhado pelo streaming e pelo não-streaming: sem isto
 * a política de retry divergia entre os dois e o chat (que é stream) se comportava
 * diferente do resto sem ninguém perceber.
 *
 * As três causas de falha têm três tratamentos DIFERENTES — é esta separação que
 * protege a estética do deck:
 *
 * | Causa                    | Quem errou   | Resposta                                          |
 * |--------------------------|--------------|---------------------------------------------------|
 * | 429 / cota               | NÓS          | espera (obedecendo o retryDelay), insiste no MESMO |
 * |                          |              | modelo, e fecha a torneira (AIMD). Não toca no    |
 * |                          |              | breaker e NÃO troca de modelo.                    |
 * | 503 / lotado             | o provedor   | uma tentativa, cai para o irmão DO MESMO TIER,    |
 * |                          |              | alimenta o breaker.                               |
 * | timeout / modelo lento   | o modelo     | idem 503 (modelo lento não dá erro; sem isto nem  |
 * |                          |              | o retry nem o breaker entravam).                  |
 * | blip de rede             | ninguém      | 3 tentativas no mesmo modelo, com backoff.        |
 * | erro de prompt/chave     | nós, de vez  | estoura na hora, sem gastar em outro modelo.      |
 */
async function runWithFallback<T>(
  modelsToTry: string[],
  hooks: GeminiRetryHooks | undefined,
  executar: (model: string) => Promise<T>,
): Promise<T> {
  const ordenados = orderModels(modelsToTry);
  let lastError: unknown;

  /**
   * Uma tentativa, ocupando uma vaga na janela do modelo. A vaga é devolvida assim que
   * a chamada volta — inclusive quando volta com erro. Quem está de castigo esperando o
   * backoff NÃO pode continuar ocupando a janela: seria o limitador estrangulando a si
   * mesmo, com slots presos por chamadas que não estão fazendo nada.
   */
  const tentar = async (model: string): Promise<T> => {
    await acquireSlot(model);
    try {
      return await executar(model);
    } finally {
      releaseSlot(model);
    }
  };

  for (let modelIndex = 0; modelIndex < ordenados.length; modelIndex++) {
    const model = ordenados[modelIndex]!;
    const proximoModelo = ordenados[modelIndex + 1];
    let attempt = 0;
    let trocarDeModelo = false;

    while (!trocarDeModelo) {
      attempt++;
      let err: unknown;

      try {
        const resultado = await tentar(model);
        onSuccess(model);
        recordModelSuccess(model);
        return resultado;
      } catch (e) {
        err = e;
        lastError = e;
      }

      if (!isRetryable(err)) throw err;

      // ── Rate limit: nossa culpa, não do modelo. Desacelera e INSISTE. ────────────
      if (isRateLimited(err)) {
        onRateLimited(model); // fecha a torneira; NÃO alimenta o breaker

        const maxTentativas = Math.max(1, config.aiRateLimitRetries);
        if (attempt < maxTentativas) {
          // O provedor costuma dizer quanto esperar; se disse, obedeça.
          const pedido = extractRetryDelayMs(err);
          const teto = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), RATE_LIMIT_MAX_DELAY_MS);
          const delay = pedido !== undefined ? pedido + comJitter(1000) : BASE_DELAY_MS + comJitter(teto);

          logger.warn('Rate limit: esperando e insistindo no MESMO modelo (não degradar a arte)', {
            model,
            attempt,
            maxTentativas,
            delayMs: delay,
            retryDelayDoProvedor: pedido,
          });
          hooks?.onRetry?.({ model, attempt, delayMs: delay, reason: 'limite de uso do provedor' });
          await sleep(delay);
          continue;
        }

        // Esgotou a paciência: aí sim vira problema de disponibilidade e cai para o
        // irmão do tier — que é outro modelo com a MESMA mão, nunca um pior.
        logger.error('Rate limit persistente mesmo após esperar; caindo para o irmão do tier', {
          model,
          tentativas: attempt,
        });
        if (proximoModelo) {
          hooks?.onFallback?.({ fromModel: model, toModel: proximoModelo, reason: getErrorReason(err) });
        }
        break;
      }

      // ── Modelo lotado (503) ou lento (timeout): aí sim o problema é ELE. ─────────
      const estourouTempo = isTimeout(err);
      const reason = estourouTempo
        ? `O modelo passou de ${timeoutForModel(model) / 1000}s para responder`
        : getErrorReason(err);

      const desistirDoModelo = isOverloaded(err) || estourouTempo;
      if (desistirDoModelo) {
        recordModelFailure(model, reason);
        if (estourouTempo) logger.warn('Tentativa abortada por timeout', { model, reason });
      }

      const maxAttempts = desistirDoModelo ? MAX_OVERLOAD_ATTEMPTS : MAX_NETWORK_RETRIES;

      if (attempt < maxAttempts) {
        const delay = BASE_DELAY_MS + comJitter(BASE_DELAY_MS * Math.pow(2, attempt));
        hooks?.onRetry?.({ model, attempt, delayMs: delay, reason });
        await sleep(delay);
        continue;
      }

      if (proximoModelo) {
        hooks?.onFallback?.({ fromModel: model, toModel: proximoModelo, reason });
      }
      trocarDeModelo = true; // acabou a paciência com ESTE modelo; tenta o próximo DO TIER
    }
  }

  throw lastError;
}

/**
 * A lista de modelos a tentar — CONFINADA AO TIER do preferido.
 *
 * É aqui que a promessa "nunca misturar a mão" é cumprida: um deck que começou no pro
 * termina no pro ou não termina. Se o tier inteiro cair, quem chamou decide o que fazer
 * (o irDesign põe um placeholder on-brand, que é neutro; arte de outro modelo não é).
 */
function buildModelList(preferredModel?: string): string[] {
  const tier = preferredModel ? tierOf(preferredModel) : DEFAULT_TIER;
  const irmaos = MODEL_TIERS[tier] as readonly string[];

  if (!preferredModel) return [...irmaos];
  return [preferredModel, ...irmaos.filter((m) => m !== preferredModel)];
}

/**
 * Monta os parâmetros da tentativa com o abort por tempo. Um `abortSignal` que o
 * chamador já tenha passado é respeitado (ganha de nós); nesse caso não impomos o
 * nosso, para não cancelar por baixo de quem sabe o que está fazendo.
 */
function withTimeout(params: GenerateContentParams, model: string): GenerateContentParams {
  const config = params.config ?? {};
  if (config.abortSignal) return { ...params, model };

  return {
    ...params,
    model,
    config: { ...config, abortSignal: AbortSignal.timeout(timeoutForModel(model)) },
  };
}

/**
 * Chama ai.models.generateContent com retry, fallback dentro do tier e teto de gasto.
 */
function extractPromptText(params: GenerateContentParams): string | undefined {
  if (typeof params.contents === 'string') return params.contents;
  if (Array.isArray(params.contents)) {
    return params.contents.map(c => {
      if (typeof c === 'string') return c;
      if (typeof c === 'object' && c && 'role' in c) {
        if (Array.isArray(c.parts)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return c.parts.map((p: any) => p.text || '').join('');
        }
      }
      return '';
    }).join('\n');
  }
  return JSON.stringify(params.contents);
}

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

  // Sem preferredModel explícito, o params.model do chamador É a preferência.
  // Antes ele era simplesmente ignorado (o withTimeout sobrescreve o model):
  // ~10 chamadas pedindo flash-lite rodavam no tier "rápido" (3.5-flash, ~6x o
  // preço) sem ninguém pedir — item 3.3 da auditoria de 07-15.
  const preferido = preferredModel ?? params.model;
  const attemptedModels: string[] = [];
  const startTime = Date.now();
  const ctx = getAiContext();

  const customHooks: GeminiRetryHooks = {
    onFallback: (info) => {
      if (!attemptedModels.includes(info.fromModel)) attemptedModels.push(info.fromModel);
      if (!attemptedModels.includes(info.toModel)) attemptedModels.push(info.toModel);
      hooks?.onFallback?.(info);
    },
    onRetry: hooks?.onRetry,
  };

  return runWithFallback(buildModelList(preferido), customHooks, async (model) => {
    if (!attemptedModels.includes(model)) attemptedModels.push(model);

    let result;
    try {
      result = await ai.models.generateContent(withTimeout(params, model));
      await recordUsage(model, result.usageMetadata);
    } catch (err) {
      try {
          if (!ctx.runId) { ctx.runId = crypto.randomUUID(); await import('./generationTracing.js').then(m => m.openRun)({ id: ctx.runId, brandId: ctx.brandSlug || 'unknown', feature: ctx.feature || 'utility' }); }
          recordStep({
            runId: ctx.runId,
            kind: 'MODEL',
            role: Object.entries(config.models).find(([_, m]) => m === preferido)?.[0] || 'utility',
            model,
            tier: tierOf(model),
            attemptedModels,
            promptText: extractPromptText(params),
            error: err instanceof Error ? err.message : String(err),
            latencyMs: Date.now() - startTime,
          });
        } catch (_) { /* fail-open */ }
      throw err;
    }

    try {
      if (!ctx.runId) { ctx.runId = crypto.randomUUID(); await import('./generationTracing.js').then(m => m.openRun)({ id: ctx.runId, brandId: ctx.brandSlug || 'unknown', feature: ctx.feature || 'utility' }); }

      recordStep({
        runId: ctx.runId,
        kind: 'MODEL',
        role: Object.entries(config.models).find(([_, m]) => m === preferido)?.[0] || 'utility',
        model,
        tier: tierOf(model),
        attemptedModels,
        promptText: extractPromptText(params),
        responseText: result.text,
        inputTokens: result.usageMetadata?.promptTokenCount,
        outputTokens: result.usageMetadata?.candidatesTokenCount,
        latencyMs: Date.now() - startTime,
      });
    } catch (_) { /* fail-open */ }

    return result;
  });
}

type StreamResult = Awaited<ReturnType<InstanceType<typeof GoogleGenAI>['models']['generateContentStream']>>;

/**
 * O consumo de um stream só aparece no último chunk. Sem envolver o iterador, todo
 * o gasto do chat ficaria fora da conta — e o teto seria furado pelo caminho mais
 * usado do produto.
 */
async function* meterStream(
  stream: StreamResult,
  model: string,
  params: GenerateContentParams,
  attemptedModels: string[],
  startTime: number,
  preferido: string
): StreamResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ultimoUso: any;
  let fullResponse = '';

  for await (const chunk of stream) {
    if (chunk.usageMetadata) ultimoUso = chunk.usageMetadata;
    if (typeof chunk.text === 'function') fullResponse += chunk.text();
    yield chunk;
  }
  await recordUsage(model, ultimoUso as Parameters<typeof recordUsage>[1]);

  const ctx = getAiContext();
  try {
    if (!ctx.runId) { ctx.runId = crypto.randomUUID(); await import('./generationTracing.js').then(m => m.openRun)({ id: ctx.runId, brandId: ctx.brandSlug || 'unknown', feature: ctx.feature || 'utility' }); }
    recordStep({
      runId: ctx.runId,
      kind: 'MODEL',
      role: Object.entries(config.models).find(([_, m]) => m === preferido)?.[0] || 'utility',
      model,
      tier: tierOf(model),
      attemptedModels,
      promptText: extractPromptText(params),
      responseText: fullResponse,
      inputTokens: ultimoUso?.promptTokenCount,
      outputTokens: ultimoUso?.candidatesTokenCount,
      latencyMs: Date.now() - startTime,
    });
  } catch (_) { /* fail-open */ }
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

  const preferido = preferredModel ?? params.model;
  const attemptedModels: string[] = [];
  const startTime = Date.now();

  const customHooks: GeminiRetryHooks = {
    onFallback: (info) => {
      if (!attemptedModels.includes(info.fromModel)) attemptedModels.push(info.fromModel);
      if (!attemptedModels.includes(info.toModel)) attemptedModels.push(info.toModel);
      hooks?.onFallback?.(info);
    },
    onRetry: hooks?.onRetry,
  };

  // Mesma regra do generateWithRetry: params.model vale como preferência.
  return runWithFallback(buildModelList(preferido), customHooks, async (model) => {
    if (!attemptedModels.includes(model)) attemptedModels.push(model);
    const result = await ai.models.generateContentStream(withTimeout(params, model));
    return meterStream(result, model, params, attemptedModels, startTime, preferido);
  });
}
