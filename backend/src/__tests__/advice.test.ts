import { describe, it, expect, vi, beforeEach } from 'vitest';

const emitted: Array<{ sessionId: string; type: string; data: any }> = [];
vi.mock('../lib/websocket.js', () => ({
  ws: { emit: (sessionId: string, type: string, data: unknown) => emitted.push({ sessionId, type, data }) },
}));

import {
  submitAdvice, editAdvice, removePendingAdvice, consumePendingAdvice, expirePendingAdvice,
  dismissAdvice, pruneAdvice, listAdvice, setAdviceStore, isValidAdviceId, normalizeAdviceText,
  ADVICE_MAX_TEXT,
} from '../lib/advice';
import { createMemoryAdviceStore } from './helpers/memoryLiveControl';

const S = 'sessao-1';
const ids = { a: 'advice-aaaaaaaa', b: 'advice-bbbbbbbb', c: 'advice-cccccccc', d: 'advice-dddddddd' };
const busy = async () => true;
const idle = async () => false;

const eventsOf = (type: string) => emitted.filter((e) => e.type === type);

let store: ReturnType<typeof createMemoryAdviceStore>;
beforeEach(() => {
  emitted.length = 0;
  store = createMemoryAdviceStore();
  setAdviceStore(store);
});

describe('validação de entrada', () => {
  it('aceita ids curtos e seguros; recusa o resto', () => {
    expect(isValidAdviceId('advice-aaaaaaaa')).toBe(true);
    expect(isValidAdviceId('curto')).toBe(false);
    expect(isValidAdviceId('tem espaço e :dois-pontos')).toBe(false);
    expect(isValidAdviceId(undefined)).toBe(false);
    expect(isValidAdviceId('x'.repeat(65))).toBe(false);
  });

  it('apara o texto, recusa vazio e corta no teto', () => {
    expect(normalizeAdviceText('  oi  ')).toBe('oi');
    expect(normalizeAdviceText('   ')).toBeNull();
    expect(normalizeAdviceText(42)).toBeNull();
    expect(normalizeAdviceText('a'.repeat(ADVICE_MAX_TEXT + 500))!.length).toBe(ADVICE_MAX_TEXT);
  });
});

describe('enviar orientação', () => {
  it('grava como pendente e emite advice.queued com o item', async () => {
    const r = await submitAdvice({ sessionId: S, id: ids.a, text: 'mais contraste', origin: 'aba-1', isBusy: busy });
    expect(r.ok).toBe(true);
    const [q] = eventsOf('advice.queued');
    expect(q!.data.item).toMatchObject({ id: ids.a, text: 'mais contraste', status: 'pending', origin: 'aba-1' });
    expect((await listAdvice(S))[0]).toMatchObject({ status: 'pending' });
  });

  it('com a IA ociosa NÃO grava: devolve o texto ao autor (advice.expired, motivo idle)', async () => {
    const r = await submitAdvice({ sessionId: S, id: ids.a, text: 'tarde demais', origin: 'aba-1', isBusy: idle });
    expect(r).toEqual({ ok: false, reason: 'idle' });
    expect(await listAdvice(S)).toEqual([]);
    const [e] = eventsOf('advice.expired');
    expect(e!.data.item).toMatchObject({ id: ids.a, text: 'tarde demais', status: 'expired', expireReason: 'idle', origin: 'aba-1' });
    expect(eventsOf('advice.queued')).toHaveLength(0);
  });

  it('fim da geração ENTRE a checagem e a gravação: a segunda checagem expira o item', async () => {
    // Primeira checagem: ocupada. Depois de gravar: já ociosa (a geração terminou e
    // a varredura de quem encerrou passou ANTES da nossa gravação).
    const respostas = [true, false];
    const r = await submitAdvice({ sessionId: S, id: ids.a, text: 'no último segundo', isBusy: async () => respostas.shift() ?? false });
    expect(r.ok).toBe(true);
    expect((await listAdvice(S))[0]).toMatchObject({ status: 'expired', expireReason: 'idle' });
    expect(eventsOf('advice.queued')).toHaveLength(1);
    expect(eventsOf('advice.expired')).toHaveLength(1);
  });

  it('reenvio do mesmo id (reconexão) é idempotente: sem item nem evento duplicado', async () => {
    await submitAdvice({ sessionId: S, id: ids.a, text: 'uma vez', isBusy: busy });
    const r = await submitAdvice({ sessionId: S, id: ids.a, text: 'uma vez', isBusy: busy });
    expect(r).toMatchObject({ ok: true, duplicate: true });
    expect(await listAdvice(S)).toHaveLength(1);
    expect(eventsOf('advice.queued')).toHaveLength(1);
  });

  it('entrada inválida e sessão inexistente são recusadas sem gravar', async () => {
    expect(await submitAdvice({ sessionId: S, id: 'x', text: 'ok', isBusy: busy })).toEqual({ ok: false, reason: 'invalid' });
    expect(await submitAdvice({ sessionId: S, id: ids.a, text: '   ', isBusy: busy })).toEqual({ ok: false, reason: 'invalid' });

    setAdviceStore(createMemoryAdviceStore({ sessions: new Set() }));
    expect(await submitAdvice({ sessionId: S, id: ids.a, text: 'ok', isBusy: busy })).toEqual({ ok: false, reason: 'no-session' });
  });

  it('respeita o teto de itens por sessão', async () => {
    setAdviceStore(createMemoryAdviceStore({ maxItems: 2 }));
    await submitAdvice({ sessionId: S, id: ids.a, text: '1', isBusy: busy });
    await submitAdvice({ sessionId: S, id: ids.b, text: '2', isBusy: busy });
    expect(await submitAdvice({ sessionId: S, id: ids.c, text: '3', isBusy: busy })).toEqual({ ok: false, reason: 'full' });
  });
});

describe('editar e remover enquanto pendente', () => {
  it('editar pendente muda o texto e emite advice.updated', async () => {
    await submitAdvice({ sessionId: S, id: ids.a, text: 'versão 1', isBusy: busy });
    await editAdvice(S, ids.a, 'versão 2');
    expect((await listAdvice(S))[0]).toMatchObject({ text: 'versão 2' });
    expect(eventsOf('advice.updated')[0]!.data.item.text).toBe('versão 2');
  });

  it('remover pendente apaga e emite advice.removed', async () => {
    await submitAdvice({ sessionId: S, id: ids.a, text: 'x', isBusy: busy });
    await removePendingAdvice(S, ids.a);
    expect(await listAdvice(S)).toEqual([]);
    expect(eventsOf('advice.removed')).toEqual([expect.objectContaining({ data: { id: ids.a } })]);
  });

  it('CORRIDA drenagem × edição: se a drenagem venceu, a edição não vale e o cliente recebe o item aplicado', async () => {
    await submitAdvice({ sessionId: S, id: ids.a, text: 'texto original', isBusy: busy });
    await consumePendingAdvice(S, { stage: 'lote 2 de 5', scope: 'post-1' }); // vence

    await editAdvice(S, ids.a, 'edição tardia');

    expect((await listAdvice(S))[0]).toMatchObject({ text: 'texto original', status: 'applied' });
    const upd = eventsOf('advice.updated').at(-1)!;
    expect(upd.data.item).toMatchObject({ status: 'applied', stage: 'lote 2 de 5', text: 'texto original' });
  });

  it('CORRIDA drenagem × remoção: remover algo já aplicado não apaga e corrige o cliente', async () => {
    await submitAdvice({ sessionId: S, id: ids.a, text: 'aplicada', isBusy: busy });
    await consumePendingAdvice(S, { stage: 'revisor', scope: 'post-1' });

    await removePendingAdvice(S, ids.a);

    expect(await listAdvice(S)).toHaveLength(1);
    expect(eventsOf('advice.removed')).toHaveLength(0);
    expect(eventsOf('advice.updated').at(-1)!.data.item.status).toBe('applied');
  });

  it('editar/remover o que não existe manda o cliente esquecer o id', async () => {
    await editAdvice(S, ids.d, 'fantasma');
    await removePendingAdvice(S, ids.d);
    expect(eventsOf('advice.removed').map((e) => e.data.id)).toEqual([ids.d, ids.d]);
  });
});

describe('consumir (drenar + marcar aplicada, atômico)', () => {
  it('devolve as pendentes em ordem de envio, com etapa e escopo, e emite advice.applied por item', async () => {
    await submitAdvice({ sessionId: S, id: ids.b, text: 'segunda', isBusy: busy });
    // createdAt maior garante a ordem mesmo com ids que ordenariam diferente
    store.raw.get(S)!.get(ids.b)!.createdAt = 2000;
    await submitAdvice({ sessionId: S, id: ids.a, text: 'primeira', isBusy: busy });
    store.raw.get(S)!.get(ids.a)!.createdAt = 1000;

    const applied = await consumePendingAdvice(S, { stage: 'lote 3 de 10', scope: 'post-9' });

    expect(applied.map((i) => i.text)).toEqual(['primeira', 'segunda']);
    expect(applied[0]).toMatchObject({ status: 'applied', stage: 'lote 3 de 10', scope: 'post-9' });
    expect(applied[0]!.appliedAt).toBeTypeOf('number');
    expect(eventsOf('advice.applied').map((e) => e.data.item.text)).toEqual(['primeira', 'segunda']);
  });

  it('é idempotente: a segunda drenagem encontra a lista vazia', async () => {
    await submitAdvice({ sessionId: S, id: ids.a, text: 'x', isBusy: busy });
    expect(await consumePendingAdvice(S, { stage: 'lote 1 de 2', scope: 'p' })).toHaveLength(1);
    expect(await consumePendingAdvice(S, { stage: 'lote 2 de 2', scope: 'p' })).toEqual([]);
    expect(eventsOf('advice.applied')).toHaveLength(1);
  });

  it('drenagens concorrentes (lotes paralelos) dividem os itens, nunca duplicam', async () => {
    for (const [k, id] of Object.entries(ids)) await submitAdvice({ sessionId: S, id, text: `item ${k}`, isBusy: busy });

    const resultados = await Promise.all([
      consumePendingAdvice(S, { stage: 'lote 4 de 9', scope: 'p' }),
      consumePendingAdvice(S, { stage: 'lote 5 de 9', scope: 'p' }),
      consumePendingAdvice(S, { stage: 'lote 6 de 9', scope: 'p' }),
    ]);

    const todos = resultados.flat().map((i) => i.id);
    expect(todos.sort()).toEqual(Object.values(ids).sort());
    expect(new Set(todos).size).toBe(todos.length);
  });

  it('falha do store é fail-open: devolve vazio e os itens seguem pendentes', async () => {
    await submitAdvice({ sessionId: S, id: ids.a, text: 'x', isBusy: busy });
    const quebrado = { ...store, settle: async () => { throw new Error('redis fora'); } };
    setAdviceStore(quebrado);
    expect(await consumePendingAdvice(S, { stage: 'lote 1 de 1', scope: 'p' })).toEqual([]);
    expect((await store.list(S))[0]!.status).toBe('pending');
  });
});

describe('expirar ao fim do trabalho', () => {
  it('pendentes viram expired com motivo e evento; aplicadas ficam como estão', async () => {
    await submitAdvice({ sessionId: S, id: ids.a, text: 'aplicada', isBusy: busy });
    await consumePendingAdvice(S, { stage: 'lote 1 de 2', scope: 'p' });
    await submitAdvice({ sessionId: S, id: ids.b, text: 'sobrou', origin: 'aba-9', isBusy: busy });

    const expired = await expirePendingAdvice(S, 'ended');

    expect(expired.map((i) => i.id)).toEqual([ids.b]);
    const items = await listAdvice(S);
    expect(items.find((i) => i.id === ids.a)!.status).toBe('applied');
    expect(items.find((i) => i.id === ids.b)).toMatchObject({ status: 'expired', expireReason: 'ended', origin: 'aba-9' });
    expect(eventsOf('advice.expired')[0]!.data.item.text).toBe('sobrou');
  });

  it('expirar duas vezes não repete o evento (idempotente)', async () => {
    await submitAdvice({ sessionId: S, id: ids.a, text: 'x', isBusy: busy });
    await expirePendingAdvice(S, 'ended');
    await expirePendingAdvice(S, 'idle');
    expect(eventsOf('advice.expired')).toHaveLength(1);
  });
});

describe('limpeza de itens resolvidos', () => {
  it('dismiss só apaga o que já foi resolvido, nunca um pendente', async () => {
    await submitAdvice({ sessionId: S, id: ids.a, text: 'pendente', isBusy: busy });
    await submitAdvice({ sessionId: S, id: ids.b, text: 'vai expirar', isBusy: busy });
    store.raw.get(S)!.get(ids.b)!.status = 'expired';

    await dismissAdvice(S, [ids.a, ids.b]);

    expect((await listAdvice(S)).map((i) => i.id)).toEqual([ids.a]);
    expect(eventsOf('advice.removed').map((e) => e.data.id)).toEqual([ids.b]);
  });

  it('prune apaga expirados e aplicados de outros escopos; guarda os do escopo vigente e os pendentes', async () => {
    await submitAdvice({ sessionId: S, id: ids.a, text: 'deck antigo', isBusy: busy });
    await consumePendingAdvice(S, { stage: 'lote 1 de 2', scope: 'deck-antigo' });
    await submitAdvice({ sessionId: S, id: ids.b, text: 'deck atual', isBusy: busy });
    await consumePendingAdvice(S, { stage: 'lote 1 de 2', scope: 'deck-atual' });
    await submitAdvice({ sessionId: S, id: ids.c, text: 'expirada', isBusy: busy });
    await expirePendingAdvice(S, 'ended');
    await submitAdvice({ sessionId: S, id: ids.d, text: 'pendente', isBusy: busy });

    await pruneAdvice(S, { keepScopes: ['deck-atual'] });

    expect((await listAdvice(S)).map((i) => i.id).sort()).toEqual([ids.b, ids.d].sort());
    expect(eventsOf('advice.removed').map((e) => e.data.id).sort()).toEqual([ids.a, ids.c].sort());
  });
});
