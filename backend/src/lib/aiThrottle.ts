import { logger } from './logger.js';
import { config } from '../config.js';

/**
 * Controle de congestão para a cota do Gemini — o mesmo princípio do TCP (AIMD).
 *
 * O problema que isto resolve: a concorrência era um número fixo no config
 * (`pipelineConcurrency × generationConcurrency` ≈ 8 chamadas simultâneas) e ninguém
 * sabia se cabia na cota. Quando não cabia, o 429 chegava, o código concluía que o
 * MODELO estava ruim e trocava por um pior — o deck saía com duas mãos diferentes.
 *
 * Mas o 429 não diz "esse modelo é ruim", diz "você está indo rápido demais". A
 * resposta certa a isso é ir mais devagar, não contratar um designer pior.
 *
 * Então a janela de chamadas simultâneas é ADAPTATIVA:
 * - 429 → corte multiplicativo (metade). Reage rápido, que é o que evita a próxima rajada.
 * - sequência de sucessos → aumento aditivo (+1). Volta devagar, tateando o teto real.
 *
 * Assim o sistema DESCOBRE o limite da cota em vez de eu chutar um número no .env.
 *
 * Por que in-process e não no Redis: AIMD tem a propriedade que faz o TCP funcionar —
 * fluxos independentes que dividem o mesmo gargalo convergem para a divisão justa só
 * de reagirem ao mesmo sinal de congestão. Dois workers não precisam se falar: os dois
 * levam 429, os dois cortam, os dois convergem. Coordenar via Redis custaria um RTT
 * (~130ms, remoto) por chamada e traria lease/expiração/recuperação de crash de brinde.
 *
 * A janela é por MODELO porque a cota do Gemini é por modelo: um 429 no pro não é
 * motivo para segurar as chamadas do flash-lite.
 */

/** Nunca chega a zero: uma janela de 1 ainda progride, só que em fila. */
const MIN_LIMIT = 1;

/** Quantos sucessos seguidos antes de arriscar +1 na janela. */
const INCREASE_AFTER_SUCCESSES = 5;

/**
 * Uma rajada de 8 chamadas paralelas leva 8 x 429 quase no mesmo instante. Sem esta
 * carência, os 8 cortes pela metade levariam a janela de 8 a 1 de uma vez — o sistema
 * entraria em pânico por um único evento de congestão. Como no TCP, vale UM corte por
 * "rodada": os 429 que chegarem logo depois do corte são o eco do mesmo problema.
 */
const DECREASE_COOLDOWN_MS = 3000;

interface Janela {
  /** Chamadas simultâneas permitidas AGORA (é isto que o AIMD move). */
  limit: number;
  inFlight: number;
  /** Quem está esperando vaga. O slot já vem reservado por quem acorda o waiter. */
  fila: Array<() => void>;
  sucessosSeguidos: number;
  ultimaReducao: number;
}

const janelas = new Map<string, Janela>();

/**
 * Teto inicial = o que o config já pedia. A diferença é que agora ele é um PONTO DE
 * PARTIDA e um teto, não uma promessa: se a cota não aguentar, o AIMD desce sozinho.
 */
function limiteMaximo(): number {
  return Math.max(1, config.aiMaxInflightPerModel);
}

function janela(model: string): Janela {
  let j = janelas.get(model);
  if (!j) {
    j = { limit: limiteMaximo(), inFlight: 0, fila: [], sucessosSeguidos: 0, ultimaReducao: 0 };
    janelas.set(model, j);
  }
  return j;
}

/**
 * Acorda quem couber na janela. Quem libera JÁ INCREMENTA o `inFlight` do waiter: se o
 * próprio waiter incrementasse ao acordar, duas liberações no mesmo tick veriam o mesmo
 * `inFlight` desatualizado e estourariam a janela.
 */
function liberarFila(j: Janela): void {
  while (j.inFlight < j.limit && j.fila.length > 0) {
    const proximo = j.fila.shift()!;
    j.inFlight++;
    proximo();
  }
}

/** Espera uma vaga na janela do modelo. */
export async function acquireSlot(model: string): Promise<void> {
  const j = janela(model);
  if (j.inFlight < j.limit) {
    j.inFlight++;
    return;
  }
  await new Promise<void>((resolve) => j.fila.push(resolve));
}

export function releaseSlot(model: string): void {
  const j = janela(model);
  j.inFlight = Math.max(0, j.inFlight - 1);
  liberarFila(j);
}

/**
 * "Você está indo rápido demais": corte multiplicativo.
 *
 * Repare no que este método NÃO faz: não marca o modelo como ruim, não alimenta o
 * circuit breaker, não troca de modelo. Rate limit é propriedade da NOSSA cota, não
 * do modelo — o modelo está ótimo, quem exagerou fomos nós.
 */
export function onRateLimited(model: string): void {
  const j = janela(model);
  const agora = Date.now();

  if (agora - j.ultimaReducao < DECREASE_COOLDOWN_MS) return; // eco do mesmo congestionamento

  const anterior = j.limit;
  j.limit = Math.max(MIN_LIMIT, Math.floor(j.limit / 2));
  j.ultimaReducao = agora;
  j.sucessosSeguidos = 0;

  if (j.limit !== anterior) {
    logger.warn('Cota apertou: fechando a torneira de chamadas simultâneas', {
      model,
      de: anterior,
      para: j.limit,
      inFlight: j.inFlight,
    });
  }
}

/** Sucesso: aumento aditivo, e só depois de uma sequência — subir é para tatear, não para correr. */
export function onSuccess(model: string): void {
  const j = janela(model);
  j.sucessosSeguidos++;

  if (j.limit >= limiteMaximo()) return;
  if (j.sucessosSeguidos < INCREASE_AFTER_SUCCESSES) return;
  if (Date.now() - j.ultimaReducao < DECREASE_COOLDOWN_MS) return; // ainda é cedo para provocar

  j.limit++;
  j.sucessosSeguidos = 0;
  logger.debug('Cota respirando: abrindo a torneira', { model, limit: j.limit });
  liberarFila(j);
}

/** Só para os testes e para o log de diagnóstico. */
export function throttleState(model: string): { limit: number; inFlight: number; esperando: number } {
  const j = janela(model);
  return { limit: j.limit, inFlight: j.inFlight, esperando: j.fila.length };
}

export function resetThrottle(): void {
  janelas.clear();
}
