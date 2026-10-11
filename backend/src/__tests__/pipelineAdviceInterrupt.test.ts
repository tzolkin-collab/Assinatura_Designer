// Ponta a ponta do pipeline com TUDO de fora mockado (banco, Redis, WebSocket, Gemini):
// orientações consumidas por lote, expiração no fim, e interrupção cooperativa que
// preserva os slides gerados. O que roda de verdade: runPipeline, o gerador de lotes
// (htmlDesign), o serviço de orientações e o de interrupção — sobre stores em memória
// com a mesma semântica atômica do Redis.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => {
  const state = {
    session: {} as Record<string, any>,
    wsCalls: [] as Array<{ fn: string; args: any[] }>,
    prompts: [] as Array<{ start: number; user: string; sys: string }>,
    modelCalls: 0,
    onModelCall: null as null | ((n: number) => Promise<void> | void),
    reviewerBriefs: [] as string[],
    onReviewer: null as null | (() => Promise<void> | void),
    onImages: null as null | (() => Promise<void> | void),
    closedRuns: [] as Array<{ runId: string; params: any }>,
    postUpdates: [] as any[],
    postCreates: [] as any[],
    synced: [] as any[],
    slideCount: 12,
  };
  return state;
});

vi.mock('../lib/prisma.js', () => ({
  default: {
    post: {
      create: vi.fn(async (a: any) => { h.postCreates.push(a); return {}; }),
      update: vi.fn(async (a: any) => { h.postUpdates.push(a); return {}; }),
    },
    slide: { findFirst: vi.fn(async () => ({ id: 'slide-row' })), update: vi.fn(async () => ({})) },
    asset: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock('../lib/redis.js', () => ({
  getSession: vi.fn(async () => ({ ...h.session })),
  updateSession: vi.fn(async (_id: string, patch: Record<string, any>) => { Object.assign(h.session, patch); }),
  getBrandMemory: vi.fn(async () => ({ brandSlug: 'marca', pastPresentations: [], preferences: {}, updatedAt: 0 })),
  updateBrandMemory: vi.fn(async () => {}),
}));

vi.mock('../lib/websocket.js', () => {
  const rec = (fn: string) => (...args: any[]) => { h.wsCalls.push({ fn, args }); };
  return {
    ws: {
      emit: rec('emit'), progress: rec('progress'), sessionState: rec('sessionState'),
      designSlide: rec('designSlide'), token: rec('token'), done: rec('done'),
      notify: rec('notify'), error: rec('error'), interrupted: rec('interrupted'),
    },
  };
});

vi.mock('../lib/brandContext.js', () => ({
  resolveBrandContext: vi.fn(async () => ({
    id: 'brand-1', name: 'Marca X', slug: h.session.brandSlug, agentPrompt: '', guidelines: 'DIRETRIZ-LEGADA', colors: ['#111111'], primaryFonts: ['Inter'], assetUrls: [], references: [],
  })),
  buildBrandContextSummary: vi.fn(() => 'contexto da marca'),
}));

vi.mock('../agents/tools/index.js', () => ({
  executeTool: vi.fn(async (_n: string, args: any) => args.pages),
}));

vi.mock('../agents/planner/index.js', () => ({
  MAX_SLIDES: 200,
  runPlanner: vi.fn(async () => Array.from({ length: h.slideCount }, (_, i) => ({
    title: `Slide ${i + 1}`, goal: 'Objetivo', layout_type: 'content-split', order: i + 1,
  }))),
}));

vi.mock('../agents/reviewer/index.js', () => ({
  runHtmlReviewer: vi.fn(async (_design: unknown, _ctx: string, brief: string) => {
    h.reviewerBriefs.push(brief);
    await h.onReviewer?.();
    return { approved: true, score: 90, deviations: [], feedback: 'ok' };
  }),
}));

vi.mock('../lib/postHelper.js', () => ({
  syncPostSlides: vi.fn(async (postId: string, content: any) => { h.synced.push({ postId, content }); }),
}));

vi.mock('../lib/fabricaLegacy.js', () => ({ researchBrand: vi.fn(async () => ({ summary: '', refs: [] })) }));

vi.mock('../lib/imageResolver.js', () => ({
  resolveSlideImages: vi.fn(async () => {
    await h.onImages?.();
    return { resolved: new Map(), pendingCandidates: [] };
  }),
  resolveImageCandidateDecisions: vi.fn(async () => new Map()),
}));

vi.mock('../lib/geminiRetry.js', () => ({
  humanizeGeminiError: (e: unknown) => String(e),
  generateWithRetry: vi.fn(async (_ai: unknown, opts: { contents: string; config?: { systemInstruction?: string } }) => {
    const user = opts.contents;
    const m = user.match(/Gere os slides de (\d+) a (\d+)/);
    const start = m ? parseInt(m[1]!, 10) : 1;
    const end = m ? parseInt(m[2]!, 10) : 1;
    h.prompts.push({ start, user, sys: String(opts.config?.systemInstruction ?? '') });
    h.modelCalls++;
    await h.onModelCall?.(h.modelCalls);
    return {
      text: JSON.stringify({
        reasoning: 'direção', fonts: ['Inter'],
        slides: Array.from({ length: end - start + 1 }, (_, i) => ({ html: `<div>Slide ${start + i}</div>`, css: '' })),
      }),
      candidates: [{ finishReason: 'STOP' }],
    };
  }),
}));

vi.mock('../lib/generationTracing.js', () => ({
  openRun: vi.fn(async () => 'run-1'),
  closeRun: vi.fn(async (runId: string, params: any) => { h.closedRuns.push({ runId, params }); }),
}));

vi.mock('../lib/queue.js', () => ({ enqueueAssetCapture: vi.fn(async () => {}) }));

import { runPipeline, INTERRUPTED_RUN_PREFIX } from '../agents/pipeline';
import { setAdviceStore, submitAdvice, listAdvice, type AdviceItem } from '../lib/advice';
import { setInterruptStore, requestInterrupt, getInterruptState } from '../lib/interrupt';
import { createMemoryAdviceStore, createMemoryInterruptStore } from './helpers/memoryLiveControl';
import { config } from '../config';
import { runPlanner } from '../agents/planner/index.js';
import { resolveSlideImages } from '../lib/imageResolver.js';

const S = 'sessao-e2e';
const POST = 'post-e2e-1';
const busy = async () => true;
const advId = (n: number) => `advice-000000${n}`;

let adviceStore: ReturnType<typeof createMemoryAdviceStore>;
let interruptStore: ReturnType<typeof createMemoryInterruptStore>;

const wsOf = (fn: string) => h.wsCalls.filter((c) => c.fn === fn);
const emitsOf = (type: string) => wsOf('emit').filter((c) => c.args[1] === type).map((c) => c.args[2]);
const promptOf = (start: number) => h.prompts.find((p) => p.start === start)!.user;

async function rodar() {
  await runPipeline({ sessionId: S, brief: 'Apresentação de teste', format: 'presentation', postId: POST });
}

beforeEach(() => {
  h.wsCalls.length = 0;
  h.prompts.length = 0;
  h.reviewerBriefs.length = 0;
  h.closedRuns.length = 0;
  h.postUpdates.length = 0;
  h.postCreates.length = 0;
  h.synced.length = 0;
  h.modelCalls = 0;
  h.onModelCall = null;
  h.onReviewer = null;
  h.onImages = null;
  h.slideCount = 12; // 12 slides em lotes de 3 = 4 lotes
  h.session = {
    id: S, brandSlug: 'marca', userId: 'u1', phase: 'ready', workerStatus: 'running', reviewMode: 'auto',
    messages: [], currentDesign: [], folderId: null, createdAt: 0, updatedAt: 0,
  };
  adviceStore = createMemoryAdviceStore();
  interruptStore = createMemoryInterruptStore();
  setAdviceStore(adviceStore);
  setInterruptStore(interruptStore);
  // Lotes em série: a ordem dos lotes fica determinística para o teste.
  config.generationConcurrency = 1;
});

describe('orientações ao longo da geração', () => {
  it('2 orientações enfileiradas durante o lote 2 são consumidas no início do lote 3, valem para o 4, e mudam de status', async () => {
    h.onModelCall = async (n) => {
      if (n === 2) { // lote 2 em andamento: o usuário digita duas orientações
        await submitAdvice({ sessionId: S, id: advId(1), text: 'use fundo escuro', origin: 'aba-1', isBusy: busy });
        await submitAdvice({ sessionId: S, id: advId(2), text: 'títulos maiores', origin: 'aba-1', isBusy: busy });
      }
    };

    await rodar();

    // Lotes 1 e 2 (já saídos ou em andamento) não as viram; 3 e 4 sim.
    expect(promptOf(1)).not.toContain('use fundo escuro');
    expect(promptOf(4)).not.toContain('use fundo escuro');
    expect(promptOf(7)).toContain('use fundo escuro');
    expect(promptOf(7)).toContain('títulos maiores');
    expect(promptOf(10)).toContain('use fundo escuro');

    const items = await listAdvice(S);
    expect(items).toHaveLength(2);
    for (const i of items) {
      expect(i).toMatchObject({ status: 'applied', stage: 'lote 3 de 4', scope: POST });
      expect(i.appliedAt).toBeTypeOf('number');
    }
    // eventos: um advice.applied por item, com a etapa
    const applied = emitsOf('advice.applied').map((d) => d.item);
    expect(applied.map((i: AdviceItem) => i.text)).toEqual(['use fundo escuro', 'títulos maiores']);
    expect(applied.every((i: AdviceItem) => i.stage === 'lote 3 de 4')).toBe(true);
    // e a geração terminou normalmente
    expect(wsOf('done')).toHaveLength(1);
    expect(wsOf('interrupted')).toHaveLength(0);
  });

  it('a orientação que chega durante o último lote é aplicada no REVISOR, e o revisor a recebe no brief', async () => {
    h.onModelCall = async (n) => {
      if (n === 1) await submitAdvice({ sessionId: S, id: advId(1), text: 'sem fotos', isBusy: busy });
      if (n === 4) await submitAdvice({ sessionId: S, id: advId(2), text: 'CTA no último slide', isBusy: busy });
    };

    await rodar();

    const items = await listAdvice(S);
    expect(items.find((i) => i.id === advId(1))).toMatchObject({ status: 'applied', stage: 'lote 2 de 4' });
    expect(items.find((i) => i.id === advId(2))).toMatchObject({ status: 'applied', stage: 'revisor' });
    // o revisor julga contra TUDO que valia no deck, não só o que chegou por último
    expect(h.reviewerBriefs).toHaveLength(1);
    expect(h.reviewerBriefs[0]).toContain('sem fotos');
    expect(h.reviewerBriefs[0]).toContain('CTA no último slide');
  });

  it('orientação chegando DEPOIS do revisor (exatamente no fim) EXPIRA e vai de volta ao autor — nada some', async () => {
    h.onReviewer = async () => {
      await submitAdvice({ sessionId: S, id: advId(1), text: 'chegou tarde', origin: 'aba-7', isBusy: busy });
    };

    await rodar();

    const [item] = await listAdvice(S);
    expect(item).toMatchObject({ id: advId(1), text: 'chegou tarde', status: 'expired', expireReason: 'ended', origin: 'aba-7' });
    const expirados = emitsOf('advice.expired');
    expect(expirados).toHaveLength(1);
    expect(expirados[0].item).toMatchObject({ text: 'chegou tarde', origin: 'aba-7' });
    // o fim da geração continua sendo o fim normal
    expect(wsOf('done')).toHaveLength(1);
  });

  it('o que já valia para ESTE deck antes desta execução (retry/retomada) entra no primeiro lote', async () => {
    await adviceStore.add(S, { id: advId(1), text: 'tom mais formal', createdAt: 1, status: 'pending' });
    await adviceStore.settle(S, 'applied', { now: 2, stage: 'lote 3 de 4', scope: POST });
    // e uma de OUTRO deck, que não pode vazar
    await adviceStore.add(S, { id: advId(2), text: 'coisa do deck antigo', createdAt: 3, status: 'pending' });
    await adviceStore.settle(S, 'applied', { now: 4, stage: 'lote 1 de 4', scope: 'outro-deck' });

    await rodar();

    expect(promptOf(1)).toContain('tom mais formal');
    expect(promptOf(1)).not.toContain('coisa do deck antigo');
    // orientação de deck antigo some da lista quando um deck novo começa
    expect((await listAdvice(S)).map((i) => i.id)).toEqual([advId(1)]);
  });

  it('nenhum lote perde orientação com lotes PARALELOS: cada item é aplicado exatamente uma vez', async () => {
    config.generationConcurrency = 3;
    h.slideCount = 30; // 10 lotes
    h.onModelCall = async (n) => {
      if (n === 1) {
        for (let k = 1; k <= 4; k++) {
          await submitAdvice({ sessionId: S, id: advId(k), text: `orientação ${k}`, isBusy: busy });
        }
      }
    };

    await rodar();

    const aplicadas = emitsOf('advice.applied').map((d) => d.item.id);
    expect([...aplicadas].sort()).toEqual([advId(1), advId(2), advId(3), advId(4)]);
    expect(new Set(aplicadas).size).toBe(4);
    config.generationConcurrency = 1;
  });
});

describe('cancelamento cooperativo (Pausar e enviar)', () => {
  it('pedido durante o lote 2: para no limite do lote 3, PRESERVA os 6 slides prontos e não roda o revisor', async () => {
    h.onModelCall = async (n) => { if (n === 2) await requestInterrupt(S); };

    await rodar();

    // só 2 lotes saíram do modelo; o 3 nunca começou
    expect(h.modelCalls).toBe(2);
    expect(h.reviewerBriefs).toHaveLength(0);

    // o deck é salvo como deck de verdade, com os slides que existiam
    expect(h.synced).toHaveLength(1);
    expect(h.synced[0].content.slides).toHaveLength(6);
    expect(h.synced[0].content.slides[5].html).toContain('Slide 6');
    const final = h.postUpdates.at(-1)!;
    expect(final.data.status).toBe('READY');

    // avisa onde parou
    const [ev] = wsOf('interrupted');
    expect(ev!.args[1]).toMatchObject({ stage: 'antes do lote 3 de 4', slidesKept: 6, total: 12, postId: POST });
    expect(wsOf('done')).toHaveLength(0);
    expect(wsOf('error')).toHaveLength(0);

    // a flag vira `stopped` com o ponto — é o que o handler de "Pausar e enviar" espera
    expect(await getInterruptState(S)).toMatchObject({ state: 'stopped', stage: 'antes do lote 3 de 4', slidesKept: 6, total: 12 });

    // sessão volta a ouvir (e SEM `done`)
    expect(h.session.workerStatus).toBe('idle');
    expect(h.session.phase).toBe('listening');
    expect(h.session.pendingReview).toBeUndefined();
  });

  it('o run é fechado como COMPLETED com o motivo no `error` (o schema não tem CANCELLED) — nunca FAILED', async () => {
    h.onModelCall = async (n) => { if (n === 2) await requestInterrupt(S); };

    await rodar();

    expect(h.closedRuns).toHaveLength(1);
    const { params } = h.closedRuns[0]!;
    expect(params.status).toBe('COMPLETED');
    expect(params.error).toBe(`${INTERRUPTED_RUN_PREFIX}: antes do lote 3 de 4; 6 de 12 slides mantidos`);
  });

  it('orientações pendentes NÃO são varridas na interrupção: ficam para o handler levá-las com a mensagem', async () => {
    h.onModelCall = async (n) => {
      if (n === 2) {
        await submitAdvice({ sessionId: S, id: advId(1), text: 'pendente na hora do corte', isBusy: busy });
        await requestInterrupt(S);
      }
    };

    await rodar();

    expect((await listAdvice(S))[0]).toMatchObject({ status: 'pending' });
    expect(emitsOf('advice.expired')).toHaveLength(0);
    expect(emitsOf('advice.applied')).toHaveLength(0); // parar vem antes de drenar
  });

  it('pedido antes de qualquer trabalho: para no planejamento, sem criar o deck', async () => {
    await requestInterrupt(S);

    await rodar();

    expect(h.postCreates).toHaveLength(0);
    expect(h.modelCalls).toBe(0);
    expect(wsOf('interrupted')[0]!.args[1]).toMatchObject({ stage: 'antes do planejamento', slidesKept: 0 });
    expect(h.session.workerStatus).toBe('idle');
  });

  it('pedido durante as imagens (deck criado, zero slides): para antes de gerar e marca o deck FAILED, como a parada dura', async () => {
    h.onImages = async () => { await requestInterrupt(S); };

    await rodar();

    expect(h.postCreates).toHaveLength(1);
    expect(h.modelCalls).toBe(0);
    expect(h.postUpdates.at(-1)!.data.status).toBe('FAILED');
    expect(h.synced).toHaveLength(0);
    expect(wsOf('interrupted')[0]!.args[1]).toMatchObject({ stage: 'antes de gerar os slides', slidesKept: 0, total: 12 });
    expect(h.closedRuns[0]!.params.status).toBe('COMPLETED');
    expect(h.closedRuns[0]!.params.error).toContain(INTERRUPTED_RUN_PREFIX);
  });

  it('pedido durante o ÚLTIMO lote: o deck completo é salvo, sem revisor, e conta 12 de 12', async () => {
    h.onModelCall = async (n) => { if (n === 4) await requestInterrupt(S); };

    await rodar();

    expect(h.modelCalls).toBe(4);
    expect(h.reviewerBriefs).toHaveLength(0);
    expect(h.synced[0].content.slides).toHaveLength(12);
    expect(wsOf('interrupted')[0]!.args[1]).toMatchObject({ stage: 'antes do revisor', slidesKept: 12, total: 12 });
  });

  it('sem pedido, nada muda: geração completa, revisor roda, `done` é emitido e o run fecha limpo', async () => {
    await rodar();

    expect(h.modelCalls).toBe(4);
    expect(h.reviewerBriefs).toHaveLength(1);
    expect(h.reviewerBriefs[0]).toBe('Apresentação de teste'); // sem orientações o brief do revisor é o original
    expect(wsOf('done')).toHaveLength(1);
    expect(h.closedRuns[0]!.params).toEqual({ status: 'COMPLETED' });
    expect(interruptStore.raw.size).toBe(0);
  });
});

describe('cérebro do Designer ligado por marca (DESIGNER_BRAIN_BRANDS)', () => {
  const original = process.env.DESIGNER_BRAIN_BRANDS;
  const GLOBAL = 'Você é a inteligência de direção de arte do sistema Designer';

  beforeEach(() => {
    vi.mocked(runPlanner).mockClear();
    vi.mocked(resolveSlideImages).mockClear();
    h.slideCount = 3; // um lote só
  });

  afterEach(() => {
    if (original === undefined) delete process.env.DESIGNER_BRAIN_BRANDS;
    else process.env.DESIGNER_BRAIN_BRANDS = original;
  });

  it('desligado (padrão): nada muda — diretrizes legadas, sem cérebro, geração de foto como antes', async () => {
    delete process.env.DESIGNER_BRAIN_BRANDS;
    await rodar();

    const planner = vi.mocked(runPlanner).mock.calls[0]![0] as { brandContext: string };
    expect(planner.brandContext).toBe('contexto da marca');
    expect(h.prompts[0]!.sys).not.toContain(GLOBAL);
    expect(promptOf(1)).toContain('Diretrizes: DIRETRIZ-LEGADA');
    const resolver = vi.mocked(resolveSlideImages).mock.calls[0]![0] as { allowGeneratedGraphics?: boolean };
    expect(resolver.allowGeneratedGraphics).toBeUndefined();
  });

  it('ligado: planner e artista recebem as camadas, e o legado sai de cena', async () => {
    process.env.DESIGNER_BRAIN_BRANDS = 'amanda-coelho';
    h.session.brandSlug = 'amanda-coelho'; // tem seed de memória
    await rodar();

    const planner = vi.mocked(runPlanner).mock.calls[0]![0] as { brandContext: string };
    expect(planner.brandContext).toContain(GLOBAL);
    expect(planner.brandContext).toContain('#410C1C'); // memória da Amanda
    expect(planner.brandContext).toContain('MODO: APRESENTAÇÃO');

    // O artista é quem escreve o HTML: o cérebro tem de chegar nele, antes da mecânica de saída.
    const sys = h.prompts[0]!.sys;
    expect(sys.startsWith(GLOBAL)).toBe(true);
    expect(sys).toContain('REGRA DE FOTOGRAFIA PARA ESTA PEÇA');
    expect(sys).toContain('MECÂNICA DE SAÍDA');
    expect(promptOf(1)).not.toContain('DIRETRIZ-LEGADA');
  });

  it('ligado: o resolver de imagens não pode gerar foto nem buscar no Unsplash', async () => {
    process.env.DESIGNER_BRAIN_BRANDS = 'amanda-coelho';
    h.session.brandSlug = 'amanda-coelho';
    await rodar();

    const resolver = vi.mocked(resolveSlideImages).mock.calls[0]![0] as { allowGeneratedGraphics?: boolean };
    expect(resolver.allowGeneratedGraphics).toBe(false);
  });

  it('ligado sem memória de projeto: erro visível, e a geração não segue com as regras erradas', async () => {
    process.env.DESIGNER_BRAIN_BRANDS = 'marca-sem-memoria';
    h.session.brandSlug = 'marca-sem-memoria';
    await rodar();

    const erro = wsOf('error');
    expect(erro).toHaveLength(1);
    expect(String(erro[0]!.args[1])).toContain('não tem memória de projeto');
    expect(h.modelCalls).toBe(0);
    expect(vi.mocked(runPlanner)).not.toHaveBeenCalled();
  });
});
