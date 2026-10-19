// O cérebro de ponta a ponta com o Gemini, o Redis e o WebSocket simulados:
// orientações consumidas ao iniciar cada turno do modelo, "Pausar e enviar" abortando
// o stream com o texto parcial preservado, e a reidratação da lista na reconexão.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
vi.mock('../lib/prisma.js', () => ({ default: { post: { findFirst: vi.fn(async () => null) }, brand: { findUnique: vi.fn(async () => null) } } }));
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
import prisma from '../lib/prisma';
import { hasApprovedText } from '../lib/designerBrain/index';
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
    activeQuestion: null, currentDesign: [], progress: 0, progressLabel: '', photoRule: 'on',
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

  // Estes testes descrevem o chat ANTES do cérebro global ("projeto sem as regras do Designer"). Assumiam o
  // cérebro desligado por padrão, o que deixou de ser verdade: rodam com a saída de emergência
  // DESIGNER_BRAIN_GLOBAL=off, o que também prova que ela devolve o comportamento anterior. O padrão (cérebro
  // global ligado em todo projeto) é coberto no describe seguinte.
  describe('regra de foto real: ativada ou confirmada no chat antes de gerar (saída de emergência DESIGNER_BRAIN_GLOBAL=off)', () => {
    const original = process.env.DESIGNER_BRAIN_BRANDS;
    const originalGlobal = process.env.DESIGNER_BRAIN_GLOBAL;
    beforeEach(() => { delete h.session.photoRule; delete process.env.DESIGNER_BRAIN_BRANDS; process.env.DESIGNER_BRAIN_GLOBAL = 'off'; });
    afterEach(() => {
      if (original === undefined) delete process.env.DESIGNER_BRAIN_BRANDS;
      else process.env.DESIGNER_BRAIN_BRANDS = original;
      if (originalGlobal === undefined) delete process.env.DESIGNER_BRAIN_GLOBAL;
      else process.env.DESIGNER_BRAIN_GLOBAL = originalGlobal;
    });

    it('projeto sem as regras do Designer: a primeira geração PARA e pergunta se ativa', async () => {
      h.streams.push(texto('Vou criar [DISPATCH:presentation]'));
      await send('cria uma apresentação');

      expect(h.enqueued).toHaveLength(0);
      expect(h.session.pendingPhotoRule).toMatchObject({ format: 'presentation', isProof: false });
      // O assistente já pode ter dito "a geração foi iniciada": o card corrige, no lugar que a pessoa lê.
      expect(h.session.activeQuestion.helperText).toContain('Ainda não comecei a gerar');
      const q = h.session.activeQuestion;
      expect(q.question).toContain('ativo a regra de foto real');
      expect(q.question).toContain('Fotos reais disponíveis agora');
      expect(q.options.map((o: { label: string }) => o.label)).toEqual(['Ativar regra de foto real']);
      expect(q.allowFreeform).toBe(false);
    });

    it('projeto que já tem as regras: a mesma pausa, mas para CONFIRMAR', async () => {
      process.env.DESIGNER_BRAIN_BRANDS = 'marca';
      h.streams.push(texto('Vou criar [DISPATCH:presentation]'));
      await send('cria uma apresentação');

      expect(h.enqueued).toHaveLength(0);
      expect(h.session.activeQuestion.question).toContain('confirmo a regra de foto real');
      expect(h.session.activeQuestion.options[0].label).toBe('Confirmar regra de foto real');
    });

    it('conta as fotos anexadas na conversa, sem inventar o que não tem', async () => {
      h.session.messages.push({ role: 'user', content: 'segue a foto', timestamp: 2, attachments: [{ name: 'a.jpg', mimeType: 'image/jpeg', dataBase64: 'AA==' }] });
      h.streams.push(texto('Vou criar [DISPATCH:presentation]'));
      await send('cria uma apresentação');
      expect(h.session.activeQuestion.question).toContain('1 foto(s) anexada(s) nesta conversa');
    });

    it('a resposta liga a regra para a conversa e retoma a MESMA geração, sem passar pelo modelo', async () => {
      h.streams.push(texto('Vou criar [DISPATCH:carousel:9x16]'));
      await send('cria um carrossel');
      expect(h.enqueued).toHaveLength(0);
      const chamadasAoModelo = h.streamCalls.length;

      await send('Ativar regra de foto real');

      expect(h.session.photoRule).toBe('on');
      expect(h.session.pendingPhotoRule).toBeFalsy();
      expect(h.enqueued).toHaveLength(1);
      expect(h.enqueued[0]).toMatchObject({ format: 'carousel', aspectRatio: '9:16' });
      expect(h.streamCalls).toHaveLength(chamadasAoModelo);
      // O clique de controle não vira "pedido" dentro do briefing da geração.
      expect(h.enqueued[0].brief).not.toContain('Ativar regra de foto real');
      expect(h.enqueued[0].brief).toContain('cria um carrossel');
    });

    it('depois de ativada, as próximas gerações da conversa não perguntam de novo', async () => {
      h.streams.push(texto('Vou criar [DISPATCH:presentation]'));
      await send('cria uma apresentação');
      await send('Ativar regra de foto real');
      expect(h.enqueued).toHaveLength(1);

      h.streams.push(texto('Refazendo [DISPATCH:presentation]'));
      await send('refaz');
      expect(h.enqueued).toHaveLength(2);
      expect(h.session.activeQuestion).toBeFalsy();
    });

    it('qualquer outra resposta cancela a pausa: nada é gerado e a regra continua desligada', async () => {
      h.streams.push(texto('Vou criar [DISPATCH:presentation]'));
      await send('cria uma apresentação');
      h.streams.push(texto('Sem problema, me diga o que mudar.'));

      await send('espera, deixa eu pensar');

      expect(h.enqueued).toHaveLength(0);
      expect(h.session.pendingPhotoRule).toBeFalsy();
      expect(h.session.photoRule).toBeUndefined();
    });

    describe('[GENERATE_IMAGE] (Nano Banana pelo chat) e a regra de foto real', () => {
      const pedido = (t: string) => texto(`${t} [GENERATE_IMAGE:{"prompt":"mulher sorrindo numa mesa de escritório","id":"img1"}]`);
      const emitidos = () => wsOf('emit').map((c) => ({ evento: c.args[1], dados: c.args[2] }));

      it('com a regra ativada no chat: NÃO gera, e explica no cartão da proposta (nada de pessoa sintética)', async () => {
        const { generatePhotoBuffer } = await import('../lib/imageResolver.js');
        vi.mocked(generatePhotoBuffer).mockClear();
        h.session.photoRule = 'on';
        h.streams.push(pedido('Vou mostrar uma imagem.'));
        await send('gera uma imagem de uma mulher no escritório');
        await new Promise((r) => setTimeout(r, 20));

        expect(generatePhotoBuffer).not.toHaveBeenCalled();
        const ev = emitidos();
        expect(ev.map((e) => e.evento)).toEqual(expect.arrayContaining(['image:proposal:start', 'image:proposal:error']));
        expect(ev.find((e) => e.evento === 'image:proposal:error')!.dados).toMatchObject({ id: 'img1' });
        expect(String(ev.find((e) => e.evento === 'image:proposal:error')!.dados.message)).toContain('foto real');
        expect(ev.some((e) => e.evento === 'image:proposal:done')).toBe(false);
      });

      it('projeto que já tem as regras do Designer: recusa mesmo antes de a pessoa confirmar a regra', async () => {
        const { generatePhotoBuffer } = await import('../lib/imageResolver.js');
        vi.mocked(generatePhotoBuffer).mockClear();
        process.env.DESIGNER_BRAIN_BRANDS = 'marca';
        h.streams.push(pedido('Segue.'));
        await send('gera uma imagem');
        await new Promise((r) => setTimeout(r, 20));
        expect(generatePhotoBuffer).not.toHaveBeenCalled();
        expect(emitidos().some((e) => e.evento === 'image:proposal:error')).toBe(true);
      });

      it('sem regra ativa e sem as regras do projeto: segue como antes (a ferramenta ainda gera)', async () => {
        const { generatePhotoBuffer } = await import('../lib/imageResolver.js');
        vi.mocked(generatePhotoBuffer).mockClear();
        h.streams.push(pedido('Vou mostrar.'));
        await send('gera uma imagem de um cachorro');
        await new Promise((r) => setTimeout(r, 20));
        expect(generatePhotoBuffer).toHaveBeenCalledTimes(1);
      });
    });

    it('a nota do chat manda não usar [GENERATE_IMAGE] com a regra ligada', async () => {
      h.session.photoRule = 'on';
      h.streams.push(texto('Ok!'));
      await send('oi');
      expect(h.streamCalls[0]!.systemInstruction).toContain('NÃO use [GENERATE_IMAGE]');
    });

    it('com a regra ligada o chat deixa de oferecer IA/Remix/Unsplash (a nota de foto real vai ao modelo)', async () => {
      h.session.photoRule = 'on';
      h.streams.push(texto('Ok!'));
      await send('oi');
      const sys = h.streamCalls[0]!.systemInstruction;
      expect(sys).toContain('Regra desta conversa: fotografia real');
      expect(sys).not.toContain('NÃO dispare a geração sem o texto aprovado'); // isso é do cérebro completo, não da regra de foto
    });
  });

  describe('cérebro global (padrão): projeto SEM ficha tem as mesmas regras no chat', () => {
    const keys = ['DESIGNER_BRAIN_BRANDS', 'DESIGNER_BRAIN_GLOBAL'] as const;
    const originais = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    beforeEach(() => { delete h.session.photoRule; for (const k of keys) delete process.env[k]; });
    afterEach(() => {
      for (const k of keys) {
        if (originais[k] === undefined) delete process.env[k];
        else process.env[k] = originais[k];
      }
    });
    const pedido = (t: string) => texto(`${t} [GENERATE_IMAGE:{"prompt":"mulher sorrindo numa mesa de escritório","id":"img1"}]`);

    it('a primeira geração PARA e pede para CONFIRMAR a regra de foto real (não "ativar")', async () => {
      h.streams.push(texto('Vou criar [DISPATCH:presentation]'));
      await send('cria uma apresentação');

      expect(h.enqueued).toHaveLength(0);
      expect(h.session.activeQuestion.question).toContain('confirmo a regra de foto real');
      expect(h.session.activeQuestion.options[0].label).toBe('Confirmar regra de foto real');
    });

    it('a nota do chat traz a regra de foto real E a trava de texto aprovado', async () => {
      h.streams.push(texto('Ok!'));
      await send('oi');
      const sys = h.streamCalls[0]!.systemInstruction;
      expect(sys).toContain('Regra desta conversa: fotografia real');
      expect(sys).toContain('NÃO dispare a geração sem o texto aprovado');
    });

    it('[GENERATE_IMAGE] é recusado, sem a pessoa ter ativado nada', async () => {
      const { generatePhotoBuffer } = await import('../lib/imageResolver.js');
      vi.mocked(generatePhotoBuffer).mockClear();
      h.streams.push(pedido('Vou mostrar.'));
      await send('gera uma imagem de um cachorro');
      await new Promise((r) => setTimeout(r, 20));
      expect(generatePhotoBuffer).not.toHaveBeenCalled();
      expect(wsOf('emit').some((c) => c.args[1] === 'image:proposal:error')).toBe(true);
    });

    it('saída de emergência (DESIGNER_BRAIN_GLOBAL=off): o chat volta a ser o de antes (a ferramenta gera, a nota não aparece)', async () => {
      process.env.DESIGNER_BRAIN_GLOBAL = 'off';
      const { generatePhotoBuffer } = await import('../lib/imageResolver.js');
      vi.mocked(generatePhotoBuffer).mockClear();
      h.streams.push(texto('Ok!'));
      await send('oi');
      expect(h.streamCalls[0]!.systemInstruction).not.toContain('Regra desta conversa: fotografia real');
      h.streams.push(pedido('Vou mostrar.'));
      await send('gera uma imagem de um cachorro');
      await new Promise((r) => setTimeout(r, 20));
      expect(generatePhotoBuffer).toHaveBeenCalledTimes(1);
    });
  });

  describe('status por bloco (cérebro global, projeto sem ficha)', () => {
    const original = process.env.DESIGNER_BRAIN_BRANDS;
    const originalGlobal = process.env.DESIGNER_BRAIN_GLOBAL;
    beforeEach(() => { delete process.env.DESIGNER_BRAIN_BRANDS; delete process.env.DESIGNER_BRAIN_GLOBAL; });
    afterEach(() => {
      if (original === undefined) delete process.env.DESIGNER_BRAIN_BRANDS;
      else process.env.DESIGNER_BRAIN_BRANDS = original;
      if (originalGlobal === undefined) delete process.env.DESIGNER_BRAIN_GLOBAL;
      else process.env.DESIGNER_BRAIN_GLOBAL = originalGlobal;
    });

    it('o planner recebe só o texto aprovado; o texto com as marcas segue intacto para o pipeline', async () => {
      const planner = await import('../agents/planner/index');
      vi.mocked(planner.runPlanner).mockResolvedValueOnce([{ order: 1, title: 'Abertura', goal: 'g', layout_type: 'title-hero', copy: 'TITULO' }]);
      h.session.reviewMode = 'auto';
      h.streams.push(texto('Vou criar agora [DISPATCH:presentation]'));

      const bruto = '[APROVADO]\nTITULO\n[FALA]\nFALA-SECRETA\n[INTERNO]\nVALOR-INTERNO\n' + 'Texto de apoio longo. '.repeat(60);
      await send(bruto);

      const enviado = vi.mocked(planner.runPlanner).mock.calls.at(-1)![0] as { sourceCopy?: string };
      expect(enviado.sourceCopy).toContain('TITULO');
      expect(enviado.sourceCopy).not.toContain('FALA-SECRETA');
      expect(enviado.sourceCopy).not.toContain('VALOR-INTERNO');
      expect(h.enqueued[0].sourceCopy).toContain('FALA-SECRETA'); // o pipeline usa como orientação
    });

    it('saída de emergência: sem ficha e sem o slug na lista, o texto com as marcas segue inteiro ao planner (como antes)', async () => {
      process.env.DESIGNER_BRAIN_GLOBAL = 'off';
      const planner = await import('../agents/planner/index');
      vi.mocked(planner.runPlanner).mockResolvedValueOnce([{ order: 1, title: 'Abertura', goal: 'g', layout_type: 'title-hero', copy: 'TITULO' }]);
      h.session.reviewMode = 'auto';
      h.streams.push(texto('Vou criar agora [DISPATCH:presentation]'));

      await send(['[APROVADO]', 'TITULO', '[INTERNO]', 'VALOR-INTERNO', 'Texto de apoio longo. '.repeat(60)].join('\n'));

      const enviado = vi.mocked(planner.runPlanner).mock.calls.at(-1)![0] as { sourceCopy?: string };
      expect(enviado.sourceCopy).toContain('VALOR-INTERNO');
    });

    it('tudo marcado como fala/contexto: não gera e pede o texto aprovado', async () => {
      h.streams.push(texto('Vou criar agora [DISPATCH:presentation]'));

      await send('[FALA]\n' + 'Só falado, sem texto de slide. '.repeat(60));

      expect(h.enqueued).toHaveLength(0);
      expect(tokens()).toContain('marcado como fala, contexto, apoio ou interno');
      expect(h.session.phase).toBe('listening');
    });
  });

  describe('cérebro global: o texto interno e a regeneração, pelo caminho do chat', () => {
    const original = process.env.DESIGNER_BRAIN_BRANDS;
    const originalGlobal = process.env.DESIGNER_BRAIN_GLOBAL;
    beforeEach(() => { delete process.env.DESIGNER_BRAIN_BRANDS; delete process.env.DESIGNER_BRAIN_GLOBAL; });
    afterEach(() => {
      if (original === undefined) delete process.env.DESIGNER_BRAIN_BRANDS;
      else process.env.DESIGNER_BRAIN_BRANDS = original;
      if (originalGlobal === undefined) delete process.env.DESIGNER_BRAIN_GLOBAL;
      else process.env.DESIGNER_BRAIN_GLOBAL = originalGlobal;
      vi.mocked(prisma.brand.findUnique).mockReset();
      vi.mocked(prisma.brand.findUnique).mockResolvedValue(null as never);
    });

    const bruto = '[APROVADO]\nTITULO\n[INTERNO]\nVALOR-INTERNO\n[NÃO EXIBIR]\nSEGREDO-DO-CLIENTE\n' + 'Texto de apoio longo. '.repeat(60);
    const roteiro1 = [{ order: 1, title: 'Abertura', goal: 'g', layout_type: 'title-hero', copy: 'TITULO' }];
    const comFicha = () => vi.mocked(prisma.brand.findUnique).mockResolvedValue({
      name: 'Marca', kind: 'PROJECT', collab: null, profile: { data: { essence: 'ESSENCIA' } }, parent: null,
    } as never);

    it('(a) sem ficha, modo automático: o texto de [INTERNO]/[NÃO EXIBIR] não chega ao runPlanner nem à fila', async () => {
      const planner = await import('../agents/planner/index');
      vi.mocked(planner.runPlanner).mockResolvedValueOnce(roteiro1);
      h.session.reviewMode = 'auto';
      h.streams.push(texto('Vou criar agora [DISPATCH:presentation]'));

      await send(bruto);

      const chamada = vi.mocked(planner.runPlanner).mock.calls.at(-1)![0] as { brief: string; sourceCopy?: string };
      expect(chamada.brief).toContain('TITULO');
      expect(JSON.stringify(chamada)).not.toContain('VALOR-INTERNO');
      expect(JSON.stringify(chamada)).not.toContain('SEGREDO-DO-CLIENTE');
      expect(h.enqueued).toHaveLength(1);
      expect(h.enqueued[0].brief).toContain('TITULO');
      expect(h.enqueued[0].brief).not.toContain('VALOR-INTERNO');
      expect(h.enqueued[0].brief).not.toContain('SEGREDO-DO-CLIENTE');
      // A copy segue com as marcas: o pipeline as usa (fala/contexto como orientação) e limpa o resto.
      expect(h.enqueued[0].sourceCopy).toContain('VALOR-INTERNO');
    });

    it('(a) sem ficha, modo manual: o pendingPlan e a fila, depois de aprovar o roteiro, também vêm sem o texto interno', async () => {
      const planner = await import('../agents/planner/index');
      vi.mocked(planner.runPlanner).mockResolvedValueOnce(roteiro1);
      h.streams.push(texto('Vou criar agora [DISPATCH:presentation]'));

      await send(bruto);

      const chamada = vi.mocked(planner.runPlanner).mock.calls.at(-1)![0] as { brief: string };
      expect(chamada.brief).not.toContain('VALOR-INTERNO');
      expect(h.session.pendingPlan.brief).toContain('TITULO');
      expect(h.session.pendingPlan.brief).not.toContain('VALOR-INTERNO');
      expect(h.session.pendingPlan.brief).not.toContain('SEGREDO-DO-CLIENTE');
      expect(h.enqueued).toHaveLength(0);

      await send('Aprovar roteiro e gerar');

      expect(h.enqueued).toHaveLength(1);
      expect(h.enqueued[0].brief).not.toContain('VALOR-INTERNO');
      expect(h.enqueued[0].brief).not.toContain('SEGREDO-DO-CLIENTE');
    });

    it('(a) texto sem NENHUMA marca passa byte a byte pelo planner, pelo pendingPlan e pela fila', async () => {
      const planner = await import('../agents/planner/index');
      vi.mocked(planner.runPlanner).mockResolvedValueOnce(roteiro1);
      h.streams.push(texto('Vou criar agora [DISPATCH:presentation]'));
      const livre = 'Título livre\r\n\r\n  Texto com   espaços e [colchetes] no meio.\n' + 'Mais texto corrido. '.repeat(60);

      await send(livre);

      const chamada = vi.mocked(planner.runPlanner).mock.calls.at(-1)![0] as { brief: string };
      expect(chamada.brief).toBe(livre.trim());
      expect(h.session.pendingPlan.brief).toBe(livre.trim());
    });

    it('(a) COM ficha, modo automático: o texto de [INTERNO]/[NÃO EXIBIR] também não chega ao runPlanner nem à fila', async () => {
      comFicha();
      const planner = await import('../agents/planner/index');
      vi.mocked(planner.runPlanner).mockResolvedValueOnce(roteiro1);
      h.session.reviewMode = 'auto';
      h.streams.push(texto('Vou criar agora [DISPATCH:presentation]'));

      await send(bruto);

      const chamada = vi.mocked(planner.runPlanner).mock.calls.at(-1)![0] as { brief: string };
      expect(chamada.brief).toContain('TITULO');
      expect(JSON.stringify(chamada.brief)).not.toContain('VALOR-INTERNO');
      expect(JSON.stringify(chamada.brief)).not.toContain('SEGREDO-DO-CLIENTE');
      expect(h.enqueued).toHaveLength(1);
      expect(h.enqueued[0].brief).toContain('TITULO');
      expect(h.enqueued[0].brief).not.toContain('VALOR-INTERNO');
      expect(h.enqueued[0].brief).not.toContain('SEGREDO-DO-CLIENTE');
    });

    it('(a) COM ficha, modo manual: o pendingPlan e a fila, depois de aprovar o roteiro, vêm sem o texto interno', async () => {
      comFicha();
      const planner = await import('../agents/planner/index');
      vi.mocked(planner.runPlanner).mockResolvedValueOnce(roteiro1);
      h.streams.push(texto('Vou criar agora [DISPATCH:presentation]'));

      await send(bruto);

      expect(h.session.pendingPlan.brief).toContain('TITULO');
      expect(h.session.pendingPlan.brief).not.toContain('VALOR-INTERNO');
      expect(h.session.pendingPlan.brief).not.toContain('SEGREDO-DO-CLIENTE');
      await send('Aprovar roteiro e gerar');
      expect(h.enqueued[0].brief).not.toContain('VALOR-INTERNO');
      expect(h.enqueued[0].brief).not.toContain('SEGREDO-DO-CLIENTE');
    });

    it('(a) sem copy colada (fluxo direto), o [INTERNO] de uma mensagem curta também não vai para a fila, com e sem ficha', async () => {
      for (const ficha of [false, true]) {
        h.enqueued.length = 0;
        h.session.messages.length = 0;
        if (ficha) comFicha();
        h.streams.push(texto('Vou criar agora [DISPATCH:presentation]'));

        await send('Faça 3 slides.\n[INTERNO]\nORCAMENTO-SECRETO');

        expect(h.enqueued).toHaveLength(1);
        expect(h.enqueued[0].brief).toContain('Faça 3 slides.');
        expect(h.enqueued[0].brief).not.toContain('ORCAMENTO-SECRETO');
      }
    });

    it('(e) briefing SEM nenhuma marca passa byte a byte também COM ficha (planner, pendingPlan e fila)', async () => {
      comFicha();
      const planner = await import('../agents/planner/index');
      vi.mocked(planner.runPlanner).mockResolvedValueOnce(roteiro1);
      h.streams.push(texto('Vou criar agora [DISPATCH:presentation]'));
      const livre = 'Título livre\r\n\r\n  Texto com   espaços e [colchetes] no meio.\n' + 'Mais texto corrido. '.repeat(60);

      await send(livre);

      expect((vi.mocked(planner.runPlanner).mock.calls.at(-1)![0] as { brief: string }).brief).toBe(livre.trim());
      expect(h.session.pendingPlan.brief).toBe(livre.trim());
      await send('Aprovar roteiro e gerar');
      expect(h.enqueued[0].brief).toBe(livre.trim());
    });

    it('(d) saída de emergência (DESIGNER_BRAIN_GLOBAL=off), sem ficha: o briefing segue sem alteração', async () => {
      process.env.DESIGNER_BRAIN_GLOBAL = 'off';
      process.env.DESIGNER_BRAIN_BRANDS = 'marca';
      const planner = await import('../agents/planner/index');
      vi.mocked(planner.runPlanner).mockResolvedValueOnce(roteiro1);
      h.streams.push(texto('Vou criar agora [DISPATCH:presentation]'));

      await send(bruto);

      expect((vi.mocked(planner.runPlanner).mock.calls.at(-1)![0] as { brief: string }).brief).toBe(bruto.trim());
      expect(h.session.pendingPlan.brief).toBe(bruto.trim());
    });

    it('(c) regenerar tudo depois de recusar o resultado, sem ficha: enfileira com a copy e o roteiro aprovado, e a trava de texto aprovado não para', async () => {
      const planner = await import('../agents/planner/index');
      vi.mocked(planner.runPlanner).mockResolvedValueOnce(roteiro1);
      h.session.reviewMode = 'auto';
      h.streams.push(texto('Vou criar agora [DISPATCH:presentation]'));
      await send(bruto);
      expect(h.enqueued).toHaveLength(1);

      await h.handlers.get('review:decline')!(S, 'u1', { reason: 'Não gostei do fundo' });

      expect(h.enqueued).toHaveLength(2);
      const regeneracao = h.enqueued[1];
      expect(regeneracao.brief).toBe('Não gostei do fundo');
      expect(regeneracao.sourceCopy).toContain('TITULO');
      expect(regeneracao.approvedSkeleton).toEqual(roteiro1);
      // A trava do pipeline (a mesma função) deixa passar: há texto aprovado.
      expect(hasApprovedText({ sourceCopy: regeneracao.sourceCopy, approvedSkeleton: regeneracao.approvedSkeleton })).toBe(true);
    });

    it('(c) regenerar tudo sem roteiro aprovado guardado: leva a copy da sessão e o pipeline replaneja a partir dela', async () => {
      h.session.messages.push({ role: 'user', content: bruto, timestamp: 1 });

      await h.handlers.get('review:decline')!(S, 'u1', { reason: 'refaz' });

      expect(h.enqueued).toHaveLength(1);
      expect(h.enqueued[0].sourceCopy).toContain('TITULO');
      expect(h.enqueued[0].approvedSkeleton).toBeUndefined();
      expect(hasApprovedText({ sourceCopy: h.enqueued[0].sourceCopy })).toBe(true);
    });

    it('(c) regenerar tudo, COM ficha, também leva a copy e o roteiro aprovado', async () => {
      comFicha();
      const planner = await import('../agents/planner/index');
      vi.mocked(planner.runPlanner).mockResolvedValueOnce(roteiro1);
      h.session.reviewMode = 'auto';
      h.streams.push(texto('Vou criar agora [DISPATCH:presentation]'));
      await send(bruto);

      await h.handlers.get('review:decline')!(S, 'u1', { reason: 'refaz' });

      expect(h.enqueued[1].sourceCopy).toContain('TITULO');
      expect(h.enqueued[1].approvedSkeleton).toEqual(roteiro1);
    });

    it('(c) saída de emergência, sem ficha: a regeneração segue como antes (só brief e formato)', async () => {
      process.env.DESIGNER_BRAIN_GLOBAL = 'off';
      h.session.messages.push({ role: 'user', content: bruto, timestamp: 1 });

      await h.handlers.get('review:decline')!(S, 'u1', { reason: 'refaz' });

      expect(h.enqueued).toEqual([{ sessionId: S, brief: 'refaz', format: 'presentation' }]);
    });
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
