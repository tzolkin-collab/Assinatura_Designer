// Orientações em tempo real ("aconselhar" a IA enquanto ela trabalha) — substitui o
// /btw. Este módulo só tem lógica PURA (reducer dos eventos WS + decisão do que a
// tecla Enter faz), para ser testável sem montar o hook nem o WebSocket. O estado em
// si (a lista, a conexão) vive em useFabricaWs.ts — este arquivo só decide, não guarda.
//
// Espelha os tipos de backend/src/lib/advice.ts; se os dois divergirem, o evento que o
// servidor manda deixa de bater com o que o reducer espera.

import type { WorkerStatus } from './fabricaSession';

export type AdviceStatus = 'pending' | 'applied' | 'expired';

export interface AdviceItem {
  id: string;
  text: string;
  createdAt: number;
  status: AdviceStatus;
  updatedAt?: number;
  appliedAt?: number;
  /** Etapa em que foi aplicada, legível: "lote 3 de 10", "revisor", "resposta do chat". */
  stage?: string;
  expiredAt?: number;
  expireReason?: string;
  /** Id da aba que enviou — só ela recebe o texto de volta quando expira. */
  origin?: string;
}

export type AdviceEventType =
  | 'advice.queued'
  | 'advice.applied'
  | 'advice.updated'
  | 'advice.removed'
  | 'advice.expired';

export interface AdviceEventPayload {
  item?: AdviceItem | null;
  id?: string;
}

/**
 * Reducer puro dos eventos advice.* (ver backend/src/lib/advice.ts para o que cada um
 * significa). 'expirada' e 'removida' saem da lista — a expirada some daqui porque o
 * texto dela volta para o campo de digitação (ver `useFabricaWs`), não porque foi
 * descartada.
 */
export function applyAdviceEvent(
  list: AdviceItem[],
  type: AdviceEventType,
  payload: AdviceEventPayload,
): AdviceItem[] {
  switch (type) {
    case 'advice.queued':
    case 'advice.applied':
    case 'advice.updated': {
      const item = payload.item;
      if (!item) return list;
      const exists = list.some((i) => i.id === item.id);
      return exists ? list.map((i) => (i.id === item.id ? item : i)) : [...list, item];
    }
    case 'advice.removed':
    case 'advice.expired': {
      const id = payload.id ?? payload.item?.id;
      if (!id) return list;
      return list.filter((i) => i.id !== id);
    }
    default:
      return list;
  }
}

/**
 * Reidrata a lista inteira (vinda de `session:state` no reconnect). Diferente do
 * reducer acima: aqui é substituição total, não uma transição incremental — é o que
 * garante que orientações resolvidas enquanto a aba estava fechada/reconectando não
 * fiquem presas em "pendente" para sempre.
 */
export function hydrateAdviceList(server: unknown): AdviceItem[] {
  if (!Array.isArray(server)) return [];
  return server.filter(
    (i): i is AdviceItem => !!i && typeof i === 'object' && typeof (i as AdviceItem).id === 'string',
  );
}

/**
 * "A IA está ocupada?" — mesmo critério do backend (agents/brain/adviceHandlers.ts
 * `isSessionBusy`): turno do cérebro em andamento (streaming) OU pipeline rodando.
 * É o portão único de todo o modo "ocupado" no cliente: input vira orientação,
 * "Pausar e enviar" aparece, etc.
 */
export function isSessionBusy(isStreaming: boolean, workerStatus: WorkerStatus): boolean {
  return isStreaming || workerStatus === 'running';
}

export type EnterAction = 'slash' | 'newline' | 'advice' | 'interrupt' | 'message' | 'noop';

/**
 * O que a tecla Enter faz no campo de mensagem, dado o estado atual. Extraído do
 * handler de teclado para poder testar a combinatória (ocupado × Ctrl × Shift ×
 * menu de slash aberto) sem montar o componente inteiro.
 *
 * Prioridade: menu de slash aberto > Shift (nova linha, deixa o navegador cuidar) >
 * sem texto (nada a fazer) > ocupado (Ctrl = interromper e enviar agora, senão vira
 * orientação) > mensagem normal.
 */
export function decideEnterAction(opts: {
  shiftKey: boolean;
  ctrlKey: boolean;
  slashOpen: boolean;
  busy: boolean;
  hasText: boolean;
}): EnterAction {
  if (opts.slashOpen) return 'slash';
  if (opts.shiftKey) return 'newline';
  if (!opts.hasText) return 'noop';
  if (opts.busy) return opts.ctrlKey ? 'interrupt' : 'advice';
  return 'message';
}

/** Rótulo pt-BR do status, para o badge da lista "Orientações". */
export function adviceStatusLabel(item: AdviceItem): string {
  if (item.status === 'pending') return 'pendente';
  if (item.status === 'applied') return item.stage ? `aplicada — ${item.stage}` : 'aplicada';
  return 'expirada';
}
