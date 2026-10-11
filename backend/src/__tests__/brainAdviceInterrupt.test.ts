// O cérebro de ponta a ponta com o Gemini, o Redis e o WebSocket simulados:
// orientações consumidas ao iniciar cada turno do modelo, "Pausar e enviar" abortando
// o stream com o texto parcial preservado, e a reidratação da lista na reconexão.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  class GenerationAbortedError extends Error {
    constructor() { super('Interrompido a pedido do usuário.'); this.name = 'GenerationAbortedError'; }
  }
  return {
    GenerationAbortedError,
    session: {} as Record<string, any>,
    wsCalls: [] as Array<{ fn: string; args: any[] }>,
    handlers: new Map<string, (sessionId: string, userId: string | undefined, data: unknown) => Promise<void>>(),
    streamCalls: [] as Array<{ contents: any[]; systemInstruction: string; hooks: any }>,
    /** Cada item descreve o stream de UMA chamada ao modelo. */
    streams: [] as Array<(call: { hooks: any }) => AsyncGenerator<any>>,
    enqueued: [] as any[],
    enqueueError: null as Error | null,
    appended: [] as any[],
    onAppend: null as null | ((msg: any) => Promise<void> | void),
    skillCalls: [] as string[],
  };
});

vi.mock('../lib/redis.js', () => ({
  getSession: vi.fn(async () => ({ ...h.session, messages: [...h.session.messages] })),
  getSessionMeta: vi.fn(async () => { const { messages: _m, currentDesign: _d, ...meta } = h.session; return { ...meta }; }),
  updateSession: vi.fn(async (_id: string, patch: Record<string, any>) => { Object.assign(h.session, patch); }),
  appendMessage: vi.fn(async (_id: string, msg: any) => {
    h.session.messages.push(msg);
    h.appended.push(msg);
    await h.onAppend?.(msg);
  }),
  getRecentSession: vi.fn(async () => ({ ...h.session, messages: [...h.session.messages] })),
  touchRecentBrand: vi.fn(async () => {}),
  createSession: vi.fn(async () => h.session),
}));

vi.mock('../lib/websocket.js', () => {
  const rec = (fn: string) => (...args: any[]) => { h.wsCalls.push({ fn, args }); };
  return {
    ws: {
      emit: rec('emit'), token: rec('token'), end: rec('end'), error: rec('error'),
      progress: rec('progress'), sessionState: rec('sessionState'), designSlide: rec('designSlide'),
    },
    onWsMessage: (type: string, fn: any) => h.handlers.set(type, fn),
  };
});

vi.mock('../lib/geminiRetry.js', () => ({
  GenerationAbortedError: h.GenerationAbortedError,
  humanizeGeminiError: (e: unknown) => `humanizado: ${e instanceof Error ? e.message : String(e)}`,
  generateWithRetry: vi.fn(),
  generateStreamWithRetry: vi.fn(async (_ai: unknown, params: any, _model: string, hooks: any) => {
    // Cópia: o brain reusa (e altera) o mesmo array de `contents` nos passos seguintes.
    h.streamCalls.push({ contents: JSON.parse(JSON.stringify(params.contents)), systemInstruction: params.config.systemInstruction, hooks });
    const make = h.streams.shift();
    if (!make) throw new Error('stream não previsto no teste');
    return make({ hooks });
  }),
}));

vi.mock('../lib/queue.js', () => ({ enqueuePipeline: vi.fn(async (p: any) => {
  if (h.enqueueError) throw h.enqueueError;
  h.enqueued.push(p);
}) }));
vi.mock('../lib/r2.js', () => ({ uploadFileToR2: vi.fn(async () => 'https://r2/x.png') }));
vi.mock('../lib/prisma.js', () => ({ default: { post: { findFirst: vi.fn(async () => null) } } }));
vi.mock('../agents/tools/index.js', () => ({ executeTool: vi.fn() }));
vi.mock('../lib/postHelper.js', () => ({ mergeSlidesIntoPost: vi.fn(), persistPostContent: vi.fn() }));
vi.mock('../lib/postVersions.js', () => ({ snapshotPost: vi.fn() }));
vi.mock('../agents/planner/index.js', () => ({ runPlanner: vi.fn() }));
vi.mock('../agents/pipeline.js', () => ({ parseRequestedSlideCount: vi.fn(() => undefined) }));
vi.mock('../lib/imageResolver.js', () => ({ generatePhotoBuffer: vi.fn(), shouldPreferUnsplashForCost: vi.fn(async () => false) }));
vi.mock('../agents/brain/skills.js', () => ({
  brainTools: [],
  executeSkill: vi.fn(async (name: string) => { h.skillCalls.push(name); return { ok: true }; }),
}));

import { initBrainHandlers, reconnectSession } from '../agents/brain/index';
import { setAdviceStore, submitAdvice, listAdvice } from '../lib/advice';
import { setInterruptStore } from '../lib/interrupt';
import { createMemoryAdviceStore, createMemoryInterruptStore } from './helpers/memoryLiveControl';

const S = 'sessao-brain';
const A = 'advice-bbbbbbb1';
const B = 'advice-bbbbbbb2';
const busy = async () => true;

const wsOf = (fn: string) => h.wsCalls.filter((c) => c.fn === fn);
const emitsOf = (type: string) => wsOf('emit').filter((c) => c.args[1] === type).map((c) => c.args[2]);
const tokens = () => wsOf('token').map((c) => c.args[1]).join('');
const send = (content: string) => h.handlers.get('message')!(S, 'u1', { content });
const interrupt = (content: string) => h.handlers.get('message:interrupt')!(S, 'u1', { content });

/** Stream de uma resposta em texto. */
const texto = (t: string) => (async function* () { yield { candidates: [{ content: { parts: [{ text: t }] } }] }; });
/** Stream em que o modelo chama uma ferramenta. */
const ferramenta = (name: string) => (async function* () {
  yield { candidates: [{ content: { parts: [{ functionCall: { name, args: {} } }] } }] };
});

beforeEach(() => {
  h.session = {
    id: S, userId: 'u1', brandSlug: 'marca', phase: 'listening', workerStatus: 'idle', reviewMode: 'manual',
    activeQuestion: null, currentDesign: [], progress: 0, progressLabel: '',
    messages: [{ role: 'system', content: 'Contexto da marca:\nMarca X', timestamp: 1 }],
  };
  h.wsCalls.length = 0;
  h.handlers.clear();
  h.streamCalls.length = 0;
  h.streams.length = 0;
  h.enqueued.length = 0;
  h.enqueueError = null;
  h.appended.length = 0;
  h.skillCalls.length = 0;
  h.onAppend = null;
  setAdviceStore(createMemoryAdviceStore());
  setInterruptStore(createMemoryInterruptStore());
  initBrainHandlers();
});

describe('orientações consumidas pelo cérebro', () => {
  it('a que chega antes da primeira chamada ao modelo entra no systemInstruction desse turno, marcada aplicada em "resposta do chat"', async () => {
    h.streams.push(texto('Certo!'));
    // Depois da mensagem persistida e antes do modelo: a IA já está ocupada.
    h.onAppend = async (msg) => {
      if (msg.role === 'user') await submitAdvice({ sessionId: S, id: A, text: 'fale mais curto', origin: 'aba-1', isBusy: busy });
    };

    await send('faz um carrossel');

    expect(h.streamCalls).toHaveLength(1);
    expect(h.streamCalls[0]!.systemInstruction).toContain('Orientações do usuário durante esta resposta');
    expect(h.streamCalls[0]!.systemInstruction).toContain('- fale mais curto');
    const [item] = await listAdvice(S);
    expect(item).toMatchObject({ status: 'applied', stage: 'resposta do chat', scope: 'chat' });
    expect(emitsOf('advice.applied')).toHaveLength(1);
  });

  it('a que chega DURANTE o turno entra no passo seguinte (após uma ferramenta); os anteriores não a viram', async () => {
    h.streams.push(async function* () {
      // o usuário digita enquanto o modelo escolhe uma ferramenta
      await submitAdvice({ sessionId: S, id: A, text: 'foco em benefícios', isBusy: busy });
      yield { candidates: [{ content: { parts: [{ functionCall: { name: 'lerMarca', args: {} } }] } }] };
    });
    h.streams.push(texto('Pronto, ajustei.'));

    await send('me ajuda');

    expect(h.streamCalls).toHaveLength(2);
    expect(h.streamCalls[0]!.systemInstruction).not.toContain('foco em benefícios');
    expect(h.streamCalls[1]!.systemInstruction).toContain('- foco em benefícios');
    expect((await listAdvice(S))[0]).toMatchObject({ status: 'applied', stage: 'resposta do chat (passo 2)' });
  });

  it('orientações acumulam nos passos seguintes do mesmo turno', async () => {
    h.streams.push(async function* () {
      await submitAdvice({ sessionId: S, id: A, text: 'primeira', isBusy: busy });
      yield { candidates: [{ content: { parts: [{ functionCall: { name: 'f1', args: {} } }] } }] };
    });
    h.streams.push(async function* () {
      await submitAdvice({ sessionId: S, id: B, text: 'segunda', isBusy: busy });
      yield { candidates: [{ content: { parts: [{ functionCall: { name: 'f2', args: {} } }] } }] };
    });
    h.streams.push(texto('fim'));

    await send('vai');

    const ultimo = h.streamCalls[2]!.systemInstruction;
    expect(ultimo).toContain('- primeira');
    expect(ultimo).toContain('- segunda');
  });

  it('a que chega no ÚLTIMO passo, sem nenhum turno depois para consumi-la, EXPIRA ao fim e volta ao autor', async () => {
    h.streams.push(async function* () {
      await submitAdvice({ sessionId: S, id: A, text: 'tarde demais', origin: 'aba-3', isBusy: busy });
      yield { candidates: [{ content: { parts: [{ text: 'resposta final' }] } }] };
    });

    await send('oi');

    const [item] = await listAdvice(S);
    expect(item).toMatchObject({ status: 'expired', expireReason: 'ended', origin: 'aba-3' });
    expect(emitsOf('advice.expired')[0].item.text).toBe('tarde demais');
    expect(wsOf('end')).toHaveLength(1);
  });

  it('turno que despacha o pipeline (workerStatus running) NÃO expira: as pendentes seguem para o pipeline', async () => {
    h.streams.push(async function* () {
      await submitAdvice({ sessionId: S, id: A, text: 'vale para o deck', isBusy: busy });
      // resposta que dispara a geração
      yield { candidates: [{ content: { parts: [{ text: 'Gerando! [DISPATCH:carousel]' }] } }] };
    });

    await send('cria o carrossel');

    expect(h.enqueued).toHaveLength(1);
    expect(h.session.workerStatus).toBe('running');
    expect((await listAdvice(S))[0]).toMatchObject({ status: 'pending' });
  });

  it('falha ao enfileirar persiste fase de erro e libera a sessão', async () => {
    h.enqueueError = new Error('Redis indisponível');
    h.streams.push(async function* () {
      yield { candidates: [{ content: { parts: [{ text: 'Gerando! [DISPATCH:carousel]' }] } }] };
    });

    await send('cria o carrossel');

    expect(h.session).toMatchObject({ phase: 'error', workerStatus: 'error' });
    expect(wsOf('error')).toHaveLength(1);
    expect(wsOf('sessionState').at(-1)?.args[1]).toMatchObject({ phase: 'error', workerStatus: 'error' });
  });

  it('no modo Auto, roteiriza a copy e despacha sem pedir aprovação manual', async () => {
    const planner = await import('../agents/planner/index');
    vi.mocked(planner.runPlanner).mockResolvedValueOnce([{
      order: 1, title: 'Abertura', goal: 'Apresentar o tema', layout_type: 'title-hero',
      copy: 'Copy aprovada',
    }]);
    h.session.reviewMode = 'auto';
    h.streams.push(texto('Vou criar agora [DISPATCH:presentation]'));

    await send('Copy oficial longa. '.repeat(80));

    expect(h.enqueued).toHaveLength(1);
    expect(h.enqueued[0].approvedSkeleton).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Abertura', copy: 'Copy aprovada' }),
    ]));
    expect(h.session.pendingPlan).toBeFalsy();
    expect(h.session.activeQuestion).toBeNull();
    expect(tokens()).toContain('aprovado automaticamente');
  });

  it('preserva moodboards na pausa e os encaminha ao aprovar o roteiro', async () => {
    const planner = await import('../agents/planner/index');
    vi.mocked(planner.runPlanner).mockResolvedValueOnce([{
      order: 1, title: 'Abertura', goal: 'Apresentar o tema', layout_type: 'title-hero', copy: 'Copy oficial',
    }]);
    const moodboard = { name: 'Moodboard apresentações.png', mimeType: 'image/png', dataBase64: 'aGVsbG8=', url: 'https://r2/x.png' };
    h.session.messages.push({ role: 'user', content: 'Copy oficial. '.repeat(100), timestamp: 1, attachments: [moodboard] });
    h.streams.push(texto('Vou criar agora [DISPATCH:presentation]'));

    await send('crie a apresentação');

    const expectedImages = [{ url: moodboard.url, name: moodboard.name, role: 'style-reference' }];
    expect(h.session.pendingPlan.attachmentImages).toEqual(expectedImages);
    expect(h.enqueued).toHaveLength(0);

    await send('Aprovar roteiro e gerar');

    expect(h.enqueued[0].attachmentImages).toEqual(expectedImages);
  });

  it('um turno normal (novo ciclo) limpa da lista o que já foi resolvido', async () => {
    h.streams.push(texto('a'));
    h.onAppend = async (msg) => { if (msg.role === 'user') await submitAdvice({ sessionId: S, id: A, text: 'antiga', isBusy: busy }); };
    await send('primeira');
    expect((await listAdvice(S))[0]!.status).toBe('applied');

    h.onAppend = null;
    h.streams.push(texto('b'));
    await send('segunda');

    expect(await listAdvice(S)).toEqual([]);
    expect(emitsOf('advice.removed').map((d) => d.id)).toContain(A);
  });
});

describe('"Pausar e enviar" no cérebro', () => {
  it('aborta o stream, MANTÉM o texto parcial (marcado), não despacha nada e abre a mensagem nova com o contexto', async () => {
    let liberar!: () => void;
    const noMeio = new Promise<void>((r) => { liberar = r; });

    // 1º turno: emite um pedaço com uma tag de ação e trava até ser abortado.
    h.streams.push(({ hooks }) => (async function* () {
      yield { candidates: [{ content: { parts: [{ text: 'Vou criar o deck agora [DISPATCH:presentation]' }] } }] };
      liberar();
      await new Promise<void>((_, reject) => {
        hooks.abortSignal.addEventListener('abort', () => reject(new h.GenerationAbortedError()));
      });
    })());
    // 2º turno (a mensagem que interrompeu)
    h.streams.push(texto('Beleza, mudo o tom.'));

    const primeiro = send('faz uma apresentação');
    await noMeio;
    await interrupt('na verdade, muda o tom');
    await primeiro;

    // parcial preservado, com a tag de ação REMOVIDA e o marcador de corte
    const assistentes = h.appended.filter((m) => m.role === 'assistant');
    expect(assistentes[0]!.content).toBe('Vou criar o deck agora\n\n*[resposta interrompida]*');
    expect(assistentes[0]!.content).not.toContain('DISPATCH');
    // nenhuma geração foi despachada a partir do texto cortado
    expect(h.enqueued).toEqual([]);

    // a mensagem nova é persistida COMO O USUÁRIO DIGITOU (a nota vai só ao modelo)
    const usuarios = h.appended.filter((m) => m.role === 'user').map((m) => m.content);
    expect(usuarios).toEqual(['faz uma apresentação', 'na verdade, muda o tom']);

    // e o 2º turno chega ao modelo com o contexto da interrupção
    expect(h.streamCalls).toHaveLength(2);
    const ultimaParte = h.streamCalls[1]!.contents.at(-1).parts.map((p: any) => p.text ?? '').join('');
    expect(ultimaParte).toContain('[CONTEXTO DO SISTEMA]');
    expect(ultimaParte).toContain('interrompeu a sua resposta anterior');
    expect(ultimaParte).toContain('na verdade, muda o tom');
    // o texto parcial do 1º turno está no histórico
    const historico = JSON.stringify(h.streamCalls[1]!.contents);
    expect(historico).toContain('Vou criar o deck agora');
  });

  it('abortar antes de sair qualquer texto: não persiste mensagem vazia da IA', async () => {
    h.streams.push(({ hooks }) => (async function* () {
      await new Promise<void>((_, reject) => {
        hooks.abortSignal.addEventListener('abort', () => reject(new h.GenerationAbortedError()));
      });
    })());
    h.streams.push(texto('ok'));

    const primeiro = send('oi');
    await new Promise((r) => setTimeout(r, 20));
    await interrupt('esquece, faz outra coisa');
    await primeiro;

    expect(h.appended.filter((m) => m.role === 'assistant').map((m) => m.content)).toEqual(['ok']);
    expect(wsOf('error')).toHaveLength(0); // parar por vontade do usuário não é erro
  });

  it('abortar não vira mensagem de erro no chat', async () => {
    h.streams.push(({ hooks }) => (async function* () {
      yield { candidates: [{ content: { parts: [{ text: 'parcial' }] } }] };
      await new Promise<void>((_, reject) => {
        hooks.abortSignal.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
      });
    })());
    h.streams.push(texto('ok'));

    const primeiro = send('oi');
    await new Promise((r) => setTimeout(r, 20));
    await interrupt('outra');
    await primeiro;

    expect(wsOf('error')).toHaveLength(0);
    expect(tokens()).toContain('[resposta interrompida]');
  });

  it('ferramenta não é disparada depois do abort', async () => {
    let liberar!: () => void;
    const emitiuChamada = new Promise<void>((r) => { liberar = r; });
    h.streams.push(({ hooks }) => (async function* () {
      yield { candidates: [{ content: { parts: [{ functionCall: { name: 'lerMarca', args: {} } }] } }] };
      liberar();
      // o stream ainda vai terminar sozinho, mas o usuário já pediu para parar
      await new Promise<void>((resolve) => hooks.abortSignal.addEventListener('abort', () => resolve()));
    })());
    h.streams.push(texto('ok'));

    const primeiro = send('usa a ferramenta');
    await emitiuChamada;
    await interrupt('para');
    await primeiro;

    expect(h.skillCalls).toEqual([]);
  });
});

describe('reconexão (F5) reidrata as orientações', () => {
  it('session:state carrega a lista de orientações pendentes/aplicadas', async () => {
    h.session.workerStatus = 'running'; // geração em andamento
    const store = createMemoryAdviceStore();
    setAdviceStore(store);
    await store.add(S, { id: B, text: 'aplicada', createdAt: 5, status: 'pending' });
    await store.settle(S, 'applied', { now: 6, stage: 'lote 2 de 4', scope: 'post-1' });
    await submitAdvice({ sessionId: S, id: A, text: 'pendente', origin: 'aba-1', isBusy: busy });
    store.raw.get(S)!.get(A)!.createdAt = 10;

    await reconnectSession(S, 'u1');

    const [estado] = wsOf('sessionState');
    const advice = estado!.args[1].advice as Array<{ id: string; status: string; stage?: string }>;
    expect(advice.map((i) => [i.id, i.status])).toEqual([[B, 'applied'], [A, 'pending']]);
    expect(advice.find((i) => i.id === B)!.stage).toBe('lote 2 de 4');
  });

  it('se ninguém está trabalhando, o "pendente" órfão expira na reconexão em vez de ficar para sempre', async () => {
    const store = createMemoryAdviceStore();
    setAdviceStore(store);
    await store.add(S, { id: A, text: 'resto de uma geração que caiu', createdAt: 1, status: 'pending', origin: 'aba-1' });

    await reconnectSession(S, 'u1');

    const advice = wsOf('sessionState')[0]!.args[1].advice as Array<{ status: string }>;
    expect(advice[0]!.status).toBe('expired');
    expect(emitsOf('advice.expired')).toHaveLength(1);
  });

  it('os demais session:state (sem reconexão) NÃO trazem o campo — o cliente não deve mexer na lista', async () => {
    h.streams.push(texto('oi'));
    await send('olá');
    const estados = wsOf('sessionState').map((c) => c.args[1]);
    expect(estados.length).toBeGreaterThan(0);
    for (const e of estados) expect(e).not.toHaveProperty('advice');
  });
});
