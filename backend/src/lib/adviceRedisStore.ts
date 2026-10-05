// Adaptador Redis do AdviceStore (ver lib/advice.ts).
//
// Uma HASH por sessão: campo = id da orientação, valor = JSON do item. Cada
// transição de estado é um script Lua, porque o Redis executa um script inteiro sem
// intercalar nenhum outro comando — é isso que dá atomicidade a "drenar + marcar
// aplicada" e ao duelo edição × drenagem, mesmo com API e worker em processos
// diferentes. (WATCH/MULTI não serviria: o cliente `redis` é UMA conexão
// compartilhada por todo o app, e qualquer EXEC alheio no meio desarmaria o WATCH
// sem aviso.)
//
// O TTL da HASH é o da sessão e é renovado a cada escrita.

import { redis, SESSION_TTL, sessionAdviceKey, sessionMetaKey } from './redis.js';
import type { AddResult, AdviceItem, AdviceStore, MutateResult } from './advice.js';
import { ADVICE_MAX_ITEMS } from './advice.js';

// KEYS[1] = advice, KEYS[2] = meta da sessão. ARGV: id, json, ttl, max.
// Recusa sessão inexistente (não cria hash órfã sem dono, como o appendMessage), e
// não sobrescreve um id que já existe (reenvio do cliente após reconexão).
export const ADD_LUA = `
if redis.call('exists', KEYS[2]) == 0 then return 'no-session' end
if redis.call('hexists', KEYS[1], ARGV[1]) == 1 then return 'exists' end
if redis.call('hlen', KEYS[1]) >= tonumber(ARGV[4]) then return 'full' end
redis.call('hset', KEYS[1], ARGV[1], ARGV[2])
redis.call('expire', KEYS[1], tonumber(ARGV[3]))
return 'ok'
`;

// ARGV: id, texto, agora, ttl. Só edita item PENDENTE: se a drenagem chegou antes,
// devolve o item como está (aplicado) e a edição não vale.
export const UPDATE_LUA = `
local raw = redis.call('hget', KEYS[1], ARGV[1])
if not raw then return {'not-found'} end
local item = cjson.decode(raw)
if item.status ~= 'pending' then return {'not-pending', raw} end
item.text = ARGV[2]
item.updatedAt = tonumber(ARGV[3])
local out = cjson.encode(item)
redis.call('hset', KEYS[1], ARGV[1], out)
redis.call('expire', KEYS[1], tonumber(ARGV[4]))
return {'ok', out}
`;

// ARGV: id. Mesma regra do UPDATE: só remove pendente.
export const REMOVE_LUA = `
local raw = redis.call('hget', KEYS[1], ARGV[1])
if not raw then return {'not-found'} end
local item = cjson.decode(raw)
if item.status ~= 'pending' then return {'not-pending', raw} end
redis.call('hdel', KEYS[1], ARGV[1])
return {'ok', raw}
`;

// ARGV: novoStatus ('applied'|'expired'), agora, etapa, escopo, motivo, ttl.
// Pega TODAS as pendentes, ordena por envio (createdAt, depois id) e as transiciona
// na mesma execução. Devolve os JSONs já atualizados. Strings vazias em ARGV = campo
// ausente.
export const SETTLE_LUA = `
local all = redis.call('hgetall', KEYS[1])
local pend = {}
for i = 1, #all, 2 do
  local item = cjson.decode(all[i + 1])
  if item.status == 'pending' then table.insert(pend, item) end
end
table.sort(pend, function(a, b)
  if a.createdAt == b.createdAt then return a.id < b.id end
  return a.createdAt < b.createdAt
end)
local out = {}
for _, item in ipairs(pend) do
  item.status = ARGV[1]
  if ARGV[1] == 'applied' then
    item.appliedAt = tonumber(ARGV[2])
    if ARGV[3] ~= '' then item.stage = ARGV[3] end
    if ARGV[4] ~= '' then item.scope = ARGV[4] end
  else
    item.expiredAt = tonumber(ARGV[2])
    if ARGV[5] ~= '' then item.expireReason = ARGV[5] end
  end
  local enc = cjson.encode(item)
  redis.call('hset', KEYS[1], item.id, enc)
  table.insert(out, enc)
end
if #out > 0 then redis.call('expire', KEYS[1], tonumber(ARGV[6])) end
return out
`;

// ARGV: ids... Só apaga item JÁ resolvido; pendente é ignorado.
export const DISMISS_LUA = `
local removed = {}
for i = 1, #ARGV do
  local raw = redis.call('hget', KEYS[1], ARGV[i])
  if raw then
    local item = cjson.decode(raw)
    if item.status ~= 'pending' then
      redis.call('hdel', KEYS[1], ARGV[i])
      table.insert(removed, ARGV[i])
    end
  end
end
return removed
`;

// ARGV: escopos a MANTER. Expirados sempre caem; aplicados caem a menos que o escopo
// esteja na lista. Pendentes nunca são tocados.
export const PRUNE_LUA = `
local keep = {}
for i = 1, #ARGV do keep[ARGV[i]] = true end
local all = redis.call('hgetall', KEYS[1])
local removed = {}
for i = 1, #all, 2 do
  local item = cjson.decode(all[i + 1])
  local drop = false
  if item.status == 'expired' then
    drop = true
  elseif item.status == 'applied' then
    drop = not (item.scope ~= nil and keep[item.scope] == true)
  end
  if drop then
    redis.call('hdel', KEYS[1], all[i])
    table.insert(removed, all[i])
  end
end
return removed
`;

function parseItem(raw: string): AdviceItem {
  return JSON.parse(raw) as AdviceItem;
}

function parseMutate(reply: unknown): MutateResult {
  const [code, raw] = (Array.isArray(reply) ? reply : []) as [string?, string?];
  if (code === 'ok') return { result: 'ok', item: raw ? parseItem(raw) : undefined };
  if (code === 'not-pending') return { result: 'not-pending', item: raw ? parseItem(raw) : undefined };
  return { result: 'not-found' };
}

export const redisAdviceStore: AdviceStore = {
  async add(sessionId, item): Promise<AddResult> {
    const r = await redis.eval(
      ADD_LUA, 2,
      sessionAdviceKey(sessionId), sessionMetaKey(sessionId),
      item.id, JSON.stringify(item), String(SESSION_TTL), String(ADVICE_MAX_ITEMS),
    );
    return (r as AddResult) ?? 'no-session';
  },

  async update(sessionId, id, text, now) {
    const r = await redis.eval(UPDATE_LUA, 1, sessionAdviceKey(sessionId), id, text, String(now), String(SESSION_TTL));
    return parseMutate(r);
  },

  async remove(sessionId, id) {
    const r = await redis.eval(REMOVE_LUA, 1, sessionAdviceKey(sessionId), id);
    return parseMutate(r);
  },

  async settle(sessionId, to, opts) {
    const r = await redis.eval(
      SETTLE_LUA, 1, sessionAdviceKey(sessionId),
      to, String(opts.now), opts.stage ?? '', opts.scope ?? '', opts.reason ?? '', String(SESSION_TTL),
    );
    return ((r as string[] | null) ?? []).map(parseItem);
  },

  async dismiss(sessionId, ids) {
    if (ids.length === 0) return [];
    const r = await redis.eval(DISMISS_LUA, 1, sessionAdviceKey(sessionId), ...ids);
    return (r as string[] | null) ?? [];
  },

  async prune(sessionId, opts) {
    const r = await redis.eval(PRUNE_LUA, 1, sessionAdviceKey(sessionId), ...opts.keepScopes);
    return (r as string[] | null) ?? [];
  },

  async list(sessionId) {
    // Renova o TTL junto: quem lista (reconexão) está claramente vivo.
    const res = await redis
      .multi()
      .hgetall(sessionAdviceKey(sessionId))
      .expire(sessionAdviceKey(sessionId), SESSION_TTL)
      .exec();
    const hash = (res?.[0]?.[1] ?? {}) as Record<string, string>;
    return Object.values(hash)
      .map(parseItem)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  },
};
