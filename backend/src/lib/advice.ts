// Orientações em tempo real ("aconselhar" a IA enquanto ela trabalha).
//
// Antes existia o /btw: um estado local do navegador que só era anexado à PRÓXIMA
// mensagem — ou seja, nunca chegava ao modelo enquanto ele trabalhava, que era o
// único motivo de existir. Agora a orientação vai ao servidor na hora, fica numa
// lista da sessão e é CONSUMIDA em pontos seguros:
//   - cérebro: ao iniciar cada turno do modelo (agents/brain/index.ts);
//   - pipeline: no início de cada lote de slides e antes do revisor (agents/pipeline.ts).
//
// Transporte: WebSocket (advice:send / advice:update / advice:remove / advice:dismiss),
// e não REST. É o padrão de tudo que acontece DENTRO de uma sessão viva (message,
// question:answer, review:*, generation:cancel) e já traz sessionId + userId
// autenticados da conexão; REST exigiria repetir a checagem de dono e não teria o
// canal de volta para os eventos advice.* — que o cliente precisa receber de qualquer
// forma, inclusive os disparados pelo worker.
//
// Este módulo só conhece uma PORTA de persistência (AdviceStore). O adaptador real é
// Redis+Lua (adviceRedisStore.ts); os testes usam um em memória com a mesma
// semântica. Assim o pipeline não se acopla ao Redis (pedido do desenho original) e
// as corridas — o coração desta feature — são testáveis sem infraestrutura.

import { ws } from './websocket.js';
import { logger } from './logger.js';

export { adviceLines, brainAdviceBlock, pipelineAdviceBlock } from './adviceText.js';

export type AdviceStatus = 'pending' | 'applied' | 'expired';

export interface AdviceItem {
  id: string;
  text: string;
  createdAt: number;
  status: AdviceStatus;
  /** Última edição do texto (só possível enquanto pendente). */
  updatedAt?: number;
  appliedAt?: number;
  expiredAt?: number;
  /** Etapa em que foi aplicada, legível: "lote 3 de 10", "revisor", "resposta do chat". */
  stage?: string;
  /**
   * Onde foi aplicada: 'chat' (cérebro) ou o postId do deck (pipeline). Serve para
   * o retry do job e a retomada pós-Amostra de Estilo recarregarem o que já valia
   * para AQUELE deck sem misturar com orientação de outro.
   */
  scope?: string;
  /** Id do cliente (aba) que enviou. Só ele recebe o texto de volta no campo. */
  origin?: string;
  /** Por que expirou: 'ended' (a IA terminou), 'idle' (já não estava ocupada), 'failed'. */
  expireReason?: string;
}

export type AddResult = 'ok' | 'exists' | 'no-session' | 'full';
export interface MutateResult {
  result: 'ok' | 'not-found' | 'not-pending';
  item?: AdviceItem;
}

/**
 * Porta de persistência. TODA transição de estado é atômica dentro do store: é aí
 * que "drenar" e "marcar aplicada" viram uma operação só — sem janela entre uma e
 * outra, duas drenagens concorrentes (lotes paralelos) nunca levam o mesmo item, e
 * uma edição/remoção concorrente com a drenagem tem exatamente um vencedor.
 */
export interface AdviceStore {
  add(sessionId: string, item: AdviceItem): Promise<AddResult>;
  update(sessionId: string, id: string, text: string, now: number): Promise<MutateResult>;
  remove(sessionId: string, id: string): Promise<MutateResult>;
  /** pending → applied|expired, todos de uma vez; devolve o que MUDOU (em ordem de envio). */
  settle(
    sessionId: string,
    to: 'applied' | 'expired',
    opts: { now: number; stage?: string; scope?: string; reason?: string },
  ): Promise<AdviceItem[]>;
  /** Apaga itens JÁ resolvidos (nunca pendentes) pelos ids; devolve os apagados. */
  dismiss(sessionId: string, ids: string[]): Promise<string[]>;
  /**
   * Apaga itens resolvidos em massa. `expired` sempre cai; `applied` cai a menos que
   * o escopo esteja em `keepScopes` (o que ainda vale para o deck em andamento).
   * Pendentes nunca são tocados.
   */
  prune(sessionId: string, opts: { keepScopes: string[] }): Promise<string[]>;
  list(sessionId: string): Promise<AdviceItem[]>;
}

export const ADVICE_MAX_TEXT = 2000;
export const ADVICE_MAX_ITEMS = 50;
/** Escopo das orientações consumidas pelo cérebro. */
export const ADVICE_SCOPE_CHAT = 'chat';

let store: AdviceStore | null = null;

export function setAdviceStore(next: AdviceStore | null): void {
  store = next;
}

async function getStore(): Promise<AdviceStore> {
  if (store) return store;
  // Import tardio: o adaptador puxa o cliente Redis, que não precisa existir só
  // para quem testa a lógica com um store em memória.
  const { redisAdviceStore } = await import('./adviceRedisStore.js');
  store = redisAdviceStore;
  return store;
}

/** Id de item vindo do cliente: curto, sem caracteres que virem chave estranha. */
export function isValidAdviceId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);
}

export function normalizeAdviceText(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const clean = text.trim();
  if (!clean) return null;
  return clean.slice(0, ADVICE_MAX_TEXT);
}

// ── Operações do usuário (vindas do WebSocket) ────────────────────────────────

export type SubmitAdviceResult =
  | { ok: true; item: AdviceItem; duplicate?: boolean }
  | { ok: false; reason: 'invalid' | 'no-session' | 'full' | 'idle' };

/**
 * Registra uma orientação. `isBusy` é consultada DUAS vezes:
 *  1. antes de gravar — se a IA já não está ocupada, uma orientação não teria quem a
 *     consumisse; devolvemos o texto ao remetente (evento advice.expired) em vez de
 *     guardar algo que ficaria pendente para sempre;
 *  2. depois de gravar — fecha a corrida "a IA terminou entre a checagem e a
 *     gravação". Quem encerra o trabalho MUDA o estado e só depois varre as
 *     pendentes (ver settleAdviceWhenIdle); se a nossa gravação caiu depois da
 *     varredura, então o estado já tinha mudado antes dela — e esta segunda checagem
 *     enxerga isso e expira o item. Uma das duas pontas sempre pega.
 */
export async function submitAdvice(params: {
  sessionId: string;
  id: unknown;
  text: unknown;
  origin?: string;
  isBusy: () => Promise<boolean>;
}): Promise<SubmitAdviceResult> {
  const { sessionId, origin, isBusy } = params;
  const text = normalizeAdviceText(params.text);
  if (!text || !isValidAdviceId(params.id)) return { ok: false, reason: 'invalid' };

  const item: AdviceItem = { id: params.id, text, createdAt: Date.now(), status: 'pending', origin };

  if (!(await isBusy())) {
    ws.emit(sessionId, 'advice.expired', {
      item: { ...item, status: 'expired', expiredAt: Date.now(), expireReason: 'idle' },
    });
    return { ok: false, reason: 'idle' };
  }

  const s = await getStore();
  const added = await s.add(sessionId, item);
  if (added === 'no-session') return { ok: false, reason: 'no-session' };
  if (added === 'full') return { ok: false, reason: 'full' };
  // Reenvio (reconexão): o item já está lá. Idempotente, sem evento duplicado.
  if (added === 'exists') return { ok: true, item, duplicate: true };

  ws.emit(sessionId, 'advice.queued', { item });

  if (!(await isBusy())) await expirePendingAdvice(sessionId, 'idle');
  return { ok: true, item };
}

export async function editAdvice(sessionId: string, id: unknown, text: unknown): Promise<void> {
  const clean = normalizeAdviceText(text);
  if (!clean || !isValidAdviceId(id)) return;
  const r = await (await getStore()).update(sessionId, id, clean, Date.now());
  reconcile(sessionId, id, r, 'advice.updated');
}

export async function removePendingAdvice(sessionId: string, id: unknown): Promise<void> {
  if (!isValidAdviceId(id)) return;
  const r = await (await getStore()).remove(sessionId, id);
  reconcile(sessionId, id, r, 'advice.removed');
}

/**
 * Devolve ao cliente a verdade do servidor quando a ação dele perdeu a corrida:
 * ele editou/removeu algo que já tinha sido aplicado ou nem existe mais.
 */
function reconcile(sessionId: string, id: string, r: MutateResult, okEvent: 'advice.updated' | 'advice.removed'): void {
  if (r.result === 'ok') {
    if (okEvent === 'advice.updated') ws.emit(sessionId, 'advice.updated', { item: r.item });
    else ws.emit(sessionId, 'advice.removed', { id });
    return;
  }
  if (r.result === 'not-pending' && r.item) {
    ws.emit(sessionId, 'advice.updated', { item: r.item });
    return;
  }
  ws.emit(sessionId, 'advice.removed', { id });
}

export async function dismissAdvice(sessionId: string, ids: unknown): Promise<void> {
  if (!Array.isArray(ids)) return;
  const valid = ids.filter(isValidAdviceId).slice(0, ADVICE_MAX_ITEMS);
  if (valid.length === 0) return;
  const removed = await (await getStore()).dismiss(sessionId, valid);
  for (const id of removed) ws.emit(sessionId, 'advice.removed', { id });
}

export async function pruneAdvice(
  sessionId: string,
  opts: { keepScopes: string[] },
): Promise<void> {
  try {
    const removed = await (await getStore()).prune(sessionId, opts);
    for (const id of removed) ws.emit(sessionId, 'advice.removed', { id });
  } catch (err) {
    logger.warn('Falha ao limpar orientações resolvidas (fail-open)', {
      sessionId, error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function listAdvice(sessionId: string): Promise<AdviceItem[]> {
  try {
    return await (await getStore()).list(sessionId);
  } catch (err) {
    logger.warn('Falha ao listar orientações (fail-open)', {
      sessionId, error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ── Consumo pelo trabalho da IA ───────────────────────────────────────────────

/**
 * Drena as pendentes E as marca aplicadas numa única operação atômica, e devolve o
 * que drenou. É idempotente por construção: uma segunda chamada (outro lote
 * paralelo, um retry) encontra a lista vazia. FAIL-OPEN: se o Redis falhar, a IA
 * segue sem a orientação — melhor um lote sem ela do que uma geração derrubada por
 * um recurso auxiliar. Os itens continuam pendentes e o próximo ponto seguro tenta.
 */
export async function consumePendingAdvice(
  sessionId: string,
  opts: { stage: string; scope: string },
): Promise<AdviceItem[]> {
  try {
    const applied = await (await getStore()).settle(sessionId, 'applied', {
      now: Date.now(), stage: opts.stage, scope: opts.scope,
    });
    for (const item of applied) ws.emit(sessionId, 'advice.applied', { item });
    return applied;
  } catch (err) {
    logger.warn('Falha ao consumir orientações (fail-open, seguem pendentes)', {
      sessionId, stage: opts.stage, error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Pendentes → expiradas, com o evento por item. O cliente que enviou devolve o texto
 * ao campo de mensagem: uma orientação que ninguém consumiu nunca some em silêncio.
 */
export async function expirePendingAdvice(sessionId: string, reason: string): Promise<AdviceItem[]> {
  try {
    const expired = await (await getStore()).settle(sessionId, 'expired', { now: Date.now(), reason });
    for (const item of expired) ws.emit(sessionId, 'advice.expired', { item });
    return expired;
  } catch (err) {
    logger.warn('Falha ao expirar orientações pendentes (fail-open)', {
      sessionId, error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Chamada por quem ENCERRA um trabalho (fim do turno do cérebro, fim do pipeline),
 * SEMPRE depois de o estado já refletir "não estou mais ocupado". Essa ordem é o que
 * casa com a segunda checagem de submitAdvice: nenhuma orientação fica pendente
 * depois do fim.
 */
export async function settleAdviceWhenIdle(sessionId: string, reason: string): Promise<AdviceItem[]> {
  return expirePendingAdvice(sessionId, reason);
}
