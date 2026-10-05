// Adaptador Redis do InterruptStore (ver lib/interrupt.ts): uma STRING JSON com TTL.
// Nada de Lua aqui — cada transição é um único comando atômico (SET com NX/XX).

import { redis, sessionInterruptKey } from './redis.js';
import { INTERRUPT_TTL_SECONDS, type InterruptState, type InterruptStore } from './interrupt.js';

export const redisInterruptStore: InterruptStore = {
  async request(sessionId, now) {
    const state: InterruptState = { state: 'requested', requestedAt: now };
    // NX: se já existe (requested OU stopped) não reescreve. Um `stopped` recém-gravado
    // não pode voltar a `requested` por um duplo clique — o pipeline que já parou não
    // teria quem o atendesse de novo, e o handler ficaria esperando até o timeout.
    await redis.set(sessionInterruptKey(sessionId), JSON.stringify(state), 'EX', INTERRUPT_TTL_SECONDS, 'NX');
  },

  async get(sessionId) {
    const raw = await redis.get(sessionInterruptKey(sessionId));
    return raw ? (JSON.parse(raw) as InterruptState) : null;
  },

  async markStopped(sessionId, info) {
    const atual = await this.get(sessionId);
    if (!atual) return; // apagada (novo enfileiramento ou timeout): não ressuscita
    const state: InterruptState = { ...atual, state: 'stopped', ...info };
    // XX: só escreve se a key ainda existir. O prazo é renovado (em vez de KEEPTTL,
    // que exige Redis 6+): quem pediu precisa ter tempo de LER o `stopped`.
    await redis.set(sessionInterruptKey(sessionId), JSON.stringify(state), 'EX', INTERRUPT_TTL_SECONDS, 'XX');
  },

  async clear(sessionId) {
    await redis.del(sessionInterruptKey(sessionId));
  },
};
