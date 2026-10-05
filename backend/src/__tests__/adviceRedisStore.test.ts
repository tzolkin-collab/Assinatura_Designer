// Contrato do adaptador Redis (lib/adviceRedisStore.ts) — NÃO testa o Lua.
//
// Não há Lua nem Redis disponíveis nos testes, então o que se verifica aqui é o
// entorno do script: a) cada script só lê KEYS/ARGV que o adaptador de fato passa
// (o erro clássico de off-by-one, que num Lua real vira `nil` silencioso);
// b) o adaptador monta os argumentos na ordem documentada e interpreta as respostas
// no formato que o Lua devolve. A semântica das transições é a do store em memória
// (helpers/memoryLiveControl.ts), espelho declarado do Lua — ver notDone no relatório.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  evalCalls: [] as Array<{ script: string; numKeys: number; keys: string[]; argv: string[] }>,
  reply: undefined as unknown,
  hash: {} as Record<string, string>,
}));

vi.mock('../lib/redis.js', () => ({
  SESSION_TTL: 86400,
  sessionAdviceKey: (id: string) => `adv:${id}`,
  sessionMetaKey: (id: string) => `meta:${id}`,
  redis: {
    eval: vi.fn(async (script: string, numKeys: number, ...args: string[]) => {
      h.evalCalls.push({ script, numKeys, keys: args.slice(0, numKeys), argv: args.slice(numKeys) });
      return h.reply;
    }),
    multi: vi.fn(() => {
      const chain = { hgetall: vi.fn(() => chain), expire: vi.fn(() => chain), exec: vi.fn(async () => [[null, h.hash], [null, 1]]) };
      return chain;
    }),
  },
}));

import {
  redisAdviceStore, ADD_LUA, UPDATE_LUA, REMOVE_LUA, SETTLE_LUA, DISMISS_LUA, PRUNE_LUA,
} from '../lib/adviceRedisStore';

const S = 'sessao-r';
const item = { id: 'advice-rrrrrrr1', text: 'oi', createdAt: 1000, status: 'pending' as const };

/** Maior índice de KEYS[n] / ARGV[n] que o script referencia literalmente. */
const maxIndex = (script: string, name: 'KEYS' | 'ARGV') =>
  Math.max(0, ...[...script.matchAll(new RegExp(`${name}\\[(\\d+)\\]`, 'g'))].map((m) => Number(m[1])));

beforeEach(() => {
  h.evalCalls.length = 0;
  h.reply = undefined;
  h.hash = {};
});

describe('scripts × argumentos passados (off-by-one)', () => {
  it.each([
    ['ADD', ADD_LUA, () => redisAdviceStore.add(S, item)],
    ['UPDATE', UPDATE_LUA, () => redisAdviceStore.update(S, item.id, 'novo', 5)],
    ['REMOVE', REMOVE_LUA, () => redisAdviceStore.remove(S, item.id)],
    ['SETTLE aplicada', SETTLE_LUA, () => redisAdviceStore.settle(S, 'applied', { now: 5, stage: 'lote 1 de 2', scope: 'p' })],
    ['SETTLE expirada', SETTLE_LUA, () => redisAdviceStore.settle(S, 'expired', { now: 5, reason: 'ended' })],
  ])('%s: o script só usa KEYS/ARGV que o adaptador passa', async (_n, script, chamar) => {
    await chamar();
    const call = h.evalCalls[0]!;
    expect(call.script).toBe(script);
    expect(maxIndex(script, 'KEYS')).toBeLessThanOrEqual(call.numKeys);
    expect(maxIndex(script, 'ARGV')).toBeLessThanOrEqual(call.argv.length);
    expect(call.keys[0]).toBe(`adv:${S}`);
  });

  it('DISMISS e PRUNE iteram ARGV inteiro (#ARGV): sem índice fixo além do que existe', async () => {
    await redisAdviceStore.dismiss(S, ['advice-1aaaaaaa', 'advice-2aaaaaaa']);
    await redisAdviceStore.prune(S, { keepScopes: ['deck-1'] });
    expect(h.evalCalls[0]!.argv).toEqual(['advice-1aaaaaaa', 'advice-2aaaaaaa']);
    expect(h.evalCalls[1]!.argv).toEqual(['deck-1']);
    expect(DISMISS_LUA).toContain('#ARGV');
    expect(PRUNE_LUA).toContain('#ARGV');
  });

  it('todo script recebe a key do advice em KEYS[1]; só o ADD precisa também da meta (guarda de sessão expirada)', async () => {
    await redisAdviceStore.add(S, item);
    expect(h.evalCalls[0]!.keys).toEqual([`adv:${S}`, `meta:${S}`]);
    expect(ADD_LUA).toContain("exists', KEYS[2]");
  });
});

describe('ordem dos argumentos e leitura das respostas', () => {
  it('add: id, json, ttl, teto — e traduz a resposta do script', async () => {
    h.reply = 'ok';
    expect(await redisAdviceStore.add(S, item)).toBe('ok');
    const { argv } = h.evalCalls[0]!;
    expect(argv[0]).toBe(item.id);
    expect(JSON.parse(argv[1]!)).toMatchObject({ id: item.id, text: 'oi', status: 'pending' });
    expect(argv[2]).toBe('86400');
    expect(argv[3]).toBe('50');
    h.reply = 'full';
    expect(await redisAdviceStore.add(S, item)).toBe('full');
    h.reply = 'no-session';
    expect(await redisAdviceStore.add(S, item)).toBe('no-session');
  });

  it('update: id, texto, agora, ttl; interpreta {ok, json} e {not-pending, json}', async () => {
    h.reply = ['ok', JSON.stringify({ ...item, text: 'novo' })];
    expect(await redisAdviceStore.update(S, item.id, 'novo', 5)).toMatchObject({ result: 'ok', item: { text: 'novo' } });
    expect(h.evalCalls[0]!.argv).toEqual([item.id, 'novo', '5', '86400']);

    h.reply = ['not-pending', JSON.stringify({ ...item, status: 'applied' })];
    expect(await redisAdviceStore.update(S, item.id, 'x', 5)).toMatchObject({ result: 'not-pending', item: { status: 'applied' } });

    h.reply = ['not-found'];
    expect(await redisAdviceStore.update(S, item.id, 'x', 5)).toEqual({ result: 'not-found' });
  });

  it('settle: status, agora, etapa, escopo, motivo, ttl (vazio = ausente) e devolve os itens em ordem', async () => {
    h.reply = [JSON.stringify({ ...item, status: 'applied' }), JSON.stringify({ ...item, id: 'advice-rrrrrrr2', status: 'applied' })];
    const r = await redisAdviceStore.settle(S, 'applied', { now: 9, stage: 'revisor', scope: 'post-1' });
    expect(h.evalCalls[0]!.argv).toEqual(['applied', '9', 'revisor', 'post-1', '', '86400']);
    expect(r.map((i) => i.id)).toEqual([item.id, 'advice-rrrrrrr2']);

    h.reply = [];
    await redisAdviceStore.settle(S, 'expired', { now: 10, reason: 'failed' });
    expect(h.evalCalls[1]!.argv).toEqual(['expired', '10', '', '', 'failed', '86400']);
  });

  it('dismiss sem ids nem vai ao Redis', async () => {
    expect(await redisAdviceStore.dismiss(S, [])).toEqual([]);
    expect(h.evalCalls).toHaveLength(0);
  });

  it('list: lê a HASH e ordena por envio', async () => {
    h.hash = {
      b: JSON.stringify({ ...item, id: 'advice-rrrrrrr2', createdAt: 2000 }),
      a: JSON.stringify({ ...item, id: 'advice-rrrrrrr1', createdAt: 1000 }),
    };
    expect((await redisAdviceStore.list(S)).map((i) => i.id)).toEqual(['advice-rrrrrrr1', 'advice-rrrrrrr2']);
  });
});

describe('estrutura dos scripts', () => {
  it('só transições de PENDENTE editam/removem/drenam (o critério do duelo com a drenagem)', () => {
    expect(UPDATE_LUA).toContain("item.status ~= 'pending'");
    expect(REMOVE_LUA).toContain("item.status ~= 'pending'");
    expect(SETTLE_LUA).toContain("item.status == 'pending'");
    expect(DISMISS_LUA).toContain("item.status ~= 'pending'");
  });

  it('nenhum script usa comandos não determinísticos ou acesso a chaves não declaradas', () => {
    for (const s of [ADD_LUA, UPDATE_LUA, REMOVE_LUA, SETTLE_LUA, DISMISS_LUA, PRUNE_LUA]) {
      expect(s).not.toMatch(/redis\.call\('(?:time|randomkey|keys|scan)'/i);
      expect(s).not.toMatch(/math\.random/);
    }
  });
});
