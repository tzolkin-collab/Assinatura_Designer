import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexto da operação em curso (marca, sessão, usuário, feature).
 *
 * O `generateWithRetry` é o gargalo por onde passa quase toda chamada ao Gemini,
 * mas ele não recebe marca nem sessão — e enfiar esses parâmetros em dez camadas
 * (rota → pipeline → planner → lotes → reviewer) seria plumbing puro. O contexto
 * viaja sozinho: quem entra no pipeline abre um escopo e todo mundo lá dentro lê.
 */
export interface AiContext {
  runId?: string;
  brandSlug?: string;
  sessionId?: string;
  userId?: string;
  postId?: string;
  /** Que parte do produto está gastando: 'pipeline', 'chat', 'ai-patch', ... */
  feature?: string;
  /** Correlaciona todos os logs de uma mesma requisição/job. */
  requestId?: string;
}

const storage = new AsyncLocalStorage<AiContext>();

/** Roda `fn` com o contexto ativo. O que estava setado antes é herdado e sobrescrito. */
export function runWithAiContext<T>(context: AiContext, fn: () => T): T {
  const current = storage.getStore();
  return storage.run({ ...current, ...context }, fn);
}

export function getAiContext(): AiContext {
  return storage.getStore() ?? {};
}

/**
 * Completa o contexto já aberto. Serve para o que só se descobre lá dentro — a
 * marca do chat, por exemplo, só aparece depois de carregar a sessão do Redis, e
 * sem ela o gasto do chat ficaria fora do teto por marca.
 */
export function enrichAiContext(patch: AiContext): void {
  const atual = storage.getStore();
  if (atual) Object.assign(atual, patch);
}
