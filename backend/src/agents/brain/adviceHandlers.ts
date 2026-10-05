// Handlers WebSocket das orientações em tempo real e do "Pausar e enviar".
//
// Separados do index.ts do cérebro (já com 1200+ linhas) e sem importá-lo: o único
// ponto em que precisam abrir um turno do cérebro chega por injeção (`deps`), o que
// evita o ciclo index → handlers → index e deixa tudo testável sem carregar o Gemini.

import { onWsMessage, ws } from '../../lib/websocket.js';
import { getSessionMeta, type SessionMeta } from '../../lib/redis.js';
import {
  submitAdvice,
  editAdvice,
  removePendingAdvice,
  dismissAdvice,
  consumePendingAdvice,
  expirePendingAdvice,
  ADVICE_SCOPE_CHAT,
  type AdviceItem,
} from '../../lib/advice.js';
import {
  requestInterrupt,
  getInterruptState,
  clearInterrupt,
  buildInterruptionNote,
  type InterruptState,
} from '../../lib/interrupt.js';
import { abortBrainTurns, hasActiveBrainTurn } from './turnRegistry.js';
import { logger } from '../../lib/logger.js';

export interface AdviceHandlerDeps {
  /** Abre um turno normal do cérebro. `attachments` chega cru (o cérebro normaliza). */
  sendUserMessage: (
    sessionId: string,
    userId: string | undefined,
    content: string,
    attachments: unknown,
    opts?: { interruptionNote?: string },
  ) => Promise<void>;
}

// Quanto esperar o pipeline chegar a um limite de lote depois do pedido. O lote em
// andamento não é abortado (cooperativo), então o pior caso é uma chamada de IA
// inteira, com retries. Passou disso, a mensagem segue mesmo assim — a flag continua
// valendo e o pipeline ainda vai parar no próximo limite.
export const PIPELINE_STOP_TIMEOUT_MS = 180_000;
const POLL_MS = 400;
/** O pipeline muda o workerStatus e SÓ DEPOIS grava `stopped`; esta folga cobre o intervalo. */
const STOPPED_GRACE_POLLS = 8;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Sessão do usuário? Sem `userId` (ou sessão sem dono) não bloqueia, como no resto do brain. */
function isOwner(meta: SessionMeta, userId: string | undefined): boolean {
  return !(userId && meta.userId && meta.userId !== userId);
}

/**
 * "A IA está ocupada?" = há turno do cérebro em andamento (memória deste processo) OU o
 * pipeline está rodando (workerStatus da sessão, que o worker mantém no Redis).
 */
export async function isSessionBusy(sessionId: string): Promise<boolean> {
  if (hasActiveBrainTurn(sessionId)) return true;
  const meta = await getSessionMeta(sessionId);
  return meta?.workerStatus === 'running';
}

/**
 * Chamada por quem termina um turno do cérebro, DEPOIS de tirá-lo do registro. Se um
 * pipeline foi despachado (workerStatus running), as pendentes seguem para ele — é o
 * pipeline quem as consome ou devolve. Caso contrário devolve ao autor.
 */
export async function settleAdviceAfterBrainTurn(sessionId: string): Promise<void> {
  if (hasActiveBrainTurn(sessionId)) return; // outro turno da mesma sessão ainda consome
  const meta = await getSessionMeta(sessionId).catch(() => null);
  if (meta?.workerStatus === 'running') return;
  await expirePendingAdvice(sessionId, 'ended');
}

/**
 * Espera o pipeline parar depois de `requestInterrupt`. Devolve o estado `stopped`
 * (com onde parou), ou `null` se ele terminou por conta própria antes de ver o pedido
 * ou o tempo esgotou.
 */
export async function waitForPipelineStop(
  sessionId: string,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<InterruptState | null> {
  const timeoutMs = opts.timeoutMs ?? PIPELINE_STOP_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? POLL_MS;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const st = await getInterruptState(sessionId);
    if (st?.state === 'stopped') return st;

    const meta = await getSessionMeta(sessionId);
    if (!meta || meta.workerStatus !== 'running') {
      // Já não está rodando: ou parou (o `stopped` ainda vai ser gravado) ou terminou
      // sozinho. Dá uma folga curta antes de concluir que foi o segundo caso.
      for (let i = 0; i < STOPPED_GRACE_POLLS; i++) {
        await sleep(pollMs);
        const again = await getInterruptState(sessionId);
        if (again?.state === 'stopped') return again;
      }
      return null;
    }

    if (Date.now() >= deadline) return null;
    await sleep(pollMs);
  }
}

/**
 * "Pausar e enviar": interrompe o que a IA estiver fazendo e abre a mensagem do
 * usuário como turno normal, com o contexto de o que foi interrompido e onde.
 */
export async function handleInterruptMessage(
  deps: AdviceHandlerDeps,
  sessionId: string,
  userId: string | undefined,
  data: unknown,
  timing?: { timeoutMs?: number; pollMs?: number },
): Promise<void> {
  const { content, attachments } = (data ?? {}) as { content?: unknown; attachments?: unknown };
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text) return;

  const meta = await getSessionMeta(sessionId);
  if (!meta) {
    ws.error(sessionId, 'Sessão expirou ou não foi encontrada. Recarregue a página.');
    return;
  }
  if (!isOwner(meta, userId)) return;

  // 1. Cérebro: aborta o stream e ESPERA o turno persistir o texto parcial — a
  //    mensagem nova só entra depois, para o histórico ficar na ordem certa.
  const abortedTurns = await abortBrainTurns(sessionId);

  // 2. Pipeline: pede parada cooperativa e espera o limite de lote. Lê o estado de
  //    novo: o abort acima pode ter deixado o cérebro despachar/terminar nesse meio-tempo.
  let stopped: InterruptState | null = null;
  let pipelineWasRunning = false;
  const atual = await getSessionMeta(sessionId);
  if (atual?.workerStatus === 'running') {
    pipelineWasRunning = true;
    await requestInterrupt(sessionId);
    stopped = await waitForPipelineStop(sessionId, timing);
  }
  await clearInterrupt(sessionId);

  // 3. O que o usuário deixou pendente vai junto com a mensagem, em vez de voltar ao
  //    campo de quem acabou de enviar outra coisa por cima. Passa pelo mesmo caminho
  //    atômico da drenagem: se o pipeline ainda drenou alguma no último instante,
  //    ela não vem duas vezes.
  const folded: AdviceItem[] = await consumePendingAdvice(sessionId, {
    stage: 'enviada com a sua mensagem',
    scope: ADVICE_SCOPE_CHAT,
  });

  // Sem `stopped`: ou a geração terminou sozinha antes de ver o pedido, ou o tempo
  // esgotou e ela ainda está no lote em curso. O modelo precisa saber qual dos dois.
  const aindaRodando = pipelineWasRunning && !stopped
    && (await getSessionMeta(sessionId))?.workerStatus === 'running';

  const note = buildInterruptionNote({
    pipeline: pipelineWasRunning
      ? stopped
        ? { stage: stopped.stage, slidesKept: stopped.slidesKept, total: stopped.total }
        : aindaRodando
          ? { stage: 'agora (o lote em andamento ainda vai terminar e então a geração para; os slides prontos ficam no deck)' }
          : {}
      : undefined,
    chatAborted: abortedTurns > 0,
    pendingAdvice: folded,
  });

  logger.info('Pausar e enviar', {
    sessionId, abortedTurns, pipelineWasRunning, pipelineStopped: stopped !== null, foldedAdvice: folded.length,
  });

  await deps.sendUserMessage(sessionId, userId, text, attachments, { interruptionNote: note });
}

/**
 * Recusa devolvida ao cliente: ele já mostrou a orientação como pendente, e o texto
 * não pode simplesmente sumir — o evento é o mesmo do fim de geração, então o campo
 * de mensagem de quem enviou recebe o texto de volta pelo caminho de sempre.
 */
function rejectAdvice(
  sessionId: string,
  raw: { id?: unknown; text?: unknown; origin?: string },
  reason: string,
): void {
  if (typeof raw.id !== 'string' || typeof raw.text !== 'string') return;
  const item: AdviceItem = {
    id: raw.id, text: raw.text, createdAt: Date.now(), status: 'expired',
    expiredAt: Date.now(), expireReason: reason, origin: raw.origin,
  };
  ws.emit(sessionId, 'advice.expired', { item });
}

export function initAdviceHandlers(deps: AdviceHandlerDeps): void {
  const authorized = async (sessionId: string, userId: string | undefined): Promise<boolean> => {
    const meta = await getSessionMeta(sessionId);
    return !!meta && isOwner(meta, userId);
  };

  onWsMessage('advice:send', async (sessionId, userId, data) => {
    const { id, text, clientId } = (data ?? {}) as { id?: unknown; text?: unknown; clientId?: unknown };
    const origin = typeof clientId === 'string' ? clientId.slice(0, 64) : undefined;

    const meta = await getSessionMeta(sessionId);
    if (!meta) return rejectAdvice(sessionId, { id, text, origin }, 'no-session');
    if (!isOwner(meta, userId)) return;

    const result = await submitAdvice({
      sessionId, id, text, origin, isBusy: () => isSessionBusy(sessionId),
    });

    // 'idle' já foi respondido por submitAdvice (advice.expired).
    if (!result.ok && result.reason !== 'idle') rejectAdvice(sessionId, { id, text, origin }, result.reason);
  });

  onWsMessage('advice:update', async (sessionId, userId, data) => {
    const { id, text } = (data ?? {}) as { id?: unknown; text?: unknown };
    if (!(await authorized(sessionId, userId))) return;
    await editAdvice(sessionId, id, text);
  });

  onWsMessage('advice:remove', async (sessionId, userId, data) => {
    const { id } = (data ?? {}) as { id?: unknown };
    if (!(await authorized(sessionId, userId))) return;
    await removePendingAdvice(sessionId, id);
  });

  onWsMessage('advice:dismiss', async (sessionId, userId, data) => {
    const { ids } = (data ?? {}) as { ids?: unknown };
    if (!(await authorized(sessionId, userId))) return;
    await dismissAdvice(sessionId, ids);
  });

  onWsMessage('message:interrupt', async (sessionId, userId, data) => {
    await handleInterruptMessage(deps, sessionId, userId, data);
  });
}
