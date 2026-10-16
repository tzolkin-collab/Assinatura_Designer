// consumeRateLimit: o miolo do rateLimit, usado também pelas ferramentas MCP que dividem o balde das rotas HTTP.
import './client'; // mocka o Redis (contadores em memória)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeRateLimit } from '../middleware/rateLimit';
import { redis } from '../lib/redis';

const policy = { windowSec: 10, max: 2, keyPrefix: 'teste-consume' };
let n = 0;
const fresh = () => `usuario-${++n}-${Math.random()}`; // o mock do Redis não expira janelas: cada teste usa uma identidade nova

describe('consumeRateLimit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('permite até o teto e recusa a partir da chamada seguinte, com o tempo de espera', async () => {
    const id = fresh();
    expect((await consumeRateLimit(policy, id)).allowed).toBe(true);
    expect((await consumeRateLimit(policy, id)).allowed).toBe(true);
    const third = await consumeRateLimit(policy, id);
    expect(third).toEqual({ allowed: false, retryAfterSec: 60 }); // ttl do mock
  });

  it('a primeira chamada abre a janela (expire) e só ela', async () => {
    const id = fresh();
    await consumeRateLimit(policy, id);
    await consumeRateLimit(policy, id);
    expect(redis.expire).toHaveBeenCalledTimes(1);
    expect(redis.expire).toHaveBeenCalledWith(`ratelimit:teste-consume:${id}`, 10);
  });

  it('identidades diferentes têm baldes diferentes; o prefixo separa políticas', async () => {
    const a = fresh();
    const b = fresh();
    await consumeRateLimit(policy, a);
    await consumeRateLimit(policy, a);
    expect((await consumeRateLimit(policy, a)).allowed).toBe(false);
    expect((await consumeRateLimit(policy, b)).allowed).toBe(true);
    expect((await consumeRateLimit({ ...policy, keyPrefix: 'outro' }, a)).allowed).toBe(true);
  });

  it('usa a MESMA chave que o middleware das rotas (ratelimit:<prefixo>:<usuário>)', async () => {
    const id = fresh();
    await consumeRateLimit({ windowSec: 10, max: 4, keyPrefix: 'svg-sanitize' }, id);
    expect(redis.incr).toHaveBeenCalledWith(`ratelimit:svg-sanitize:${id}`);
  });

  it('Redis fora: não bloqueia ninguém (fail-open)', async () => {
    vi.mocked(redis.incr).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await consumeRateLimit(policy, fresh())).toEqual({ allowed: true, retryAfterSec: 0 });
  });
});
