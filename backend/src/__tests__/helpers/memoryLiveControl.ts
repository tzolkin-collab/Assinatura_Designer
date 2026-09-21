// Adaptadores EM MEMÓRIA das portas AdviceStore e InterruptStore, com a mesma
// semântica dos scripts Lua de produção (lib/adviceRedisStore.ts). Cada método é
// síncrono por dentro — a mesma atomicidade que o Redis dá a um script — então
// os testes de corrida (drenar × editar × expirar) exercitam o desenho de verdade
// sem precisar de Redis. O Lua em si só roda contra um Redis real (ver notDone).

import type { AdviceItem, AdviceStore, AddResult, MutateResult } from '../../lib/advice';
import type { InterruptState, InterruptStore } from '../../lib/interrupt';

export function createMemoryAdviceStore(opts: { sessions?: Set<string>; maxItems?: number } = {}): AdviceStore & {
  raw: Map<string, Map<string, AdviceItem>>;
} {
  const raw = new Map<string, Map<string, AdviceItem>>();
  const maxItems = opts.maxItems ?? 50;
  const hash = (sessionId: string) => {
    let h = raw.get(sessionId);
    if (!h) { h = new Map(); raw.set(sessionId, h); }
    return h;
  };
  const clone = (i: AdviceItem): AdviceItem => ({ ...i });

  return {
    raw,

    async add(sessionId, item): Promise<AddResult> {
      // `sessions` ausente = toda sessão existe. Presente = só as listadas (simula
      // a guarda de sessão expirada do ADD_LUA).
      if (opts.sessions && !opts.sessions.has(sessionId)) return 'no-session';
      const h = hash(sessionId);
      if (h.has(item.id)) return 'exists';
      if (h.size >= maxItems) return 'full';
      h.set(item.id, clone(item));
      return 'ok';
    },

    async update(sessionId, id, text, now): Promise<MutateResult> {
      const item = hash(sessionId).get(id);
      if (!item) return { result: 'not-found' };
      if (item.status !== 'pending') return { result: 'not-pending', item: clone(item) };
      item.text = text;
      item.updatedAt = now;
      return { result: 'ok', item: clone(item) };
    },

    async remove(sessionId, id): Promise<MutateResult> {
      const h = hash(sessionId);
      const item = h.get(id);
      if (!item) return { result: 'not-found' };
      if (item.status !== 'pending') return { result: 'not-pending', item: clone(item) };
      h.delete(id);
      return { result: 'ok', item: clone(item) };
    },

    async settle(sessionId, to, o) {
      const pend = [...hash(sessionId).values()]
        .filter((i) => i.status === 'pending')
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      for (const item of pend) {
        item.status = to;
        if (to === 'applied') {
          item.appliedAt = o.now;
          if (o.stage) item.stage = o.stage;
          if (o.scope) item.scope = o.scope;
        } else {
          item.expiredAt = o.now;
          if (o.reason) item.expireReason = o.reason;
        }
      }
      return pend.map(clone);
    },

    async dismiss(sessionId, ids) {
      const h = hash(sessionId);
      const removed: string[] = [];
      for (const id of ids) {
        const item = h.get(id);
        if (item && item.status !== 'pending') { h.delete(id); removed.push(id); }
      }
      return removed;
    },

    async prune(sessionId, o) {
      const h = hash(sessionId);
      const removed: string[] = [];
      for (const [id, item] of h) {
        const drop = item.status === 'expired'
          || (item.status === 'applied' && !(item.scope !== undefined && o.keepScopes.includes(item.scope)));
        if (drop) { h.delete(id); removed.push(id); }
      }
      return removed;
    },

    async list(sessionId) {
      return [...hash(sessionId).values()]
        .map(clone)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    },
  };
}

export function createMemoryInterruptStore(): InterruptStore & { raw: Map<string, InterruptState> } {
  const raw = new Map<string, InterruptState>();
  return {
    raw,
    async request(sessionId, now) {
      if (!raw.has(sessionId)) raw.set(sessionId, { state: 'requested', requestedAt: now });
    },
    async get(sessionId) {
      const s = raw.get(sessionId);
      return s ? { ...s } : null;
    },
    async markStopped(sessionId, info) {
      const s = raw.get(sessionId);
      if (!s) return;
      raw.set(sessionId, { ...s, state: 'stopped', ...info });
    },
    async clear(sessionId) {
      raw.delete(sessionId);
    },
  };
}
