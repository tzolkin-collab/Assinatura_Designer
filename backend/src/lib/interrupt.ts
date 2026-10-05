// Interrupção COOPERATIVA da geração ("Pausar e enviar").
//
// O `generation:cancel` que já existia derruba o pipeline no susto: zera o
// workerStatus e o próximo checkCancelled() lança, o post vira FAILED e o run
// FAILED — os slides até ali sobrevivem na tabela, mas o deck é dado como falho.
// Aqui o pedido é uma FLAG no Redis (com TTL) que o pipeline consulta nos limites de
// lote e de etapa; ao vê-la ele PARA de forma limpa, preserva o que já gerou,
// fecha o run e AVISA que parou, regravando a flag como `stopped` com onde parou.
// Quem pediu (o handler `message:interrupt`) fica de olho nessa transição para só
// então abrir o turno da mensagem do usuário — já sabendo em que ponto a geração
// ficou.
//
// Vive na sessão, não no job do BullMQ: o worker pode ser outro processo, e o job
// não tem canal para receber sinal no meio da execução.

import type { AdviceItem } from './advice.js';

export interface InterruptState {
  /** requested: pedido feito, pipeline ainda não parou. stopped: parou. */
  state: 'requested' | 'stopped';
  requestedAt: number;
  /** Só em stopped: onde parou ("antes do lote 4 de 10", "antes do revisor"...). */
  stage?: string;
  slidesKept?: number;
  total?: number;
}

export interface InterruptStore {
  /** Cria o pedido. Um pedido já existente (requested OU stopped) NÃO é reescrito. */
  request(sessionId: string, now: number): Promise<void>;
  get(sessionId: string): Promise<InterruptState | null>;
  /** requested → stopped, só se o pedido ainda existir (não ressuscita flag apagada). */
  markStopped(sessionId: string, info: { stage: string; slidesKept: number; total: number }): Promise<void>;
  clear(sessionId: string): Promise<void>;
}

export const INTERRUPT_TTL_SECONDS = 5 * 60;

let store: InterruptStore | null = null;

export function setInterruptStore(next: InterruptStore | null): void {
  store = next;
}

async function getStore(): Promise<InterruptStore> {
  if (store) return store;
  const { redisInterruptStore } = await import('./interruptRedisStore.js');
  store = redisInterruptStore;
  return store;
}

export async function requestInterrupt(sessionId: string): Promise<void> {
  await (await getStore()).request(sessionId, Date.now());
}

/**
 * Há pedido de interrupção ainda não atendido? FAIL-OPEN: se o Redis falhar, a
 * geração continua — parar uma geração cara por causa de um recurso auxiliar seria
 * o erro pior, e o usuário ainda tem o botão de parar.
 */
export async function isInterruptRequested(sessionId: string): Promise<boolean> {
  try {
    return (await (await getStore()).get(sessionId))?.state === 'requested';
  } catch {
    return false;
  }
}

export async function getInterruptState(sessionId: string): Promise<InterruptState | null> {
  try {
    return await (await getStore()).get(sessionId);
  } catch {
    return null;
  }
}

export async function markInterruptStopped(
  sessionId: string,
  info: { stage: string; slidesKept: number; total: number },
): Promise<void> {
  try {
    await (await getStore()).markStopped(sessionId, info);
  } catch {
    // O handler tem timeout e também olha o workerStatus; não vale derrubar o fim
    // da geração por não conseguir gravar este aviso.
  }
}

export async function clearInterrupt(sessionId: string): Promise<void> {
  try {
    await (await getStore()).clear(sessionId);
  } catch {
    // TTL de 5 min limpa sozinho.
  }
}

// ── Texto para o modelo ───────────────────────────────────────────────────────

export interface InterruptionContext {
  /** O pipeline parou (ou terminava) por causa do pedido; `stage` ausente = terminava. */
  pipeline?: { stage?: string; slidesKept?: number; total?: number };
  /** Um stream do cérebro foi abortado no meio. */
  chatAborted?: boolean;
  /** Orientações pendentes que iriam para a IA e viajam junto com a mensagem. */
  pendingAdvice?: AdviceItem[];
}

/**
 * O que a IA precisa saber para tratar a mensagem seguinte como turno normal — e
 * não repetir [DISPATCH] por reflexo, o que refaria o deck que o usuário acabou de
 * preservar. `undefined` quando nada foi interrompido nem havia orientação.
 */
export function buildInterruptionNote(ctx: InterruptionContext): string | undefined {
  const partes: string[] = [];

  if (ctx.pipeline) {
    const { stage, slidesKept, total } = ctx.pipeline;
    if (stage) {
      const prontos = slidesKept !== undefined && total
        ? ` ${slidesKept} de ${total} slides já estavam prontos e foram MANTIDOS no deck.`
        : '';
      partes.push(`Você estava gerando o deck e o usuário interrompeu a geração ${stage}.${prontos}`);
    } else {
      partes.push('Você estava gerando o deck e o usuário pediu para interromper, mas a geração já estava terminando.');
    }
    partes.push('A mensagem abaixo é o novo pedido dele (ajustar o que existe, continuar de onde parou ou refazer). Só emita [DISPATCH] se ele pedir para gerar de novo.');
  }

  if (ctx.chatAborted) {
    partes.push('O usuário interrompeu a sua resposta anterior no meio; o texto parcial acima é só o que chegou a ser mostrado. Ignore qualquer tag de ação (DISPATCH, EDIT, QUESTION) que ela pudesse ter e trate a mensagem abaixo como o novo pedido.');
  }

  if (ctx.pendingAdvice && ctx.pendingAdvice.length > 0) {
    partes.push(`Orientações que ele já tinha deixado e não chegaram a ser aplicadas (leve-as em conta):\n${ctx.pendingAdvice.map((a) => `- ${a.text}`).join('\n')}`);
  }

  return partes.length > 0 ? partes.join('\n') : undefined;
}
