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
    savedProfile: null as Record<string, unknown> | null,
    profileLookupError: null as unknown,
    withEmptySlot: false,
    brandRow: null as Record<string, unknown> | null,
    contentsSeen: [] as any[],
    agentPrompt: '',
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
    brand: {
      findUnique: vi.fn(async () => {
        if (h.profileLookupError) throw h.profileLookupError;
        if (h.brandRow) return h.brandRow;
        return h.savedProfile ? { name: 'Marca X', kind: 'BASE', collab: null, profile: { data: h.savedProfile }, parent: null } : null;
      }),
    },
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
    id: 'brand-1', name: 'Marca X', slug: h.session.brandSlug, agentPrompt: h.agentPrompt, guidelines: 'DIRETRIZ-LEGADA', colors: ['#111111'], primaryFonts: ['Inter'], assetUrls: [], libraryBrandIds: ['brand-1'],
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
  generateWithRetry: vi.fn(async (_ai: unknown, opts: { contents: string | Array<{ parts: Array<{ text?: string }> }>; config?: { systemInstruction?: string } }) => {
    h.contentsSeen.push(opts.contents);
    // Com moodboard, o conteúdo vai como partes (texto + imagem); o prompt segue sendo a primeira parte.
    const user = typeof opts.contents === 'string' ? opts.contents : String(opts.contents[0]?.parts[0]?.text ?? '');
    const m = user.match(/Gere os slides de (\d+) a (\d+)/);
    const start = m ? parseInt(m[1]!, 10) : 1;
    const end = m ? parseInt(m[2]!, 10) : 1;
    h.prompts.push({ start, user, sys: String(opts.config?.systemInstruction ?? '') });
    h.modelCalls++;
    await h.onModelCall?.(h.modelCalls);
    return {
      text: JSON.stringify({
        reasoning: 'direção', fonts: ['Inter'],
        slides: Array.from({ length: end - start + 1 }, (_, i) => ({ html: `<div>Slide ${start + i}</div>${h.withEmptySlot ? '<div data-photo-slot="1" style="background:linear-gradient(red,blue)"></div>' : ''}`, css: '' })),
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
import { openRun } from '../lib/generationTracing';
import { logger } from '../lib/logger';
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

// O cérebro é global (vale em todo projeto, com ou sem ficha) e uma geração sem texto aprovado para e pede o
// texto. Estas suítes testam orientações, pausa e interrupção, não a trava de texto: o harness entrega a copy,
// como a Fábrica entrega, e o cérebro roda de verdade com o padrão ligado.
/** Prisma P2021: a tabela não existe (migration ainda não aplicada). O P2022 (coluna) é tratado igual. */
function tabelaInexistente() {
  return Object.assign(new Error('The table `public.BrandProfile` does not exist in the current database.'), { code: 'P2021' });
}

async function rodar() {
  await runPipeline({ sessionId: S, brief: 'Apresentação de teste', format: 'presentation', postId: POST, sourceCopy: 'texto aprovado' });
}

/** Geração SEM nenhum texto aprovado (sem copy nem roteiro aprovado): é o que a trava de texto barra. */
async function rodarSemTexto() {
  await runPipeline({ sessionId: S, brief: 'Apresentação de teste', format: 'presentation', postId: POST });
}

beforeEach(() => {
  h.savedProfile = null;
  h.profileLookupError = null;
  h.withEmptySlot = false;
  h.brandRow = null;
  h.agentPrompt = '';
  h.wsCalls.length = 0;
  h.prompts.length = 0;
  h.contentsSeen.length = 0;
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

// Estes testes descrevem o comportamento ANTERIOR ao cérebro global: o cérebro só liga com ficha salva ou com o
// slug em DESIGNER_BRAIN_BRANDS. Assumiam "desligado por padrão", o que deixou de ser verdade; agora rodam com a
// saída de emergência DESIGNER_BRAIN_GLOBAL=off e provam que ela devolve o comportamento anterior. O padrão
// (cérebro global ligado) é coberto na suíte seguinte.
describe('cérebro do Designer com a saída de emergência (DESIGNER_BRAIN_GLOBAL=off): ficha ou DESIGNER_BRAIN_BRANDS', () => {
  const original = process.env.DESIGNER_BRAIN_BRANDS;
  const originalGlobal = process.env.DESIGNER_BRAIN_GLOBAL;
  const GLOBAL = 'Você é a inteligência de direção de arte do sistema Designer';

  beforeEach(() => {
    process.env.DESIGNER_BRAIN_GLOBAL = 'off';
    vi.mocked(runPlanner).mockReset();
    vi.mocked(resolveSlideImages).mockClear();
    h.slideCount = 3; // um lote só
  });

  // O planner distribui a copy aprovada pelos slides (modo roteirista). O artista do harness
  // escreve "Slide N" em cada um, então copy "Slide N" confere e qualquer outra não.
  const roteiro = (copy: (i: number) => string) =>
    Array.from({ length: 3 }, (_, i) => ({
      title: `Slide ${i + 1}`, goal: 'Objetivo', layout_type: 'content-split', order: i + 1, copy: copy(i),
    }));
  async function rodarComCopia(copy: (i: number) => string = (i) => `Slide ${i + 1}`) {
    vi.mocked(runPlanner).mockResolvedValue(roteiro(copy) as never);
    await runPipeline({ sessionId: S, brief: 'Apresentação de teste', format: 'presentation', postId: POST, sourceCopy: 'texto aprovado' });
  }

  afterEach(() => {
    if (original === undefined) delete process.env.DESIGNER_BRAIN_BRANDS;
    else process.env.DESIGNER_BRAIN_BRANDS = original;
    if (originalGlobal === undefined) delete process.env.DESIGNER_BRAIN_GLOBAL;
    else process.env.DESIGNER_BRAIN_GLOBAL = originalGlobal;
  });

  it('desligado (saída de emergência): nada muda — diretrizes legadas, sem cérebro, geração de foto como antes', async () => {
    delete process.env.DESIGNER_BRAIN_BRANDS;
    vi.mocked(runPlanner).mockResolvedValue(roteiro(() => '') as never);
    await rodar();

    const planner = vi.mocked(runPlanner).mock.calls[0]![0] as { brandContext: string };
    expect(planner.brandContext).toBe('contexto da marca');
    expect(h.prompts[0]!.sys).not.toContain(GLOBAL);
    expect(h.prompts[0]!.sys).not.toContain('data-photo-slot'); // marcas sem o cérebro não mudam
    expect(promptOf(1)).toContain('Diretrizes: DIRETRIZ-LEGADA');
    const resolver = vi.mocked(resolveSlideImages).mock.calls[0]![0] as { allowGeneratedGraphics?: boolean };
    expect(resolver.allowGeneratedGraphics).toBeUndefined();
  });

  it('regra de foto real ativada no chat, projeto SEM ficha: só foto real, o artista recebe a regra e as diretrizes do projeto continuam', async () => {
    delete process.env.DESIGNER_BRAIN_BRANDS;
    h.session.photoRule = 'on';
    vi.mocked(runPlanner).mockResolvedValue(roteiro(() => '') as never);
    await rodar();

    const resolver = vi.mocked(resolveSlideImages).mock.calls[0]![0] as { allowGeneratedGraphics?: boolean; onlyProvidedAssets?: boolean };
    expect(resolver.allowGeneratedGraphics).toBe(false);
    expect(resolver.onlyProvidedAssets).toBe(true);
    // O artista recebe a regra de fotografia e o contrato do espaço de foto (a foto entra depois, no editor)...
    expect(h.prompts[0]!.sys).toContain('REGRA DE FOTOGRAFIA PARA ESTA PEÇA');
    expect(h.prompts[0]!.sys).toContain('data-photo-slot');
    // ...mas isto NÃO é o cérebro completo: as diretrizes do projeto seguem como eram e não há trava de texto.
    expect(promptOf(1)).toContain('Diretrizes: DIRETRIZ-LEGADA');
    expect(h.prompts[0]!.sys).not.toContain(GLOBAL);
    // O contexto do planner e do revisor segue o do projeto, MAIS a regra e a nota de que a área de foto vazia é intencional.
    const planner = vi.mocked(runPlanner).mock.calls[0]![0] as { brandContext: string };
    expect(planner.brandContext).toContain('contexto da marca');
    expect(planner.brandContext).toContain('REGRA DE FOTOGRAFIA PARA ESTA PEÇA');
    expect(planner.brandContext).toContain('INTENCIONAIS');
    expect(wsOf('error')).toHaveLength(0);
  });

  it('regra ativada no chat: o espaço de foto vazio ganha a moldura PADRÃO, igual em todos os slides', async () => {
    delete process.env.DESIGNER_BRAIN_BRANDS;
    h.session.photoRule = 'on';
    h.withEmptySlot = true;
    vi.mocked(runPlanner).mockResolvedValue(roteiro(() => '') as never);
    await rodar();
    const slides = h.synced[0].content.slides as Array<{ html: string }>;
    expect(slides.length).toBeGreaterThan(0);
    for (const sl of slides) {
      expect(sl.html).toContain('data-photo-empty'); // moldura do sistema, não o quadro que o artista inventou
      expect(sl.html).toContain('rgba(128,128,128,.42)'); // as diagonais da moldura padrão, que vêm depois e prevalecem sobre o estilo do artista
    }
  });

  it('sem a regra ativada, o espaço de foto fica como o artista desenhou (nada muda)', async () => {
    delete process.env.DESIGNER_BRAIN_BRANDS;
    delete h.session.photoRule;
    h.withEmptySlot = true;
    vi.mocked(runPlanner).mockResolvedValue(roteiro(() => '') as never);
    await rodar();
    for (const sl of h.synced[0].content.slides as Array<{ html: string }>) expect(sl.html).not.toContain('data-photo-empty');
  });

  it('sem a regra ativada (conversa antiga), nada muda: o resolver segue como antes', async () => {
    delete process.env.DESIGNER_BRAIN_BRANDS;
    delete h.session.photoRule;
    vi.mocked(runPlanner).mockResolvedValue(roteiro(() => '') as never);
    await rodar();
    const resolver = vi.mocked(resolveSlideImages).mock.calls[0]![0] as { allowGeneratedGraphics?: boolean; onlyProvidedAssets?: boolean };
    expect(resolver.allowGeneratedGraphics).toBeUndefined();
    expect(resolver.onlyProvidedAssets).toBeFalsy();
    expect(h.prompts[0]!.sys).not.toContain('REGRA DE FOTOGRAFIA PARA ESTA PEÇA');
  });

  it('ligado: planner e artista recebem as camadas, e o legado sai de cena', async () => {
    process.env.DESIGNER_BRAIN_BRANDS = 'amanda-coelho';
    h.session.brandSlug = 'amanda-coelho'; // tem seed de memória
    await rodarComCopia();

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
    // E o contrato do espaço de foto, que o editor usa para trocar a foto depois.
    expect(sys).toContain('data-photo-slot');
  });

  it('ficha salva liga o cérebro sem a flag, e as regras vêm da ficha (não do seed nem das diretrizes antigas)', async () => {
    delete process.env.DESIGNER_BRAIN_BRANDS;
    h.session.brandSlug = 'marca-com-ficha';
    h.savedProfile = {
      essence: 'ESSENCIA-DA-FICHA',
      palette: [{ hex: '#123456', name: 'Azul ficha' }],
      neverDo: ['NUNCA-DA-FICHA'],
    };
    await rodarComCopia();

    const planner = vi.mocked(runPlanner).mock.calls[0]![0] as { brandContext: string };
    expect(planner.brandContext).toContain(GLOBAL);
    expect(planner.brandContext).toContain('ESSENCIA-DA-FICHA');
    expect(planner.brandContext).toContain('#123456');
    expect(planner.brandContext).toContain('NUNCA-DA-FICHA');
    expect(planner.brandContext).not.toContain('DIRETRIZ-LEGADA');
    expect(h.prompts[0]!.sys.startsWith(GLOBAL)).toBe(true);
    const resolver = vi.mocked(resolveSlideImages).mock.calls[0]![0] as { allowGeneratedGraphics?: boolean };
    expect(resolver.allowGeneratedGraphics).toBe(false);
  });

  it('desdobramento: a ficha é a da base, a camada de collab traz só o que muda, e o parceiro entra nos ativos', async () => {
    delete process.env.DESIGNER_BRAIN_BRANDS;
    h.session.brandSlug = 'base-collab-parceiro';
    h.brandRow = {
      name: 'Base + Parceiro',
      kind: 'PARTNERSHIP',
      collab: {
        context: 'CONTEXTO-DO-COLLAB',
        partner: { name: 'Estadão', logoUrl: 'https://cdn.example/estadao.png' },
        baseProtagonism: 70,
      },
      profile: { data: { essence: 'ESSENCIA-DO-DESDOBRAMENTO' } },
      parent: { name: 'Base', slug: 'base', profile: { data: { essence: 'ESSENCIA-DA-BASE', collabRules: 'REGRA-DE-COLLAB-DA-BASE' } } },
    };
    await rodarComCopia();

    const ctx = (vi.mocked(runPlanner).mock.calls[0]![0] as { brandContext: string }).brandContext;
    expect(ctx).toContain('PROJETO: Base');
    expect(ctx).toContain('ESSENCIA-DA-BASE');
    expect(ctx).toContain('REGRA-DE-COLLAB-DA-BASE');
    expect(ctx).toContain('DESDOBRAMENTO ATIVO: Base + Parceiro');
    expect(ctx).toContain('PROTAGONISMO: a marca-mãe lidera com 70%');
    expect(ctx).toContain('CONTEXTO-DO-COLLAB');
    expect(ctx).toContain('Logo do parceiro Estadão');
    // O que é só do desdobramento entra como ajuste, nunca no lugar da base.
    expect(ctx).toContain('AJUSTES PRÓPRIOS DESTE DESDOBRAMENTO');
  });

  it('desdobramento cuja base não tem ficha usa a do próprio desdobramento como projeto', async () => {
    delete process.env.DESIGNER_BRAIN_BRANDS;
    h.session.brandSlug = 'so-o-desdobramento';
    h.brandRow = {
      name: 'Interno',
      kind: 'INTERNAL',
      collab: { context: 'CTX' },
      profile: { data: { essence: 'ESSENCIA-PROPRIA' } },
      parent: { name: 'Base', slug: 'base', profile: null },
    };
    await rodarComCopia();
    const ctx = (vi.mocked(runPlanner).mock.calls[0]![0] as { brandContext: string }).brandContext;
    expect(ctx).toContain('ESSENCIA-PROPRIA');
    expect(ctx).not.toContain('AJUSTES PRÓPRIOS');
  });

  it('status por bloco: só o aprovado vira slide; fala e contexto orientam; interno nunca chega ao modelo', async () => {
    delete process.env.DESIGNER_BRAIN_BRANDS;
    h.session.brandSlug = 'marca-com-ficha';
    h.savedProfile = { essence: 'X' };
    vi.mocked(runPlanner).mockResolvedValue(roteiro(() => 'copy') as never);
    await runPipeline({
      sessionId: S,
      brief: 'Apresentação de teste',
      format: 'presentation',
      postId: POST,
      sourceCopy: ['[APROVADO]', 'TITULO-APROVADO', '[FALA]', 'FALA-DO-PALESTRANTE', '[CONTEXTO]', 'CONTEXTO-DA-REUNIAO', '[INTERNO]', 'VALOR-DO-CONTRATO'].join('\n'),
    });
    const call = vi.mocked(runPlanner).mock.calls[0]![0] as { brandContext: string; sourceCopy?: string };
    expect(call.sourceCopy).toBe('TITULO-APROVADO');
    expect(call.brandContext).toContain('FALA-DO-PALESTRANTE');
    expect(call.brandContext).toContain('CONTEXTO-DA-REUNIAO');
    expect(call.brandContext).toContain('NÃO é texto da peça');
    const tudo = JSON.stringify([call, h.prompts]);
    expect(tudo).not.toContain('VALOR-DO-CONTRATO');
    // E o resultado diz o que ficou de fora da arte, sem repetir o conteúdo.
    const avisos = wsOf('token').map((c) => String(c.args[1])).join('');
    expect(avisos).toContain('2 blocos de fala/contexto/apoio serviram só de orientação');
    expect(avisos).toContain('1 bloco interno/não exibir não foi enviado à IA');
    expect(avisos).not.toContain('VALOR-DO-CONTRATO');
  });

  it('status por bloco: texto em revisão é diagramado, mas o resultado avisa que a peça não é final', async () => {
    delete process.env.DESIGNER_BRAIN_BRANDS;
    h.session.brandSlug = 'marca-com-ficha';
    h.savedProfile = { essence: 'X' };
    vi.mocked(runPlanner).mockResolvedValue(roteiro(() => 'copy') as never);
    await runPipeline({
      sessionId: S,
      brief: 'Apresentação de teste',
      format: 'presentation',
      postId: POST,
      sourceCopy: '[APROVADO] FECHADO\n[EM REVISÃO] TALVEZ-MUDE',
    });
    const call = vi.mocked(runPlanner).mock.calls[0]![0] as { sourceCopy?: string };
    expect(call.sourceCopy).toBe('FECHADO\n\nTALVEZ-MUDE');
    expect(wsOf('token').map((c) => String(c.args[1])).join('')).toContain('não deve ser tratada como final');
  });

  it('status por bloco: sem nenhum texto aprovado (só fala/contexto), para e pede o texto', async () => {
    delete process.env.DESIGNER_BRAIN_BRANDS;
    h.session.brandSlug = 'marca-com-ficha';
    h.savedProfile = { essence: 'X' };
    await runPipeline({ sessionId: S, brief: 'Apresentação de teste', format: 'presentation', postId: POST, sourceCopy: '[FALA] só falado\n[CONTEXTO] só contexto' });
    expect(String(wsOf('error')[0]!.args[1])).toContain('só gera com texto aprovado');
    expect(vi.mocked(runPlanner)).not.toHaveBeenCalled();
  });

  it('ficha salva e SEM texto aprovado: para e pede o texto, como nas marcas piloto', async () => {
    delete process.env.DESIGNER_BRAIN_BRANDS;
    h.session.brandSlug = 'marca-com-ficha';
    h.savedProfile = { essence: 'X' };
    await rodarSemTexto();
    expect(String(wsOf('error')[0]!.args[1])).toContain('só gera com texto aprovado');
    expect(vi.mocked(runPlanner)).not.toHaveBeenCalled();
  });

  it('banco sem a tabela da ficha: a geração não cai, segue no caminho legado', async () => {
    delete process.env.DESIGNER_BRAIN_BRANDS;
    h.profileLookupError = tabelaInexistente();
    vi.mocked(runPlanner).mockResolvedValue(roteiro(() => '') as never);
    await rodar();
    const planner = vi.mocked(runPlanner).mock.calls[0]![0] as { brandContext: string };
    expect(planner.brandContext).toBe('contexto da marca');
    expect(wsOf('error')).toHaveLength(0);
  });

  it('ficha inválida no banco é ignorada: a marca segue no caminho legado, sem derrubar a geração', async () => {
    delete process.env.DESIGNER_BRAIN_BRANDS;
    h.session.brandSlug = 'marca-com-ficha';
    h.savedProfile = { palette: 'isto não é uma paleta' };
    vi.mocked(runPlanner).mockResolvedValue(roteiro(() => '') as never);
    await rodar();
    const planner = vi.mocked(runPlanner).mock.calls[0]![0] as { brandContext: string };
    expect(planner.brandContext).toBe('contexto da marca');
  });

  it('ligado: o resolver de imagens não pode gerar foto nem buscar no Unsplash', async () => {
    process.env.DESIGNER_BRAIN_BRANDS = 'amanda-coelho';
    h.session.brandSlug = 'amanda-coelho';
    await rodarComCopia();

    const resolver = vi.mocked(resolveSlideImages).mock.calls[0]![0] as { allowGeneratedGraphics?: boolean };
    expect(resolver.allowGeneratedGraphics).toBe(false);
  });

  it('ligado sem memória de projeto: erro visível, e a geração não segue com as regras erradas', async () => {
    process.env.DESIGNER_BRAIN_BRANDS = 'marca-sem-memoria';
    h.session.brandSlug = 'marca-sem-memoria';
    await rodarComCopia();

    const erro = wsOf('error');
    expect(erro).toHaveLength(1);
    expect(String(erro[0]!.args[1])).toContain('não tem memória de projeto');
    expect(h.modelCalls).toBe(0);
    expect(vi.mocked(runPlanner)).not.toHaveBeenCalled();
  });

  it('ligado e SEM texto aprovado: para e pede o texto, em vez de deixar o modelo inventar', async () => {
    process.env.DESIGNER_BRAIN_BRANDS = 'amanda-coelho';
    h.session.brandSlug = 'amanda-coelho';
    await rodarSemTexto(); // sem sourceCopy nem roteiro aprovado

    const erro = wsOf('error');
    expect(erro).toHaveLength(1);
    expect(String(erro[0]!.args[1])).toContain('só gera com texto aprovado');
    expect(h.modelCalls).toBe(0);
    expect(vi.mocked(runPlanner)).not.toHaveBeenCalled();
    expect(h.session.phase).toBe('listening'); // a pessoa pode mandar o texto e seguir na mesma conversa
  });

  it('marca SEM o cérebro (saída de emergência) continua gerando sem texto aprovado, como antes', async () => {
    delete process.env.DESIGNER_BRAIN_BRANDS;
    vi.mocked(runPlanner).mockResolvedValue(roteiro(() => '') as never);
    await rodarSemTexto();
    expect(wsOf('error')).toHaveLength(0);
    expect(h.modelCalls).toBeGreaterThan(0);
  });

  it('texto dos slides igual ao aprovado: nenhum desvio de texto, deck aprovado', async () => {
    process.env.DESIGNER_BRAIN_BRANDS = 'amanda-coelho';
    h.session.brandSlug = 'amanda-coelho';
    await rodarComCopia(); // "Slide N" é exatamente o que o artista do harness escreve

    expect(h.session.pendingReview.deviations).toEqual([]);
    expect(wsOf('notify')[0]!.args[1]).toMatchObject({ kind: 'done' });
  });

  it('texto dos slides diferente do aprovado: vira desvio crítico, o deck fica "precisa de revisão" e a análise chega ao chat', async () => {
    process.env.DESIGNER_BRAIN_BRANDS = 'amanda-coelho';
    h.session.brandSlug = 'amanda-coelho';
    await rodarComCopia((i) => `Decisões conscientes constroem negócios sólidos ${i + 1}`);

    const devs = h.session.pendingReview.deviations as Array<{ severity: string; slideIndex: number; description: string }>;
    expect(devs.some((d) => d.severity === 'critical' && d.description.includes('faltam'))).toBe(true);
    expect(devs.some((d) => d.severity === 'major' && d.description.includes('não está no texto aprovado'))).toBe(true);
    expect(devs.map((d) => d.slideIndex)).toContain(2); // aponta o slide certo
    expect(wsOf('notify')[0]!.args[1]).toMatchObject({ kind: 'needs_review' });
    expect(wsOf('token').map((c) => String(c.args[1])).join('')).toContain('Análise do revisor');
  });

  it('o aprovado do reviewer visual NÃO apaga o desvio de texto', async () => {
    process.env.DESIGNER_BRAIN_BRANDS = 'amanda-coelho';
    h.session.brandSlug = 'amanda-coelho';
    await rodarComCopia(() => 'outra coisa inteira'); // o mock do reviewer devolve approved: true

    expect(wsOf('notify')[0]!.args[1]).toMatchObject({ kind: 'needs_review' });
  });

  it('sem a copy distribuída por slide (planner caiu no esqueleto), a checagem é pulada e não acusa o deck', async () => {
    process.env.DESIGNER_BRAIN_BRANDS = 'amanda-coelho';
    h.session.brandSlug = 'amanda-coelho';
    await rodarComCopia(() => '');

    expect(h.session.pendingReview.deviations).toEqual([]);
    expect(wsOf('notify')[0]!.args[1]).toMatchObject({ kind: 'done' });
  });
});

describe('moodboard anexado no chat continua chegando ao artista', () => {
  const originalFetch = globalThis.fetch;
  const originalBase = config.r2PublicUrl;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (config as { r2PublicUrl: string }).r2PublicUrl = originalBase;
  });

  it('anexo com papel style-reference vira IMAGEM na chamada de geração, e o texto avisa que não vai no slide', async () => {
    (config as { r2PublicUrl: string }).r2PublicUrl = 'https://cdn.exemplo.com';
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const baixadas: string[] = [];
    globalThis.fetch = vi.fn(async (url: unknown) => {
      baixadas.push(String(url));
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    }) as unknown as typeof fetch;
    h.slideCount = 3;

    const url = 'https://cdn.exemplo.com/brands/marca/chat-attachments/moodboard-gabi.png';
    await runPipeline({
      sessionId: S, brief: 'Apresentação de teste', format: 'presentation', postId: POST,
      attachmentImages: [{ url, name: 'moodboard-gabi.png', role: 'style-reference' }],
      sourceCopy: 'texto aprovado',
    });

    expect(baixadas).toContain(url);
    const comImagem = h.contentsSeen.filter((c) => Array.isArray(c));
    expect(comImagem.length).toBeGreaterThan(0);
    const partes = comImagem[0][0].parts as Array<{ text?: string; inlineData?: { mimeType: string } }>;
    expect(partes.some((p) => p.inlineData?.mimeType === 'image/png')).toBe(true);
    expect(partes.some((p) => p.text?.includes('Moodboard de referência visual: moodboard-gabi.png') && p.text.includes('nunca insira esta imagem no slide'))).toBe(true);
  });
});

// ── Cérebro global: vale em TODO projeto, com ou sem ficha ──────────────────────────────────────────────
// O padrão é ligado. Nenhum destes testes usa DESIGNER_BRAIN_BRANDS nem ficha salva (salvo o que diz o título).
describe('cérebro global (padrão): projeto sem ficha passa pelo mesmo cérebro', () => {
  const GLOBAL = 'Você é a inteligência de direção de arte do sistema Designer';
  const keys = ['DESIGNER_BRAIN_GLOBAL', 'DESIGNER_BRAIN_BRANDS'] as const;
  const originais = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

  beforeEach(() => {
    for (const k of keys) delete process.env[k];
    vi.mocked(runPlanner).mockReset();
    vi.mocked(resolveSlideImages).mockClear();
    h.slideCount = 3;
    h.session.brandSlug = 'marca-sem-ficha';
  });
  afterEach(() => {
    for (const k of keys) {
      if (originais[k] === undefined) delete process.env[k];
      else process.env[k] = originais[k];
    }
  });

  const roteiro = (copy: (i: number) => string) =>
    Array.from({ length: 3 }, (_, i) => ({ title: `Slide ${i + 1}`, goal: 'Objetivo', layout_type: 'content-split', order: i + 1, copy: copy(i) }));
  const plannerCall = () => vi.mocked(runPlanner).mock.calls[0]![0] as { brandContext: string; sourceCopy?: string; brief: string };
  const avisos = () => wsOf('token').map((c) => String(c.args[1])).join('');

  async function gerar(sourceCopy: string, brief = 'Apresentação de teste') {
    vi.mocked(runPlanner).mockResolvedValue(roteiro((i) => `Slide ${i + 1}`) as never);
    await runPipeline({ sessionId: S, brief, format: 'presentation', postId: POST, sourceCopy });
  }

  it('sem ficha: planner e artista recebem as camadas globais, a regra de foto real e o resumo do cadastro (nada inventado)', async () => {
    await gerar('texto aprovado');

    expect(wsOf('error')).toHaveLength(0);
    expect(plannerCall().brandContext).toContain(GLOBAL);
    expect(plannerCall().brandContext).toContain('MODO: APRESENTAÇÃO');
    expect(plannerCall().brandContext).toContain('REGRA DE FOTOGRAFIA PARA ESTA PEÇA');
    // Sem ficha, sem instruções do agente e sem seed: a memória é o resumo do que o cadastro já tem.
    expect(plannerCall().brandContext).toContain('contexto da marca');
    const sys = h.prompts[0]!.sys;
    expect(sys.startsWith(GLOBAL)).toBe(true);
    expect(sys).toContain('data-photo-slot');
    expect(promptOf(1)).not.toContain('Diretrizes: DIRETRIZ-LEGADA'); // as camadas ocupam o lugar do legado
    // E o que falta vira pendência dita à pessoa, sem a IA preencher nada.
    expect(avisos()).toContain('Falta definir: Memória do projeto-base (ficha do projeto)');
    const gate = (h.postUpdates.at(-1)!.data.content as { finalGate?: { notes: string[]; blocking: string[] } }).finalGate;
    expect(gate?.notes).toContain('Falta definir: Memória do projeto-base (ficha do projeto).');
    expect(gate?.blocking).toEqual([]); // pendência avisa, não barra a entrega
  });

  it('sem ficha: regra de foto real em vigor — o deck não usa imagem gerada, e o espaço de foto vazio ganha a moldura padrão', async () => {
    h.withEmptySlot = true;
    await gerar('texto aprovado');

    const resolver = vi.mocked(resolveSlideImages).mock.calls[0]![0] as { allowGeneratedGraphics?: boolean; onlyProvidedAssets?: boolean };
    expect(resolver.allowGeneratedGraphics).toBe(false);
    expect(resolver.onlyProvidedAssets).toBe(true);
    for (const sl of h.synced[0].content.slides as Array<{ html: string }>) expect(sl.html).toContain('data-photo-empty');
  });

  it('sem ficha: a memória é a que o resolveProjectMemory acha — "Instruções do agente" quando existem, sem pendência de memória', async () => {
    h.agentPrompt = 'INSTRUCOES-DO-AGENTE-DA-MARCA';
    await gerar('texto aprovado');

    expect(plannerCall().brandContext).toContain('INSTRUCOES-DO-AGENTE-DA-MARCA');
    expect(plannerCall().brandContext).not.toContain('contexto da marca');
    expect(avisos()).not.toContain('Memória do projeto-base');
  });

  it('sem ficha: o seed do repositório entra quando não há instruções do agente', async () => {
    h.session.brandSlug = 'amanda-coelho';
    await gerar('texto aprovado');
    expect(plannerCall().brandContext).toContain('#410C1C');
    expect(avisos()).not.toContain('Memória do projeto-base');
  });

  it('(a) sem ficha: [INTERNO] não chega ao planner nem ao artista, e [CONTEXTO]/[FALA] só orientam (não são texto de slide)', async () => {
    const bruto = ['[APROVADO]', 'TITULO-APROVADO', '[FALA]', 'FALA-DO-PALESTRANTE', '[CONTEXTO]', 'CONTEXTO-DA-REUNIAO', '[INTERNO]', 'VALOR-DO-CONTRATO', '[NÃO EXIBIR]', 'SEGREDO-DO-CLIENTE'].join('\n');
    // O briefing da Fábrica carrega a mensagem colada inteira (é o que a Fábrica faz): o interno sai dele também.
    await gerar(bruto, `Apresentação de teste\n\n${bruto}`);

    expect(plannerCall().sourceCopy).toBe('TITULO-APROVADO');
    expect(plannerCall().brandContext).toContain('FALA-DO-PALESTRANTE');
    expect(plannerCall().brandContext).toContain('NÃO é texto da peça');
    const tudo = JSON.stringify([vi.mocked(runPlanner).mock.calls, h.prompts, h.reviewerBriefs]);
    expect(tudo).not.toContain('VALOR-DO-CONTRATO');
    expect(tudo).not.toContain('SEGREDO-DO-CLIENTE');
    expect(avisos()).toContain('2 blocos de fala/contexto/apoio serviram só de orientação');
    expect(avisos()).toContain('2 blocos internos/não exibir não foram enviados à IA');
    expect(avisos()).not.toContain('VALOR-DO-CONTRATO');
  });

  it('(a) sem ficha: o contexto e a fala nunca viram o texto de um slide — o roteiro que o artista segue só tem o aprovado', async () => {
    const bruto = '[APROVADO]\nTITULO-APROVADO\n[CONTEXTO]\nCONTEXTO-DA-REUNIAO\n[FALA]\nFALA-DO-PALESTRANTE';
    await gerar(bruto);
    // O planner recebe só o aprovado como copy para distribuir; fala e contexto chegam à parte, como orientação.
    expect(plannerCall().sourceCopy).toBe('TITULO-APROVADO');
    const orientacao = plannerCall().brandContext.split('ORIENTAÇÃO')[1] ?? '';
    expect(orientacao).toContain('CONTEXTO-DA-REUNIAO');
    expect(orientacao).toContain('NÃO é texto da peça');
    expect(plannerCall().brandContext.split('ORIENTAÇÃO')[0]).not.toContain('CONTEXTO-DA-REUNIAO');
  });

  it('(a) sem ficha: o mesmo vale com quebra de linha do Windows (CRLF) no briefing', async () => {
    const bruto = ['[APROVADO]', 'TITULO-APROVADO', '[INTERNO]', 'VALOR-DO-CONTRATO', 'LINHA-DOIS-INTERNA'].join('\r\n');
    await gerar(bruto, `Apresentação de teste\r\n${bruto}`);
    const tudo = JSON.stringify([vi.mocked(runPlanner).mock.calls, h.prompts]);
    expect(tudo).not.toContain('VALOR-DO-CONTRATO');
    expect(tudo).not.toContain('LINHA-DOIS-INTERNA');
  });

  it('sem ficha: texto sem NENHUMA marca continua valendo como aprovado, byte a byte (copy e briefing)', async () => {
    const livre = 'Título livre\r\n\r\n  Texto com   espaços\ne [colchetes] no meio.\n';
    const brief = 'Apresentação de teste\r\n' + livre;
    await gerar(livre, brief);
    expect(plannerCall().sourceCopy).toBe(livre);
    expect(plannerCall().brief).toBe(brief);
    expect(wsOf('error')).toHaveLength(0);
  });

  it('(b) sem ficha: o briefing gravado no trace da geração NÃO contém o texto interno', async () => {
    const bruto = ['[APROVADO]', 'TITULO-APROVADO', '[INTERNO]', 'VALOR-DO-CONTRATO', '[NÃO EXIBIR]', 'SEGREDO-DO-CLIENTE'].join('\n');
    vi.mocked(openRun).mockClear();
    await gerar(bruto, `Apresentação de teste\n\n${bruto}`);

    const gravado = vi.mocked(openRun).mock.calls.map((c) => (c[0] as { brief?: string }).brief ?? '');
    expect(gravado.length).toBeGreaterThan(0);
    expect(gravado.join('\n')).toContain('TITULO-APROVADO');
    expect(gravado.join('\n')).not.toContain('VALOR-DO-CONTRATO');
    expect(gravado.join('\n')).not.toContain('SEGREDO-DO-CLIENTE');
  });

  it('(b) COM ficha: o briefing gravado no trace e o do planner também vêm sem o texto interno', async () => {
    h.savedProfile = { essence: 'X' };
    const bruto = '[APROVADO]\nTITULO-APROVADO\n[INTERNO]\nVALOR-DO-CONTRATO';
    vi.mocked(openRun).mockClear();
    await gerar(bruto, `Apresentação de teste\n${bruto}`);
    const gravado = vi.mocked(openRun).mock.calls.map((c) => (c[0] as { brief?: string }).brief ?? '').join('\n');
    expect(gravado).toContain('TITULO-APROVADO');
    expect(gravado).not.toContain('VALOR-DO-CONTRATO');
    expect(plannerCall().brief).not.toContain('VALOR-DO-CONTRATO');
  });

  it('(e) COM ficha: briefing sem nenhuma marca passa byte a byte (planner e trace)', async () => {
    h.savedProfile = { essence: 'X' };
    const livre = 'Título livre\r\n\r\n  Texto com   espaços\ne [colchetes] no meio.\n';
    const brief = 'Apresentação de teste\r\n' + livre;
    vi.mocked(openRun).mockClear();
    await gerar(livre, brief);
    expect(plannerCall().brief).toBe(brief);
    expect(vi.mocked(openRun).mock.calls.map((c) => (c[0] as { brief?: string }).brief)).toContain(brief);
  });

  it('saída de emergência (DESIGNER_BRAIN_GLOBAL=off): o briefing segue como veio, sem limpeza', async () => {
    process.env.DESIGNER_BRAIN_GLOBAL = 'off';
    h.savedProfile = { essence: 'X' };
    const bruto = '[APROVADO]\nTITULO-APROVADO\n[INTERNO]\nVALOR-DO-CONTRATO';
    const brief = `Apresentação de teste\n${bruto}`;
    await gerar(bruto, brief);
    expect(plannerCall().brief).toBe(brief);
  });

  it('(b) sem ficha e SEM texto aprovado: para e pede o texto, em vez de deixar o modelo inventar', async () => {
    await rodarSemTexto();

    const erro = wsOf('error');
    expect(erro).toHaveLength(1);
    expect(String(erro[0]!.args[1])).toContain('só gera com texto aprovado');
    expect(h.modelCalls).toBe(0);
    expect(vi.mocked(runPlanner)).not.toHaveBeenCalled();
    expect(h.postCreates).toHaveLength(0);
    expect(h.session.phase).toBe('listening'); // a pessoa manda o texto e segue na mesma conversa
  });

  it('(b) sem ficha e só fala/contexto/interno (nada aprovado): para e pede o texto', async () => {
    await runPipeline({ sessionId: S, brief: 'Apresentação de teste', format: 'presentation', postId: POST, sourceCopy: '[FALA] só falado\n[CONTEXTO] só contexto\n[INTERNO] só interno' });
    expect(String(wsOf('error')[0]!.args[1])).toContain('só gera com texto aprovado');
    expect(vi.mocked(runPlanner)).not.toHaveBeenCalled();
    expect(h.modelCalls).toBe(0);
  });

  it('sem ficha, com o roteiro já aprovado (copy por slide) e sem sourceCopy: gera', async () => {
    vi.mocked(runPlanner).mockResolvedValue(roteiro(() => '') as never);
    await runPipeline({
      sessionId: S, brief: 'Apresentação de teste', format: 'presentation', postId: POST,
      approvedSkeleton: roteiro((i) => `Slide ${i + 1}`) as never,
    });
    expect(wsOf('error')).toHaveLength(0);
    expect(h.modelCalls).toBeGreaterThan(0);
  });

  it('sem ficha: o texto do slide é conferido contra o aprovado (a trava vale para todo projeto)', async () => {
    vi.mocked(runPlanner).mockResolvedValue(roteiro((i) => `Decisões conscientes constroem negócios sólidos ${i + 1}`) as never);
    await runPipeline({ sessionId: S, brief: 'Apresentação de teste', format: 'presentation', postId: POST, sourceCopy: 'texto aprovado' });
    const devs = h.session.pendingReview.deviations as Array<{ severity: string }>;
    expect(devs.some((d) => d.severity === 'critical')).toBe(true);
    expect(wsOf('notify')[0]!.args[1]).toMatchObject({ kind: 'needs_review' });
  });

  it('banco sem a tabela da ficha: a geração não cai e segue com o cérebro global (sem ficha)', async () => {
    h.profileLookupError = tabelaInexistente();
    const aviso = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await gerar('texto aprovado');
    expect(wsOf('error')).toHaveLength(0);
    expect(plannerCall().brandContext).toContain(GLOBAL);
    expect(aviso.mock.calls.map((c) => String(c[0])).join(' | ')).toContain('migration não aplicada');
    aviso.mockRestore();
  });

  it('banco com a coluna da ficha faltando (P2022): o mesmo que tabela inexistente, segue sem ficha com aviso warn', async () => {
    h.profileLookupError = Object.assign(new Error('The column `BrandProfile.data` does not exist in the current database.'), { code: 'P2022' });
    const aviso = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const erroLog = vi.spyOn(logger, 'error').mockImplementation(() => {});
    await gerar('texto aprovado');
    expect(wsOf('error')).toHaveLength(0);
    expect(plannerCall().brandContext).toContain(GLOBAL);
    expect(aviso.mock.calls.map((c) => String(c[0])).join(' | ')).toContain('migration não aplicada');
    expect(erroLog.mock.calls.map((c) => String(c[0])).join(' | ')).not.toContain('ler a ficha');
    aviso.mockRestore();
    erroLog.mockRestore();
  });

  it('(d) falha de LEITURA da ficha (erro genérico): para com erro visível, sem gerar nada, e registra o erro no log', async () => {
    h.profileLookupError = new Error('Connection terminated unexpectedly');
    const erroLog = vi.spyOn(logger, 'error').mockImplementation(() => {});
    await gerar('texto aprovado');

    const erro = wsOf('error');
    expect(erro).toHaveLength(1);
    expect(String(erro[0]!.args[1])).toContain('Não consegui ler a ficha');
    expect(String(erro[0]!.args[1])).toContain('Tente de novo');
    expect(vi.mocked(runPlanner)).not.toHaveBeenCalled();
    expect(h.modelCalls).toBe(0);
    expect(h.postCreates).toHaveLength(0);
    expect(h.session.phase).toBe('listening'); // a pessoa tenta de novo na mesma conversa
    expect(h.session.workerStatus).toBe('idle');
    expect(erroLog).toHaveBeenCalled();
    expect(String(erroLog.mock.calls[0]![0])).toContain('ler a ficha');
    erroLog.mockRestore();
  });

  it('(d) falha de leitura da ficha também para na saída de emergência: projeto que tem ficha não segue em silêncio', async () => {
    process.env.DESIGNER_BRAIN_GLOBAL = 'off';
    h.profileLookupError = new Error('timeout');
    const erroLog = vi.spyOn(logger, 'error').mockImplementation(() => {});
    await gerar('texto aprovado');
    expect(wsOf('error')).toHaveLength(1);
    expect(vi.mocked(runPlanner)).not.toHaveBeenCalled();
    erroLog.mockRestore();
  });

  it('ficha inválida no banco é ignorada: o projeto segue sem ficha, com o cérebro global', async () => {
    h.savedProfile = { palette: 'isto não é uma paleta' };
    await gerar('texto aprovado');
    expect(wsOf('error')).toHaveLength(0);
    expect(plannerCall().brandContext).toContain(GLOBAL);
    expect(plannerCall().brandContext).toContain('contexto da marca');
  });

  it('(c) saída de emergência: DESIGNER_BRAIN_GLOBAL=off devolve o comportamento anterior no projeto sem ficha', async () => {
    process.env.DESIGNER_BRAIN_GLOBAL = 'off';
    vi.mocked(runPlanner).mockResolvedValue(roteiro(() => '') as never);
    await rodarSemTexto(); // antes gerava sem texto aprovado, sem cérebro

    expect(wsOf('error')).toHaveLength(0);
    expect(h.modelCalls).toBeGreaterThan(0);
    expect(plannerCall().brandContext).toBe('contexto da marca');
    expect(h.prompts[0]!.sys).not.toContain(GLOBAL);
    expect(promptOf(1)).toContain('Diretrizes: DIRETRIZ-LEGADA');
    const resolver = vi.mocked(resolveSlideImages).mock.calls[0]![0] as { allowGeneratedGraphics?: boolean; onlyProvidedAssets?: boolean };
    expect(resolver.allowGeneratedGraphics).toBeUndefined();
    expect(resolver.onlyProvidedAssets).toBeFalsy();
    expect(h.synced[0].content.finalGate).toBeUndefined();
  });

  it('(c) saída de emergência: o briefing de projeto sem ficha não é mexido (o texto interno só sai com o cérebro global)', async () => {
    process.env.DESIGNER_BRAIN_GLOBAL = 'off';
    process.env.DESIGNER_BRAIN_BRANDS = 'marca-sem-ficha';
    const bruto = '[APROVADO]\nTITULO-APROVADO\n[INTERNO]\nVALOR-DO-CONTRATO';
    const brief = `Apresentação de teste\n${bruto}`;
    h.agentPrompt = 'MEMORIA-DO-CADASTRO';
    await gerar(bruto, brief);
    expect(plannerCall().brief).toBe(brief);
  });

  it('(c) saída de emergência: com ela, o slug em DESIGNER_BRAIN_BRANDS ainda liga o cérebro sem ficha', async () => {
    process.env.DESIGNER_BRAIN_GLOBAL = 'off';
    process.env.DESIGNER_BRAIN_BRANDS = 'marca-sem-ficha';
    h.agentPrompt = 'MEMORIA-DO-CADASTRO';
    await gerar('texto aprovado');
    expect(plannerCall().brandContext).toContain(GLOBAL);
    expect(plannerCall().brandContext).toContain('MEMORIA-DO-CADASTRO');
  });

  it('(c) saída de emergência: com ela, projeto sem memória nenhuma em DESIGNER_BRAIN_BRANDS continua dando erro visível', async () => {
    process.env.DESIGNER_BRAIN_GLOBAL = 'off';
    process.env.DESIGNER_BRAIN_BRANDS = 'marca-sem-ficha';
    await gerar('texto aprovado');
    expect(String(wsOf('error')[0]!.args[1])).toContain('não tem memória de projeto');
    expect(h.modelCalls).toBe(0);
  });

  it('(c) saída de emergência: projeto COM ficha continua com o cérebro (ela nunca é desligada)', async () => {
    process.env.DESIGNER_BRAIN_GLOBAL = 'off';
    h.savedProfile = { essence: 'ESSENCIA-DA-FICHA' };
    await gerar('texto aprovado');
    expect(plannerCall().brandContext).toContain('ESSENCIA-DA-FICHA');
  });

  it('(d) COM ficha: o resultado é o mesmo com o cérebro global ligado ou desligado (mesmas camadas, mesma ordem)', async () => {
    h.savedProfile = {
      essence: 'ESSENCIA-DA-FICHA',
      palette: [{ hex: '#123456', name: 'Azul ficha' }],
      neverDo: ['NUNCA-DA-FICHA'],
    };
    const novaSessao = () => {
      h.session = {
        id: S, brandSlug: 'marca-com-ficha', userId: 'u1', phase: 'ready', workerStatus: 'running', reviewMode: 'auto',
        messages: [], currentDesign: [], folderId: null, createdAt: 0, updatedAt: 0,
      };
      h.prompts.length = 0; h.wsCalls.length = 0; h.postUpdates.length = 0; h.synced.length = 0; h.modelCalls = 0;
      vi.mocked(runPlanner).mockClear(); vi.mocked(resolveSlideImages).mockClear();
    };
    const instantaneo = () => ({
      planner: vi.mocked(runPlanner).mock.calls[0]![0] as { brandContext: string },
      artistas: h.prompts.map((p) => [p.sys, p.user]),
      resolver: vi.mocked(resolveSlideImages).mock.calls[0]![0],
      avisos: avisos(),
      gate: (h.postUpdates.at(-1)!.data.content as { finalGate?: unknown }).finalGate ?? null,
    });

    novaSessao();
    await gerar('texto aprovado');
    const ligado = instantaneo();

    process.env.DESIGNER_BRAIN_GLOBAL = 'off';
    novaSessao();
    await gerar('texto aprovado');
    const desligado = instantaneo();

    expect(ligado.planner.brandContext).toContain('ESSENCIA-DA-FICHA');
    expect(ligado).toEqual(desligado);
  });

  it('(d) COM ficha e sem texto aprovado: para e pede o texto, como antes', async () => {
    h.savedProfile = { essence: 'X' };
    await rodarSemTexto();
    expect(String(wsOf('error')[0]!.args[1])).toContain('só gera com texto aprovado');
    expect(vi.mocked(runPlanner)).not.toHaveBeenCalled();
  });

  it('(a) COM ficha: o texto interno também sai do briefing (a limpeza vale com ou sem ficha) e a copy segue igual', async () => {
    h.savedProfile = { essence: 'X' };
    const bruto = '[APROVADO]\nTITULO-APROVADO\n[INTERNO]\nVALOR-DO-CONTRATO';
    await gerar(bruto, `Apresentação de teste\n${bruto}`);
    expect(plannerCall().brief).toContain('TITULO-APROVADO');
    expect(plannerCall().brief).not.toContain('VALOR-DO-CONTRATO');
    expect(plannerCall().sourceCopy).toBe('TITULO-APROVADO');
  });
});
