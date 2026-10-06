import type { RedisLike, RedisMulti } from './store.js';

/**
 * Emulação em memória do subconjunto de Redis que o `RedisMcpStore` usa.
 *
 * Serve a dois propósitos legítimos: (1) testes — não há Redis nem mocks de infra, o
 * store REAL roda sobre esta emulação, então o que se testa é a lógica do store e não
 * um mock dela; (2) o script de fumaça contra `dist/`, que prova que o módulo carrega
 * sem infraestrutura. NÃO é para produção: o estado vive num processo só (várias
 * instâncias da API não compartilhariam códigos/tokens).
 *
 * Fidelidade: reproduz as semânticas de que o store depende — `SET ... EX [NX]` (devolve
 * 'OK' ou null), expiração por relógio injetável, `LTRIM`/`LPUSH` com a ordem do Redis
 * (mais novo primeiro), `ZRANGE ... WITHSCORES` ordenado por score e `MULTI/EXEC`.
 *
 * ATOMICIDADE DO MULTI: o consumo de uso único (`GET` + `DEL`) depende de nenhuma outra
 * operação rodar entre os dois comandos. Os métodos públicos são `async`, e um `await`
 * entre dois deles cede o turno a outra requisição — exatamente o que o MULTI do Redis
 * real impede. Por isso toda a lógica vive em operações SÍNCRONAS (`op*`) e o `exec()`
 * roda a fila inteira num único bloco síncrono: sem ceder o turno, é atômico por
 * construção, como no servidor de verdade.
 */
export class MemoryRedis implements RedisLike {
  private readonly strings = new Map<string, { value: string; expiresAt?: number }>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly zsets = new Map<string, Map<string, number>>();
  private readonly lists = new Map<string, string[]>();
  private readonly expiries = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Só para testes: todo valor guardado, em texto, para varrer vazamento de segredo. */
  dump(): string {
    this.purge();
    const parts: string[] = [];
    for (const [k, v] of this.strings) parts.push(k, v.value);
    for (const [k, v] of this.sets) parts.push(k, ...v);
    for (const [k, v] of this.zsets) parts.push(k, ...v.keys());
    for (const [k, v] of this.lists) parts.push(k, ...v);
    return parts.join('\n');
  }

  keys(): string[] {
    this.purge();
    return [...this.strings.keys(), ...this.sets.keys(), ...this.zsets.keys(), ...this.lists.keys()];
  }

  private purge(): void {
    const t = this.now();
    for (const [k, v] of this.strings) if (v.expiresAt !== undefined && v.expiresAt <= t) this.strings.delete(k);
    for (const [k, exp] of this.expiries) {
      if (exp <= t) {
        this.expiries.delete(k);
        this.sets.delete(k);
        this.zsets.delete(k);
        this.lists.delete(k);
      }
    }
  }

  // ── Operações síncronas: a base de tudo (e o que o MULTI executa de uma vez) ──

  private opGet(key: string): string | null {
    this.purge();
    return this.strings.get(key)?.value ?? null;
  }

  private opSet(key: string, value: string, seconds: number, nx: boolean): 'OK' | null {
    this.purge();
    if (nx && this.strings.has(key)) return null;
    this.strings.set(key, { value, expiresAt: this.now() + seconds * 1000 });
    return 'OK';
  }

  private opDel(keys: string[]): number {
    this.purge();
    let removed = 0;
    for (const k of keys) {
      const had = this.strings.delete(k) || this.sets.delete(k) || this.zsets.delete(k) || this.lists.delete(k);
      this.expiries.delete(k);
      if (had) removed++;
    }
    return removed;
  }

  private opExpire(key: string, seconds: number): number {
    this.purge();
    const str = this.strings.get(key);
    if (str) {
      str.expiresAt = this.now() + seconds * 1000;
      return 1;
    }
    if (this.sets.has(key) || this.zsets.has(key) || this.lists.has(key)) {
      this.expiries.set(key, this.now() + seconds * 1000);
      return 1;
    }
    return 0;
  }

  private opSadd(key: string, members: string[]): number {
    this.purge();
    const set = this.sets.get(key) ?? new Set<string>();
    let added = 0;
    for (const m of members) {
      if (!set.has(m)) {
        set.add(m);
        added++;
      }
    }
    this.sets.set(key, set);
    return added;
  }

  private opLpush(key: string, values: string[]): number {
    this.purge();
    const list = this.lists.get(key) ?? [];
    for (const v of values) list.unshift(v);
    this.lists.set(key, list);
    return list.length;
  }

  private opLtrim(key: string, start: number, stop: number): 'OK' {
    this.purge();
    const list = this.lists.get(key);
    if (!list) return 'OK';
    this.lists.set(key, list.slice(start, stop === -1 ? undefined : stop + 1));
    return 'OK';
  }

  // ── API assíncrona (a que o store enxerga) ──

  async get(key: string): Promise<string | null> {
    return this.opGet(key);
  }

  async set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  async set(key: string, value: string, mode: 'EX', seconds: number, flag: 'NX'): Promise<'OK' | null>;
  async set(key: string, value: string, _mode: 'EX', seconds: number, flag?: 'NX'): Promise<'OK' | null> {
    return this.opSet(key, value, seconds, flag === 'NX');
  }

  async del(...keys: string[]): Promise<number> {
    return this.opDel(keys);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.opExpire(key, seconds);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    return this.opSadd(key, members);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    this.purge();
    const set = this.sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const m of members) if (set.delete(m)) removed++;
    if (set.size === 0) this.sets.delete(key);
    return removed;
  }

  async smembers(key: string): Promise<string[]> {
    this.purge();
    return [...(this.sets.get(key) ?? [])];
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    this.purge();
    const z = this.zsets.get(key) ?? new Map<string, number>();
    const isNew = !z.has(member);
    z.set(member, score);
    this.zsets.set(key, z);
    return isNew ? 1 : 0;
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    this.purge();
    const z = this.zsets.get(key);
    if (!z) return 0;
    let removed = 0;
    for (const m of members) if (z.delete(m)) removed++;
    if (z.size === 0) this.zsets.delete(key);
    return removed;
  }

  async zrange(key: string, start: number, stop: number, _withScores: 'WITHSCORES'): Promise<string[]> {
    this.purge();
    const z = this.zsets.get(key);
    if (!z) return [];
    // Mesma ordem do Redis: score crescente e, no empate, o membro em ordem lexicográfica.
    const sorted = [...z.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const slice = sorted.slice(start, stop === -1 ? undefined : stop + 1);
    return slice.flatMap(([member, score]) => [member, String(score)]);
  }

  async zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number> {
    this.purge();
    const z = this.zsets.get(key);
    if (!z) return 0;
    const lo = min === '-inf' ? -Infinity : Number(min);
    const hi = max === '+inf' ? Infinity : Number(max);
    let removed = 0;
    for (const [member, score] of z) {
      if (score >= lo && score <= hi) {
        z.delete(member);
        removed++;
      }
    }
    return removed;
  }

  async zcard(key: string): Promise<number> {
    this.purge();
    return this.zsets.get(key)?.size ?? 0;
  }

  async lpush(key: string, ...values: string[]): Promise<number> {
    return this.opLpush(key, values);
  }

  async ltrim(key: string, start: number, stop: number): Promise<unknown> {
    return this.opLtrim(key, start, stop);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    this.purge();
    const list = this.lists.get(key) ?? [];
    return list.slice(start, stop === -1 ? undefined : stop + 1);
  }

  /**
   * MULTI/EXEC: enfileira e executa tudo de uma vez, sem ceder o turno entre os comandos.
   * Devolve o mesmo formato do ioredis: um par `[erro, resultado]` por comando.
   */
  multi(): RedisMulti {
    const queue: Array<() => unknown> = [];
    const chain: RedisMulti = {
      get: (key) => (queue.push(() => this.opGet(key)), chain),
      del: (...keys) => (queue.push(() => this.opDel(keys)), chain),
      lpush: (key, ...values) => (queue.push(() => this.opLpush(key, values)), chain),
      ltrim: (key, start, stop) => (queue.push(() => this.opLtrim(key, start, stop)), chain),
      expire: (key, seconds) => (queue.push(() => this.opExpire(key, seconds)), chain),
      sadd: (key, ...members) => (queue.push(() => this.opSadd(key, members)), chain),
      // `async` sem nenhum await dentro: o corpo roda inteiro, de forma síncrona, na chamada.
      exec: async () =>
        queue.map((op): [Error | null, unknown] => {
          try {
            return [null, op()];
          } catch (error) {
            return [error instanceof Error ? error : new Error(String(error)), null];
          }
        }),
    };
    return chain;
  }
}
