import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  meta: null as null | Record<string, any>,
  emitted: [] as Array<{ type: string; data: any }>,
  errors: [] as string[],
  handlers: new Map<string, (sessionId: string, userId: string | undefined, data: unknown) => Promise<void>>(),
}));

vi.mock('../lib/redis.js', () => ({
  getSessionMeta: vi.fn(async () => (h.meta ? { ...h.meta } : null)),
}));

vi.mock('../lib/websocket.js', () => ({
  ws: {
    emit: (_s: string, type: string, data: unknown) => h.emitted.push({ type, data }),
    error: (_s: string, m: string) => h.errors.push(m),
  },
  onWsMessage: (type: string, fn: any) => h.handlers.set(type, fn),
}));

import {
  initAdviceHandlers, handleInterruptMessage, waitForPipelineStop, isSessionBusy, settleAdviceAfterBrainTurn,
} from '../agents/brain/adviceHandlers';
import { beginBrainTurn } from '../agents/brain/turnRegistry';
import { setAdviceStore, submitAdvice, listAdvice } from '../lib/advice';
import {
  setInterruptStore, getInterruptState, markInterruptStopped, buildInterruptionNote,
} from '../lib/interrupt';
import { createMemoryAdviceStore, createMemoryInterruptStore } from './helpers/memoryLiveControl';

const S = 'sessao-h';
const A = 'advice-hhhhhhh1';
const B = 'advice-hhhhhhh2';
const busy = async () => true;
const quick = { timeoutMs: 400, pollMs: 5 };

let interruptStore: ReturnType<typeof createMemoryInterruptStore>;
const sendUserMessage = vi.fn(async () => {});

beforeEach(() => {
  h.meta = { id: S, userId: 'u1', workerStatus: 'idle', phase: 'listening' };
  h.emitted.length = 0;
  h.errors.length = 0;
  h.handlers.clear();
  sendUserMessage.mockClear();
  setAdviceStore(createMemoryAdviceStore());
  interruptStore = createMemoryInterruptStore();
  setInterruptStore(interruptStore);
});
afterEach(() => vi.useRealTimers());

describe('isSessionBusy / fim de turno', () => {
  it('ocupada por turno do cérebro OU por pipeline rodando; ociosa caso contrário', async () => {
    expect(await isSessionBusy(S)).toBe(false);

    const { end } = beginBrainTurn(S);
    expect(await isSessionBusy(S)).toBe(true);
    end();
    expect(await isSessionBusy(S)).toBe(false);

    h.meta!.workerStatus = 'running';
    expect(await isSessionBusy(S)).toBe(true);
  });

  it('fim do turno SEM pipeline devolve as pendentes ao autor', async () => {
    await submitAdvice({ sessionId: S, id: A, text: 'orientação', origin: 'aba-1', isBusy: busy });
    await settleAdviceAfterBrainTurn(S);
    expect((await listAdvice(S))[0]).toMatchObject({ status: 'expired', expireReason: 'ended' });
  });

  it('fim do turno COM pipeline despachado: as pendentes seguem para ele (não expiram)', async () => {
    await submitAdvice({ sessionId: S, id: A, text: 'orientação', isBusy: busy });
    h.meta!.workerStatus = 'running';
    await settleAdviceAfterBrainTurn(S);
    expect((await listAdvice(S))[0]).toMatchObject({ status: 'pending' });
  });

  it('outro turno da mesma sessão ainda em andamento: não varre', async () => {
    await submitAdvice({ sessionId: S, id: A, text: 'x', isBusy: busy });
    const outro = beginBrainTurn(S);
    await settleAdviceAfterBrainTurn(S);
    expect((await listAdvice(S))[0]).toMatchObject({ status: 'pending' });
    outro.end();
  });
});

describe('handlers WebSocket de orientação', () => {
  const chamar = (tipo: string, data: unknown, userId: string | undefined = 'u1') =>
    h.handlers.get(tipo)!(S, userId, data);

  beforeEach(() => initAdviceHandlers({ sendUserMessage }));

  it('advice:send com a IA ocupada enfileira e devolve advice.queued', async () => {
    h.meta!.workerStatus = 'running';
    await chamar('advice:send', { id: A, text: 'mais respiro', clientId: 'aba-1' });
    expect(h.emitted.map((e) => e.type)).toEqual(['advice.queued']);
    expect(h.emitted[0]!.data.item).toMatchObject({ id: A, origin: 'aba-1', status: 'pending' });
  });

  it('advice:send com a IA ociosa NÃO enfileira: devolve o texto (advice.expired)', async () => {
    await chamar('advice:send', { id: A, text: 'tarde', clientId: 'aba-1' });
    expect(h.emitted.map((e) => e.type)).toEqual(['advice.expired']);
    expect(h.emitted[0]!.data.item).toMatchObject({ text: 'tarde', expireReason: 'idle', origin: 'aba-1' });
  });

  it('sessão inexistente devolve o texto com motivo no-session', async () => {
    h.meta = null;
    await chamar('advice:send', { id: A, text: 'x', clientId: 'aba-1' });
    expect(h.emitted[0]!.data.item.expireReason).toBe('no-session');
  });

  it('sessão de OUTRO usuário é ignorada em silêncio (nenhum evento)', async () => {
    h.meta!.workerStatus = 'running';
    await chamar('advice:send', { id: A, text: 'x', clientId: 'aba-1' }, 'intruso');
    await chamar('advice:update', { id: A, text: 'y' }, 'intruso');
    await chamar('advice:remove', { id: A }, 'intruso');
    await chamar('advice:dismiss', { ids: [A] }, 'intruso');
    expect(h.emitted).toEqual([]);
  });

  it('update, remove e dismiss seguem o ciclo do item', async () => {
    h.meta!.workerStatus = 'running';
    await chamar('advice:send', { id: A, text: 'v1', clientId: 'c' });
    await chamar('advice:update', { id: A, text: 'v2' });
    expect((await listAdvice(S))[0]!.text).toBe('v2');
    await chamar('advice:remove', { id: A });
    expect(await listAdvice(S)).toEqual([]);
    expect(h.emitted.map((e) => e.type)).toEqual(['advice.queued', 'advice.updated', 'advice.removed']);
  });

  it('DOIS CLIENTES na mesma sessão: os dois veem os eventos e cada item guarda o seu autor', async () => {
    h.meta!.workerStatus = 'running';
    await chamar('advice:send', { id: A, text: 'da aba 1', clientId: 'aba-1' });
    await chamar('advice:send', { id: B, text: 'da aba 2', clientId: 'aba-2' });
    // os eventos vão para o canal da SESSÃO (todos os clientes recebem); o `origin`
    // é o que impede a devolução ao campo da aba errada
    const origens = h.emitted.map((e) => e.data.item.origin);
    expect(origens).toEqual(['aba-1', 'aba-2']);

    // a aba 2 remove a pendente da aba 1 (mesmo usuário): vale, e ambas são avisadas pelo evento
    await chamar('advice:remove', { id: A });
    expect(h.emitted.at(-1)).toMatchObject({ type: 'advice.removed', data: { id: A } });
    expect((await listAdvice(S)).map((i) => i.id)).toEqual([B]);
  });
});

describe('waitForPipelineStop', () => {
  it('devolve o estado stopped assim que o pipeline o grava', async () => {
    h.meta!.workerStatus = 'running';
    await interruptStore.request(S, 1);
    setTimeout(() => { void markInterruptStopped(S, { stage: 'antes do lote 3 de 4', slidesKept: 6, total: 12 }); }, 20);
    const st = await waitForPipelineStop(S, quick);
    expect(st).toMatchObject({ state: 'stopped', stage: 'antes do lote 3 de 4', slidesKept: 6, total: 12 });
  });

  it('o pipeline zera o workerStatus ANTES de gravar `stopped`: a folga pega o `stopped` em vez de concluir que terminou sozinho', async () => {
    h.meta!.workerStatus = 'running';
    await interruptStore.request(S, 1);
    setTimeout(() => { h.meta!.workerStatus = 'idle'; }, 10);
    setTimeout(() => { void markInterruptStopped(S, { stage: 'antes do revisor', slidesKept: 12, total: 12 }); }, 30);
    expect(await waitForPipelineStop(S, quick)).toMatchObject({ state: 'stopped', stage: 'antes do revisor' });
  });

  it('terminou sozinho (nunca viu o pedido): devolve null', async () => {
    await interruptStore.request(S, 1);
    h.meta!.workerStatus = 'done';
    expect(await waitForPipelineStop(S, quick)).toBeNull();
  });

  it('tempo esgotado com o pipeline ainda rodando: devolve null (a mensagem segue)', async () => {
    h.meta!.workerStatus = 'running';
    await interruptStore.request(S, 1);
    expect(await waitForPipelineStop(S, { timeoutMs: 60, pollMs: 5 })).toBeNull();
  });
});

describe('"Pausar e enviar" (message:interrupt)', () => {
  it('sem nada em andamento: é só uma mensagem normal, sem nota', async () => {
    await handleInterruptMessage({ sendUserMessage }, S, 'u1', { content: '  oi  ' }, quick);
    expect(sendUserMessage).toHaveBeenCalledWith(S, 'u1', 'oi', undefined, { interruptionNote: undefined });
  });

  it('mensagem vazia é ignorada; sessão alheia também', async () => {
    await handleInterruptMessage({ sendUserMessage }, S, 'u1', { content: '   ' }, quick);
    await handleInterruptMessage({ sendUserMessage }, S, 'intruso', { content: 'oi' }, quick);
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it('sessão inexistente avisa o usuário', async () => {
    h.meta = null;
    await handleInterruptMessage({ sendUserMessage }, S, 'u1', { content: 'oi' }, quick);
    expect(h.errors[0]).toMatch(/Sessão expirou/);
  });

  it('cérebro em andamento: aborta o stream, ESPERA o turno persistir o parcial e só então abre a mensagem nova', async () => {
    const ordem: string[] = [];
    const { turn, end } = beginBrainTurn(S);
    turn.controller.signal.addEventListener('abort', () => {
      ordem.push('abort');
      // o turno leva um instante para gravar o texto parcial e encerrar
      setTimeout(() => { ordem.push('turno terminou'); end(); }, 15);
    });
    sendUserMessage.mockImplementationOnce(async () => { ordem.push('mensagem nova'); });

    await handleInterruptMessage({ sendUserMessage }, S, 'u1', { content: 'muda o tom' }, quick);

    expect(ordem).toEqual(['abort', 'turno terminou', 'mensagem nova']);
    const [, , , , opts] = sendUserMessage.mock.calls[0]! as any[];
    expect(opts.interruptionNote).toMatch(/interrompeu a sua resposta anterior/);
    expect(opts.interruptionNote).toMatch(/DISPATCH/);
  });

  it('pipeline rodando: pede a parada, espera o `stopped` e passa ONDE parou (lote e slides) no contexto da mensagem', async () => {
    h.meta!.workerStatus = 'running';
    // "pipeline": vê a flag, para e avisa
    const timer = setInterval(async () => {
      if ((await getInterruptState(S))?.state === 'requested') {
        clearInterval(timer);
        h.meta!.workerStatus = 'idle';
        await markInterruptStopped(S, { stage: 'antes do lote 4 de 10', slidesKept: 9, total: 30 });
      }
    }, 5);

    await handleInterruptMessage({ sendUserMessage }, S, 'u1', { content: 'troca as cores' }, quick);
    clearInterval(timer);

    const [, , texto, , opts] = sendUserMessage.mock.calls[0]! as any[];
    expect(texto).toBe('troca as cores');
    expect(opts.interruptionNote).toContain('antes do lote 4 de 10');
    expect(opts.interruptionNote).toContain('9 de 30 slides');
    expect(opts.interruptionNote).toContain('MANTIDOS');
    expect(opts.interruptionNote).toMatch(/Só emita \[DISPATCH\] se ele pedir/);
    // a flag é apagada depois de lida
    expect(await getInterruptState(S)).toBeNull();
  });

  it('as orientações PENDENTES viajam junto com a mensagem, viram aplicadas e não voltam ao campo', async () => {
    h.meta!.workerStatus = 'running';
    await submitAdvice({ sessionId: S, id: A, text: 'sem fotos', origin: 'aba-1', isBusy: busy });
    const timer = setInterval(async () => {
      if ((await getInterruptState(S))?.state === 'requested') {
        clearInterval(timer);
        h.meta!.workerStatus = 'idle';
        await markInterruptStopped(S, { stage: 'antes do lote 2 de 4', slidesKept: 3, total: 12 });
      }
    }, 5);

    await handleInterruptMessage({ sendUserMessage }, S, 'u1', { content: 'refaz o slide 2' }, quick);
    clearInterval(timer);

    const [, , , , opts] = sendUserMessage.mock.calls[0]! as any[];
    expect(opts.interruptionNote).toContain('- sem fotos');
    expect((await listAdvice(S))[0]).toMatchObject({ status: 'applied', stage: 'enviada com a sua mensagem' });
    expect(h.emitted.some((e) => e.type === 'advice.expired')).toBe(false);
  });

  it('pipeline que não parou dentro do prazo: a mensagem segue mesmo assim e o contexto diz que o lote em curso ainda termina', async () => {
    h.meta!.workerStatus = 'running';
    await handleInterruptMessage({ sendUserMessage }, S, 'u1', { content: 'para' }, { timeoutMs: 40, pollMs: 5 });
    const [, , , , opts] = sendUserMessage.mock.calls[0]! as any[];
    expect(opts.interruptionNote).toContain('ainda vai terminar');
  });

  it('pipeline que terminou sozinho antes do pedido: a nota não afirma que houve interrupção', async () => {
    h.meta!.workerStatus = 'running';
    setTimeout(() => { h.meta!.workerStatus = 'done'; }, 10);
    await handleInterruptMessage({ sendUserMessage }, S, 'u1', { content: 'ok, obrigado' }, quick);
    const [, , , , opts] = sendUserMessage.mock.calls[0]! as any[];
    expect(opts.interruptionNote).toContain('já estava terminando');
  });
});

describe('nota de interrupção', () => {
  it('sem interrupção e sem orientação não há nota', () => {
    expect(buildInterruptionNote({})).toBeUndefined();
  });
  it('só orientação pendente também gera contexto', () => {
    expect(buildInterruptionNote({ pendingAdvice: [{ id: A, text: 'x', createdAt: 1, status: 'applied' }] })).toContain('- x');
  });
});
