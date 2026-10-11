import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { getSession, updateSession, updateBrandMemory, getBrandMemory } from '../lib/redis.js';
import { ws } from '../lib/websocket.js';
import { buildBrandContextSummary, resolveBrandContext } from '../lib/brandContext.js';
import {
  buildPipelineBrainContext,
  correctTextDivergences,
  fontSubstitutionNotice,
  hasApprovedText,
  isDesignerBrainEnabled,
  officialFontsFor,
  textIssuesToDeviations,
} from '../lib/designerBrain/index.js';
import type { TextIssue } from '../lib/designerBrain/index.js';
import { executeTool } from './tools/index.js';
import { runPlanner, MAX_SLIDES, type SlideSkeletonItem } from './planner/index.js';
import { runHtmlReviewer } from './reviewer/index.js';
import type { ReviewResult } from './reviewer/index.js';
import { editHtmlSlide, generateHtmlDesignBatched, type HtmlDesignSlide } from '../lib/htmlDesign.js';
import { deriveDeckName } from '../lib/deckName.js';
import { normalizeEmptyPhotoSlots } from '../lib/photoSlot.js';
import { syncPostSlides } from '../lib/postHelper.js';
import { researchBrand, type VisualRef } from '../lib/fabricaLegacy.js';
import { resolveSlideImages, resolveImageCandidateDecisions, type AmbiguousImageCandidate, type ResolvedSlideImage } from '../lib/imageResolver.js';
import { buildSlidesHtmlBlob, detectAssetUrlsInHtml, mergeUsedAssetUrls } from '../lib/assetUsage.js';
import { humanizeGeminiError } from '../lib/geminiRetry.js';
import { extractJsonObject } from '../lib/jsonHelper.js';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { generateWithRetry } from '../lib/geminiRetry.js';
import { runWithAiContext, enrichAiContext, getAiContext } from '../lib/aiContext.js';
import { openRun, closeRun } from '../lib/generationTracing.js';
import { logger } from '../lib/logger.js';
import {
  consumePendingAdvice,
  listAdvice,
  pruneAdvice,
  settleAdviceWhenIdle,
  ADVICE_SCOPE_CHAT,
  adviceLines,
} from '../lib/advice.js';
import { isInterruptRequested, markInterruptStopped } from '../lib/interrupt.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

async function loadStyleReferenceParts(images: Array<{ url: string; name: string; role?: 'style-reference' | 'content-asset' }> | undefined, brandSlug: string) {
  const base = config.r2PublicUrl.replace(/\/$/, '');
  if (!base) return [] as Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
  const refs = (images ?? []).filter((image) => image.role === 'style-reference').slice(0, 3);
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
  for (const ref of refs) {
    // Somente anexos de chat deste bucket/marca; URLs arbitrárias não viram fetch do servidor.
    if (!ref.url.startsWith(`${base}/brands/${encodeURIComponent(brandSlug)}/chat-attachments/`)) continue;
    try {
      const response = await fetch(ref.url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) continue;
      const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 8 * 1024 * 1024) continue;
      parts.push({ text: `Moodboard de referência visual: ${ref.name}. Use somente para direção de arte, paleta, composição e tipografia; nunca insira esta imagem no slide.` });
      parts.push({ inlineData: { mimeType, data: bytes.toString('base64') } });
    } catch (error) {
      logger.warn('Não foi possível carregar moodboard para referência multimodal', { name: ref.name, error: (error as Error).message });
    }
  }
  return parts;
}
// Extrai uma contagem de slides pedida no brief ("de 200 slides", "50 lâminas",
// "30 páginas"). Clampa ao teto de sanidade. Retorna undefined se não citada.
export function parseRequestedSlideCount(brief: string): number | undefined {
  const m = brief.match(/(\d{1,4})\s*(slides?|l[aâ]minas?|p[aá]ginas?|telas?|cards?)/i);
  if (!m) return undefined;
  const n = parseInt(m[1]!, 10);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.min(n, MAX_SLIDES);
}

// Antes todo Design nascia 1080x1080 fixo — Stories/Reels/Pins pedem retrato e
// nunca havia como pedir isso. Apresentação continua sempre 16:9 (aspectRatio
// é ignorado pra ela). Dimensões em múltiplos de 1080 pra manter a resolução
// consistente com o que o resto do pipeline (raster, export) já espera.
const CAROUSEL_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '3:4': { width: 1080, height: 1440 },
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
};

export function resolveCanvasSize(format: 'presentation' | 'carousel', aspectRatio?: string): { width: number; height: number } {
  if (format === 'presentation') return { width: 1920, height: 1080 };
  return CAROUSEL_DIMENSIONS[aspectRatio ?? '1:1'] ?? CAROUSEL_DIMENSIONS['1:1']!;
}

/**
 * Amarra o run do pipeline ao Post recém-criado — reaproveitando o run IMPLÍCITO
 * que researchBrand/runPlanner já podem ter aberto, em vez de abrir um segundo.
 *
 * researchBrand e runPlanner rodam ANTES de o Post existir. Cada chamada deles
 * passa por generateWithRetry → ensureRun(), que abre um GenerationRun com
 * `postId` ainda undefined (ctx.postId só é setado aqui embaixo). Se, depois do
 * Post nascer, a gente chamasse openRun() de novo, abriria um SEGUNDO run e
 * sobrescreveria ctx.runId — o implícito ficava órfão, RUNNING para sempre, e
 * os tokens do planner e da pesquisa (uns 2%-10% do custo de um deck típico)
 * nunca entravam no "Custo estimado": estimatePostCost só soma runs COM postId
 * (rota GET /api/posts/:id/cost filtra `where: { postId }`).
 *
 * Reaproveitar em vez de reabrir resolve os dois problemas de uma vez: o run
 * ganha o postId (passa a aparecer na conta do deck) e continua sendo o MESMO
 * id que o runPipeline fecha no final — sem run zumbi.
 */
export async function attachRunToPost(
  implicitRunId: string | undefined,
  data: { postId: string; brandSlug: string; sessionId: string; brief: string; format: string; aspectRatio?: string },
): Promise<string | null> {
  if (implicitRunId) {
    await prisma.generationRun.update({
      where: { id: implicitRunId },
      data: { postId: data.postId, brief: data.brief, format: data.format, aspectRatio: data.aspectRatio },
    }).catch((err) => {
      logger.warn('Falha ao reaproveitar o run implícito do planner/pesquisa (fail-open)', {
        runId: implicitRunId, postId: data.postId, error: (err as Error).message,
      });
    });
    return implicitRunId;
  }

  return openRun({
    brandSlug: data.brandSlug,
    postId: data.postId,
    sessionId: data.sessionId,
    requestId: data.sessionId,
    feature: 'pipeline',
    brief: data.brief,
    format: data.format,
    aspectRatio: data.aspectRatio,
  });
}

export interface PipelineParams {
  sessionId: string;
  brief: string;
  format: 'presentation' | 'carousel';
  /** Identidade do Post, gerada no ENFILEIRAMENTO (queue.ts). Antes nascia
   *  dentro do run: um retry do job (crash/restart no meio) criava um post
   *  DUPLICADO e deixava o anterior zumbi em GENERATING. Com o id no job, o
   *  retry continua exatamente no mesmo post. */
  postId?: string;
  imagePreference?: 'force-ai' | 'unsplash' | 'unsplash-remix';
  /** Roteiro PRÉ-APROVADO pelo usuário no chat (fluxo copy-first): quando
   *  presente, o pipeline NÃO replaneja — gera exatamente estes slides, com a
   *  copy verbatim que cada item carrega. */
  approvedSkeleton?: SlideSkeletonItem[];
  /** Copy oficial completa (para o planner, quando não há roteiro aprovado). */
  sourceCopy?: string;
  /** Se true, o pipeline gera apenas a capa (Slide 0) e pausa aguardando aprovação visual. */
  generateStyleProofOnly?: boolean;
  /** Se true, o pipeline retoma a geração de uma pausa de estilo (gerando do Slide 1 em diante). */
  resumeFromStyleProof?: boolean;
  /** Fotos que o usuário anexou no chat desta sessão (já com URL do R2) — o
   *  artista as recebe igual a um asset da marca, podendo embutir de verdade. */
  attachmentImages?: Array<{ url: string; name: string; role?: 'style-reference' | 'content-asset' }>;
  /** Proporção do Design (1:1 default) — "16:9"/"1:1"/"4:5"/"3:4"/"9:16". Ignorado
   *  para apresentação (sempre 16:9). */
  aspectRatio?: string;
  /** Se true, o pipeline retoma de uma pausa de bundle de imagens ambíguas — não
   *  chama resolveSlideImages de novo (evitaria um novo call de decisão não-
   *  determinístico), só aplica imageCandidateDecision sobre os candidatos que
   *  já estavam pendentes. */
  resumeFromImageApproval?: boolean;
  /** Decisão do usuário sobre o bundle de candidatos ambíguos (ver
   *  pendingImageCandidates em lib/redis.ts) — só usado com resumeFromImageApproval. */
  imageCandidateDecision?: {
    decision: 'accept' | 'regenerate';
    candidates: AmbiguousImageCandidate[];
  };
}

/** Onde uma geração parou a pedido do usuário ("Pausar e enviar"). */
export interface PipelineInterruption {
  /** Legível, no formato "antes do lote 4 de 10" / "antes do revisor". */
  stage: string;
  /** Slides que já estavam prontos e foram MANTIDOS no deck. */
  slidesKept: number;
  /** Total planejado (0 quando parou antes de haver plano). */
  total: number;
}

export interface PipelineOutcome {
  interrupted?: PipelineInterruption;
}

/**
 * Como o run interrompido é fechado. O schema não tem CANCELLED em GenerationStatus
 * e não pode ser alterado aqui, então o run fecha COMPLETED com `error` preenchido:
 *  - FAILED estaria errado: nada falhou, o usuário pediu para parar, e o que já
 *    foi gerado está salvo e íntegro. Marcar FAILED sujaria qualquer métrica de
 *    falha e o "custo por deck" trataria um run bom como perdido;
 *  - COMPLETED puro esconderia que foi interrompido. O prefixo fixo abaixo
 *    permite achar esses runs com um filtro em `error` (começa com o prefixo), sem migration.
 */
export const INTERRUPTED_RUN_PREFIX = 'interrompida_pelo_usuario';

export function describeInterruptedRun(i: PipelineInterruption): string {
  const progresso = i.total > 0 ? `; ${i.slidesKept} de ${i.total} slides mantidos` : '';
  return `${INTERRUPTED_RUN_PREFIX}: ${i.stage}${progresso}`;
}

export async function runPipeline(params: PipelineParams): Promise<void> {
  const { sessionId } = params;

  const session = await getSession(sessionId);
  if (!session) {
    logger.error('Sessão não encontrada', { sessionId, feature: 'pipeline' });
    return;
  }

  // Abre o contexto: daqui para baixo, todo log e toda chamada de IA (planner,
  // lotes, reviewer) sabem de que marca e de que sessão são, sem receber parâmetro.
  return runWithAiContext(
    { sessionId, brandSlug: session.brandSlug, feature: 'pipeline', requestId: sessionId, postId: params.postId },
    async () => {
      // Quem ABRE o run é o runPipelineInner, logo depois de criar o Post — antes
      // disso a FK `GenerationRun.postId` não fecha. Aqui só o fechamento: o id
      // volta pelo AiContext, que é o mesmo objeto dentro deste escopo.
      try {
        const outcome = await runPipelineInner(params, session);
        // COMPLETED aqui significa "o pipeline retornou sem lançar". Falha que o
        // runPipelineInner trata por dentro (ws.error e retorno normal) não vira
        // FAILED — quem quiser esse detalhe olha o `error` dos steps.
        // Interrompido a pedido do usuário também retorna sem lançar; o motivo vai
        // no `error` (ver describeInterruptedRun para o porquê de não ser FAILED).
        const runId = getAiContext().runId;
        if (runId) {
          await closeRun(runId, outcome?.interrupted
            ? { status: 'COMPLETED', error: describeInterruptedRun(outcome.interrupted) }
            : { status: 'COMPLETED' });
        }
        // O trabalho acabou (o estado da sessão já reflete isso): o que ficou
        // pendente não tem mais quem consuma e volta ao autor. Na interrupção NÃO
        // varre: quem pediu a parada leva as pendentes junto com a mensagem
        // (agents/brain/adviceHandlers.ts) — expirá-las aqui as devolveria ao campo
        // de texto de quem acabou de mandar uma mensagem por cima.
        if (!outcome?.interrupted) await settleAdviceWhenIdle(sessionId, 'ended');
      } catch (error) {
        const runId = getAiContext().runId;
        if (runId) {
          await closeRun(runId, {
            status: 'FAILED',
            error: error instanceof Error ? error.message : String(error),
          });
        }
        // Parada dura (botão "Parar geração"): o workerStatus já foi zerado por quem
        // pediu, então é seguro devolver as pendentes. Outras falhas podem ser
        // retentadas pelo BullMQ; quem varre nesse caso é o worker, só na tentativa final.
        if (error instanceof Error && error.message === 'Generation cancelled by user') {
          await settleAdviceWhenIdle(sessionId, 'ended');
        }
        throw error;
      }
    },
  );
}

async function runPipelineInner(
  params: PipelineParams,
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
): Promise<PipelineOutcome | void> {
  const { sessionId, brief, format } = params;

  // ── Carregar contexto canônico da marca ─────────────────────────────────────
  let brand;
  try {
    brand = await resolveBrandContext(session.brandSlug);
  } catch (error) {
    ws.error(sessionId, error instanceof Error ? error.message : 'Marca não encontrada');
    await updateSession(sessionId, { phase: 'error', workerStatus: 'error' });
    return;
  }

  // Preferências que a IA aprendeu no chat desta marca (skill updateBrandMemory).
  // Antes só eram gravadas, nunca lidas de volta — o usuário "ensinava" uma regra
  // e ela nunca mudava a próxima geração.
  const brandMemory = await getBrandMemory(session.brandSlug).catch(() => null);
  const learnedPreferences = brandMemory?.preferences;
  const learnedPreferencesText = learnedPreferences && Object.keys(learnedPreferences).length > 0
    ? `Regras aprendidas sobre esta marca em conversas anteriores (respeite):\n${Object.entries(learnedPreferences).map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n')}`
    : '';

  // Cérebro do Designer em camadas: ligado só nas marcas listadas em DESIGNER_BRAIN_BRANDS.
  // Ligado, o contexto legado (resumo + regras aprendidas no chat) dá lugar às camadas
  // global → projeto → modo: a memória do projeto é a do cadastro, e o chat não a reescreve.
  const designerBrainOn = isDesignerBrainEnabled(session.brandSlug);
  // Sem texto aprovado o cérebro não tem o que reproduzir literalmente, e o modelo preenche o
  // vazio com texto inventado (visto em geração real: biografia, tópicos e botões que ninguém
  // escreveu). Melhor parar e pedir o texto do que entregar texto que a marca nunca aprovou.
  if (designerBrainOn && !hasApprovedText({ sourceCopy: params.sourceCopy, approvedSkeleton: params.approvedSkeleton })) {
    ws.error(
      sessionId,
      'Esta marca só gera com texto aprovado. Envie o texto de cada slide (a copy) e eu o distribuo sem alterar nenhuma palavra.',
    );
    await updateSession(sessionId, { phase: 'listening', workerStatus: 'idle' });
    return;
  }
  let brandContext: string;
  if (designerBrainOn) {
    try {
      const brain = buildPipelineBrainContext({
        brand,
        format,
        aspectRatio: params.aspectRatio,
        pageCount: parseRequestedSlideCount(brief),
      });
      brandContext = brain.brandContext;
      if (brain.pending.length > 0) {
        logger.info('Cérebro do Designer: informações ainda não definidas', { brandSlug: brand.slug, pending: brain.pending });
      }
    } catch (error) {
      // Configuração incompleta tem de aparecer: cair no contexto legado em silêncio
      // geraria a peça com as regras erradas sem ninguém saber.
      ws.error(sessionId, error instanceof Error ? error.message : 'Cérebro do Designer mal configurado');
      await updateSession(sessionId, { phase: 'error', workerStatus: 'error' });
      return;
    }
  } else {
    brandContext = [buildBrandContextSummary(brand), learnedPreferencesText].filter(Boolean).join('\n\n');
  }

  await updateSession(sessionId, { phase: 'running', workerStatus: 'running' });
  const runningSession = await getSession(sessionId);
  if (runningSession) {
    ws.sessionState(sessionId, {
      phase: runningSession.phase,
      messages: runningSession.messages,
      currentDesign: runningSession.currentDesign,
      workerStatus: runningSession.workerStatus,
      reviewMode: runningSession.reviewMode,
    });
  }

  let currentPages = session.currentDesign;

  const checkCancelled = async () => {
    const s = await getSession(sessionId);
    if (!s || s.workerStatus !== 'running') {
      throw new Error('Generation cancelled by user');
    }
  };
  let reviewResult: ReviewResult | null = null;
  let researchedRefs: VisualRef[] = [];
  let researchSummary = '';

  const postId = params.postId ?? randomUUID();

  // ── Interrupção cooperativa ("Pausar e enviar") ─────────────────────────────
  // Objeto, e não `let`: o TS estreita uma variável atribuída só dentro de closure
  // para `null` e trataria toda checagem abaixo como código morto.
  const stop: { interruption: PipelineInterruption | null; postCreated: boolean } = {
    interruption: null,
    postCreated: false,
  };

  /** Há pedido de parada? Registra ONDE o pipeline viu (o primeiro ponto vence). */
  const stopRequested = async (stage: string): Promise<boolean> => {
    if (stop.interruption) return true;
    if (!(await isInterruptRequested(sessionId))) return false;
    stop.interruption = { stage, slidesKept: 0, total: 0 };
    return true;
  };

  /**
   * Fecha a geração parada ANTES de haver slides para salvar (planejamento, imagens):
   * o post já criado, sem nenhum slide, fica FAILED como na parada dura, e a sessão
   * volta a ouvir. Sem `session:state`: ele traz a lista de mensagens do servidor e
   * apagaria da tela a mensagem do usuário que motivou a parada, ainda não persistida.
   */
  const finishInterruptedEarly = async (): Promise<PipelineOutcome> => {
    const info = stop.interruption!;
    if (stop.postCreated) {
      // Retomada após a Amostra de Estilo: o slide 0 já existe e foi aprovado, o deck
      // continua utilizável (READY). Em qualquer outro caso ainda não há nenhum slide
      // — FAILED, igual à parada dura.
      await prisma.post.update({
        where: { id: postId },
        data: { status: params.resumeFromStyleProof ? 'READY' : 'FAILED' },
      }).catch(() => {});
    }
    await announceInterruption(info);
    return { interrupted: info };
  };

  const announceInterruption = async (info: PipelineInterruption): Promise<void> => {
    await updateSession(sessionId, { phase: 'listening', workerStatus: 'idle', activeQuestion: null });
    ws.interrupted(sessionId, { ...info, postId: stop.postCreated ? postId : undefined });
    // Só DEPOIS de o estado da sessão estar ocioso: quem espera (o handler da
    // mensagem) lê isto para abrir o turno seguinte já com a sessão consistente.
    await markInterruptStopped(sessionId, info);
  };

  // ── Orientações em tempo real ───────────────────────────────────────────────
  // Novo deck: some da lista o que era de decks anteriores; o deste (retry do job,
  // retomada após Amostra de Estilo) e as dadas no chat que originou a geração ficam.
  await pruneAdvice(sessionId, { keepScopes: [postId, ADVICE_SCOPE_CHAT] });
  // O que já valia para ESTE deck antes desta execução (retry, retomada): entra no
  // primeiro lote como se tivesse sido dito agora, senão uma retomada esqueceria
  // orientações já aplicadas.
  const carriedAdvice = (await listAdvice(sessionId))
    .filter((a) => a.status === 'applied' && a.scope === postId)
    .map((a) => a.text);
  // Tudo que está em vigor neste deck (carregado + aplicado agora): alimenta o revisor.
  const adviceInEffect: string[] = [...carriedAdvice];
  let carriedDelivered = false;

  // Geração de passo único: gera → revisa → para. NÃO regeramos automaticamente
  // a apresentação inteira. A análise do revisor é mostrada ao usuário, que
  // decide se aceita o design ou pede ajustes/refação no chat.
  await checkCancelled();
  if (await stopRequested('antes do planejamento')) return finishInterruptedEarly();
    // ── 1. Planner ────────────────────────────────────────────────────────────
    ws.progress(sessionId, 10, 'Planejando estrutura (Manager)...');

    const planBrief = brief;

    ws.progress(sessionId, 15, 'Buscando referências visuais...');
    const research = await researchBrand(brand.name, planBrief, brandContext).catch(() => ({ summary: '', refs: [] }));
    researchSummary = research.summary;
    researchedRefs = research.refs;

    const plannerBrandContext = [
      brandContext,
      researchSummary ? `Pesquisa de referências:\n${researchSummary.slice(0, 1600)}` : '',
      researchedRefs.length > 0
        ? `Referências visuais:\n${researchedRefs.map((ref) => `- ${ref.title}: ${ref.style} | Paleta: ${ref.palette.join(', ')}`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n\n');

    // Contagem explícita pedida no brief (ex.: "apresentação de 200 slides").
    // Sem ela, o planner escolhe dentro da faixa heurística.
    const requestedCount = parseRequestedSlideCount(planBrief);

    await checkCancelled();
    if (await stopRequested('antes do planejamento')) return finishInterruptedEarly();
    ws.progress(sessionId, 20, 'Planejando estrutura lógica...');
    // Roteiro pré-aprovado (fluxo copy-first): o usuário JÁ viu e confirmou esta
    // estrutura no chat — replanejar aqui jogaria fora a aprovação.
    const skeleton: SlideSkeletonItem[] = params.approvedSkeleton?.length
      ? params.approvedSkeleton
      : await runPlanner({
          brief: planBrief,
          brandContext: plannerBrandContext,
          format,
          targetSlideCount: requestedCount,
          sourceCopy: params.sourceCopy,
        }).catch((err) => {
          logger.error('Planner falhou; caindo na contagem de slides de fallback', { error: (err as Error).message });
          const count = requestedCount ?? (format === 'presentation' ? 6 : 4);
          return Array.from({ length: count }).map((_, i) => ({
            title: `Slide ${i + 1}`,
            goal: 'Apresentar conteúdo de marca',
            layout_type: i === 0 ? 'title-hero' : i === count - 1 ? 'closing' : 'content-split',
            order: i + 1,
          }));
        });

    const slideCount = skeleton.length;
    const { width, height } = resolveCanvasSize(format, params.aspectRatio);

    await checkCancelled();
    if (await stopRequested('antes de criar o deck')) {
      stop.interruption!.total = slideCount;
      return finishInterruptedEarly();
    }
    ws.progress(sessionId, 25, 'Inicializando design no banco de dados...');
    try {
      await prisma.post.create({
        data: {
          id: postId,
          brandId: brand.id,
          name: deriveDeckName(skeleton),
          // O deck nasce JÁ dentro da pasta escolhida na fábrica. Antes nascia solto e
          // o usuário tinha de ir arrastá-lo na galeria — na prática, deck gerado era
          // deck perdido. `null` = raiz, que segue sendo o default.
          folderId: session.folderId ?? null,
          type: format === 'presentation' ? 'PRESENTATION' : 'CAROUSEL',
          status: 'GENERATING',
          content: {
            kind: 'html-design',
            version: 1,
            width,
            height,
            fonts: ['Inter'],
          } satisfies Prisma.InputJsonValue,
          slides: {
            create: skeleton.map((item) => ({
              position: item.order - 1,
              contentJson: {},
              metadata: {
                title: item.title,
                goal: item.goal,
                layout_type: item.layout_type,
              } satisfies Prisma.InputJsonValue,
            })),
          },
        },
      });
      stop.postCreated = true;
    } catch (dbErr) {
      // Retry do job: o post da tentativa anterior já existe — seguimos NELE
      // (os writes incrementais são por postId+position e o update final idem).
      const updated = await prisma.post.update({
        where: { id: postId },
        data: { status: 'GENERATING' },
      }).catch(() => null);
      if (updated) {
        stop.postCreated = true;
        logger.warn('Post já existia (retry do job) — continuando no mesmo post', { postId });
      } else {
        logger.error('Falha ao pré-criar Post/Slides no banco', { error: (dbErr as Error).message });
      }
    }

    // ── Trace: o run nasce AQUI (ou é reaproveitado), e não no runPipeline ─────
    // Tentativa anterior sempre abria um run novo neste ponto, antes desta
    // criação do Post. `GenerationRun.postId` é FK para Post, e o Post ainda não
    // existia — toda abertura estourava com `GenerationRun_postId_fkey`, o
    // fail-open engolia, e o `runId` nulo levava junto o closeRun (o run ficava
    // RUNNING para sempre) e o brief/formato.
    //
    // Agora: se researchBrand/runPlanner (rodados ANTES do Post existir) já
    // abriram um run implícito via ensureRun(), reaproveitamos ele em vez de
    // abrir um segundo — ver attachRunToPost(). Depois do Post existir, a FK
    // fecha. O id vai para o AiContext, e o runPipeline o lê de volta no fim
    // para fechar o run.
    const runId = await attachRunToPost(getAiContext().runId, {
      postId,
      brandSlug: session.brandSlug,
      sessionId,
      brief: params.brief,
      format: params.format,
      aspectRatio: params.aspectRatio,
    });
    if (runId) enrichAiContext({ runId });

    // ── 1.5. Imagens dos slides que pedem (reaproveita da biblioteca ou gera) ──
    await checkCancelled();
    if (await stopRequested('antes de gerar as imagens')) {
      stop.interruption!.total = slideCount;
      return finishInterruptedEarly();
    }
    let resolvedImages: Map<number, ResolvedSlideImage>;

    if (params.resumeFromImageApproval && params.imageCandidateDecision) {
      // Retomando de uma pausa de bundle: NÃO chama resolveSlideImages de novo —
      // isso rodaria decideImagePlan (LLM) outra vez e poderia produzir uma
      // decisão DIFERENTE da que o usuário já viu e aprovou. `skeleton` aqui já é
      // o approvedSkeleton com as imagens não-ambíguas do primeiro run — só falta
      // aplicar a escolha do usuário sobre os candidatos que ficaram pendentes.
      resolvedImages = await resolveImageCandidateDecisions(
        params.imageCandidateDecision.candidates,
        params.imageCandidateDecision.decision,
        { brandName: brand.name, width, height, brandId: brand.id, postId, imagePreference: params.imagePreference, realPhotosOnly: designerBrainOn },
      ).catch((err) => {
        logger.error('Falha ao aplicar decisão do bundle de imagens; seguindo sem essas imagens', { error: (err as Error).message });
        return new Map<number, ResolvedSlideImage>();
      });
    } else {
      const { resolved, pendingCandidates } = await resolveSlideImages({
        brandId: brand.id,
        brandName: brand.name,
        brandColors: brand.colors,
        width,
        height,
        skeleton,
        postId,
        // Foto real é regra absoluta no cérebro: nada de pessoa gerada nem Unsplash. Só
        // reaproveita o que está na biblioteca ou deixa o slide sem imagem.
        allowGeneratedGraphics: designerBrainOn ? false : brand.presentationConfig?.allowGeneratedGraphics,
        imagePreference: params.imagePreference,
      }).catch((err) => {
        logger.error('Resolução de imagens dos slides falhou; seguindo sem imagens geradas', { error: (err as Error).message });
        return { resolved: new Map<number, ResolvedSlideImage>(), pendingCandidates: [] as AmbiguousImageCandidate[] };
      });

      if (pendingCandidates.length > 0) {
        // Reaproveitamento "meio-termo" achado na biblioteca — não decide sozinho,
        // pausa e pede aprovação (mesmo padrão da Amostra de Estilo). O deck fica
        // em GENERATING; a geração só continua depois da resposta no chat.
        const enrichedSoFar = skeleton.map((item, index) => ({ ...item, ...resolved.get(index) }));
        await updateSession(sessionId, {
          phase: 'listening',
          workerStatus: 'idle',
          pendingImageCandidates: {
            format,
            aspectRatio: params.aspectRatio,
            postId,
            enrichedSkeleton: enrichedSoFar,
            candidates: pendingCandidates,
            brief,
            sourceCopy: params.sourceCopy,
          },
          activeQuestion: {
            id: randomUUID(),
            kind: 'image-candidates',
            question: `Achei ${pendingCandidates.length === 1 ? 'uma foto' : `${pendingCandidates.length} fotos`} na biblioteca da marca que talvez sirva${pendingCandidates.length === 1 ? '' : 'm'} — mas não é uma correspondência óbvia. Quer usar ${pendingCandidates.length === 1 ? 'essa' : 'essas'} ou prefere que eu gere uma nova?`,
            previewImages: pendingCandidates.map((c) => ({ url: c.assetUrl, label: c.assetName })),
            options: [
              { id: 'aceitar-biblioteca', label: 'Usar as fotos da biblioteca', description: 'Reaproveita exatamente o que já foi sugerido acima' },
              { id: 'gerar-do-zero', label: 'Gerar novas fotos', description: 'Ignora essas sugestões e gera uma foto nova pra esses slides' },
            ],
            allowFreeform: false,
            allowSkip: false,
            mode: session.reviewMode,
          },
        });
        const paused = await getSession(sessionId);
        if (paused) {
          // Inclui activeQuestion (o ws.sessionState mais abaixo, no final desta
          // função, não inclui — mas o handler do frontend lê data.activeQuestion
          // pra mostrar a pergunta ativa; sem isto o bundle não apareceria ao vivo).
          ws.sessionState(sessionId, {
            phase: paused.phase,
            messages: paused.messages,
            currentDesign: paused.currentDesign,
            workerStatus: paused.workerStatus,
            reviewMode: paused.reviewMode,
            activeQuestion: paused.activeQuestion,
          });
        }
        return;
      }

      resolvedImages = resolved;
    }

    const enrichedSkeleton = skeleton.map((item, index) => ({ ...item, ...resolvedImages.get(index) }));

    // ── 2. Geração HTML/CSS (modo nativo do modelo) ───────────────────────────
    await checkCancelled();
    if (await stopRequested('antes de gerar os slides')) {
      stop.interruption!.total = slideCount;
      return finishInterruptedEarly();
    }
    ws.progress(sessionId, 30, 'Gerando design...');

    try {
      const preferredModel = config.models.artist;

      // Persistência do preview parcial no Redis, COM THROTTLE. O transporte ao
      // vivo é por deltas WS (design:slide), mas quem sai e volta no meio da
      // geração re-hidrata via session:state, que lê currentDesign do Redis.
      // Gravamos no máximo ~1x/1.5s (e sempre no último slide) — restaura o
      // preview no reconnect sem voltar ao O(n²) de gravar todo slide.
      let lastCurrentDesignPersist = 0;

      logger.info('Diagnostico: Tamanhos dos inputs da geracao', {
        planBriefLength: planBrief?.length,
        skeletonLength: skeleton?.length,
        brandName: brand?.name,
        guidelinesLength: brand?.guidelines?.length,
        agentPromptLength: brand?.agentPrompt?.length,
        logoUrlLength: brand?.logoUrl?.length,
        referencesCount: brand?.references?.length,
        visualMoodboardCount: (params.attachmentImages ?? []).filter((image) => image.role === 'style-reference').length,
      });

      const moodboardParts = await loadStyleReferenceParts(params.attachmentImages, brand.slug);
      const contentAssets = (params.attachmentImages ?? []).filter((image) => image.role !== 'style-reference');

      const design = await generateHtmlDesignBatched(
        async (systemInstruction, userPrompt) => {
          await checkCancelled();
          const response = await generateWithRetry(ai, {
            model: preferredModel,
            contents: moodboardParts.length
              ? [{ role: 'user', parts: [{ text: userPrompt }, ...moodboardParts] }]
              : userPrompt,
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
              maxOutputTokens: 32768,
              // Limita o thinking para não estourar o orçamento e truncar o JSON.
              thinkingConfig: { thinkingBudget: config.geminiThinkingBudget },
            },
          }, preferredModel);
          // Diagnóstico: MAX_TOKENS => JSON truncado. Fica visível no log do worker.
          const finish = response.candidates?.[0]?.finishReason;
          if (finish && finish !== 'STOP') {
            logger.warn('Geração terminou sem STOP — o JSON pode vir truncado', { finishReason: finish, textLength: response.text?.length ?? 0 });
          }
          return response.text ?? '{}';
        },
        {
          prompt: planBrief,
          format,
          width,
          height,
          slideCount,
          brand: {
            name: brand.name,
            colors: brand.colors,
            primaryFonts: brand.primaryFonts,
            guidelines: brand.guidelines,
            agentPrompt: brand.agentPrompt,
            // Cérebro ligado: as camadas substituem diretrizes e instruções legadas no artista.
            designerBrain: designerBrainOn ? brandContext : undefined,
            logoUrl: brand.logoUrl,
            // Fotos anexadas pelo usuário no chat entram JUNTO com os assets da
            // marca — o artista as trata igual, prefere a inventar foto de banco.
            assetUrls: [...contentAssets, ...brand.assetUrls],
            presentationConfig: brand.presentationConfig ?? undefined,
            references: brand.references,
            // Com o cérebro ligado a memória do projeto é a do cadastro: o que o chat
            // "aprendeu" não a reescreve (isolamento entre projetos).
            learnedPreferences: designerBrainOn ? undefined : learnedPreferences,
          },
          skeleton: params.generateStyleProofOnly
            ? enrichedSkeleton.slice(0, 1)
            : params.resumeFromStyleProof
              ? enrichedSkeleton.slice(1)
              : enrichedSkeleton,
        },
        extractJsonObject,
        // A cada slide pronto: transmite o delta (preview ao vivo) e emite
        // progresso na faixa 30%→80%. Com lotes paralelos os slides chegam fora
        // de ordem — por isso o progresso usa `completed` (monotônico), não index.
        async (partial, index, totalSlides, completed) => {
          await checkCancelled();
          const slide = partial.slides[index];

          // Envelope LEVE (sem o array de slides) — o front acumula os deltas e
          // reconstrói o mesmo envelope. Antes reescrevíamos/transmitíamos o
          // design inteiro a cada slide (O(n²) em Redis + WS); agora é O(1) por
          // slide. A persistência incremental fica na tabela relacional `slides`
          // (abaixo); o Redis currentDesign é gravado uma vez só, no fim.
          const envelope = {
            kind: 'html-design' as const,
            version: 1 as const,
            source: 'codegen' as const,
            // Identidade do deck: o front usa isto pra saber quando um novo deck
            // começa e resetar o acúmulo de slides (evita misturar com o anterior).
            postId,
            width: partial.width,
            height: partial.height,
            format: partial.format,
            fonts: partial.fonts,
            reasoning: partial.reasoning,
            slides: [] as unknown[],
          };
          const realIndex = params.resumeFromStyleProof ? index + 1 : index;
          const realTotal = params.resumeFromStyleProof ? totalSlides + 1 : totalSlides;
          ws.designSlide(sessionId, { index: realIndex, total: realTotal, slide, envelope });

          // Persistência incremental: salva o slide individual na tabela relacional.
          try {
            const existingSlide = await prisma.slide.findFirst({
              where: { postId, position: realIndex },
            });
            if (existingSlide) {
              await prisma.slide.update({
                where: { id: existingSlide.id },
                data: {
                  contentJson: slide as unknown as Prisma.InputJsonValue,
                },
              });
            }
          } catch (slideDbErr) {
            logger.error('Falha ao salvar slide gerado', { slide: index + 1, error: (slideDbErr as Error).message });
          }

          // Persiste o preview parcial no Redis (throttled) para o reconnect.
          const now = Date.now();
          if (now - lastCurrentDesignPersist > 1500 || completed === totalSlides) {
            lastCurrentDesignPersist = now;
            const liveEnvelope = {
              ...envelope,
              slides: (partial.slides as unknown[]).filter(Boolean),
            };
            currentPages = [liveEnvelope] as unknown as typeof currentPages;
            await updateSession(sessionId, { currentDesign: currentPages }).catch((e) =>
              logger.error('Falha ao persistir preview parcial', { error: (e as Error).message }),
            );
          }

          ws.progress(
            sessionId,
            30 + Math.round((completed / totalSlides) * 50),
            `Gerando slide ${completed} de ${totalSlides}...`,
          );
        },
        {
          concurrency: config.generationConcurrency,
          // Ponto seguro de CONSUMO de orientações: o início de cada lote. Drena as
          // pendentes (atômico: já as marca aplicadas, com o lote onde entraram) e as
          // devolve ao gerador, que as injeta neste lote e nos seguintes.
          getPendingAdvice: async ({ batch, totalBatches }) => {
            const fresh = await consumePendingAdvice(sessionId, {
              stage: `lote ${batch} de ${totalBatches}`,
              scope: postId,
            });
            const texts = fresh.map((a) => a.text);
            adviceInEffect.push(...texts);
            // As já valendo antes desta execução (retry/retomada) entram uma vez só.
            if (!carriedDelivered) {
              carriedDelivered = true;
              return [...carriedAdvice, ...texts];
            }
            return texts;
          },
          // Ponto seguro de PARADA: o limite entre lotes.
          shouldStop: async ({ batch, totalBatches }) =>
            stopRequested(`antes do lote ${batch} de ${totalBatches}`),
        },
      );

      // Texto aprovado × texto do slide, ANTES do envelope e do revisor: o slide que diverge volta
      // ao artista (no máximo 2 rodadas) e o revisor e o usuário já veem o deck corrigido. É código,
      // não prompt: o reviewer visual olha uma amostra e não confere palavras.
      const geradosDaCopia = params.resumeFromStyleProof ? enrichedSkeleton.slice(1) : enrichedSkeleton;
      const textoSemCopiaPorSlide = designerBrainOn && !geradosDaCopia.some((item) => item.copy?.trim());
      let textIssuesLeft: TextIssue[] = [];
      let textSlidesFixed = 0;
      if (textoSemCopiaPorSlide) {
        // Sem a copy distribuída por slide (o planner falhou e caiu no esqueleto genérico) não
        // há como conferir slide a slide: pular com aviso é melhor que acusar o deck inteiro.
        logger.warn('Cérebro ligado, mas o roteiro não distribuiu a copy por slide: checagem de texto pulada', { brandSlug: brand.slug });
      } else if (designerBrainOn && !stop.interruption) {
        ws.progress(sessionId, 83, 'Conferindo o texto com o aprovado...');
        const corrigir = async (slide: { html: string; css?: string }, instruction: string): Promise<{ html: string; css?: string }> => {
          await checkCancelled();
          return editHtmlSlide(
            async (systemInstruction, userPrompt) => {
              const response = await generateWithRetry(ai, {
                model: preferredModel,
                contents: userPrompt,
                config: { systemInstruction, responseMimeType: 'application/json', maxOutputTokens: 16384 },
              }, preferredModel);
              return response.text ?? '{}';
            },
            {
              slide,
              instruction,
              brand: {
                name: brand.name,
                colors: brand.colors,
                primaryFonts: brand.primaryFonts,
                guidelines: brand.guidelines ?? undefined,
                // Com o cérebro ligado as camadas já estão no contexto; ele é a memória do projeto.
                agentPrompt: brandContext,
              },
              width: design.width,
              height: design.height,
              isolate: true,
            },
            extractJsonObject,
          );
        };
        const resultado = await correctTextDivergences({
          approved: geradosDaCopia.map((item) => item.copy),
          slides: design.slides,
          editSlide: corrigir,
          indexOffset: params.resumeFromStyleProof ? 1 : 0,
        });
        design.slides = resultado.slides;
        textIssuesLeft = resultado.remaining;
        textSlidesFixed = resultado.corrected.length;
        logger.info('Conferência do texto aprovado', {
          brandSlug: brand.slug,
          rodadas: resultado.attempts,
          corrigidos: textSlidesFixed,
          restantes: textIssuesLeft.map((i) => i.slideIndex + 1),
        });
      }

      // Moldura padrão nos espaços de foto vazios: a mesma em todos os slides, desenhada pelo sistema.
      if (designerBrainOn) {
        design.slides = design.slides.map((slide) => ({ ...slide, html: normalizeEmptyPhotoSlots(slide.html) }));
      }

      // Envelope de conteúdo (preview no front + persistência). kind html-design.
      const content = {
        kind: 'html-design' as const,
        version: 1 as const,
        source: 'codegen' as const,
        postId,
        width: design.width,
        height: design.height,
        format: design.format,
        fonts: design.fonts,
        slides: design.slides,
        reasoning: design.reasoning,
      };

      // Persiste no Redis + broadcast WS (design:update). O frontend renderiza o
      // envelope html-design via HtmlSlideRenderer (preview da Fábrica).
      if (design.slides.length > 0) {
        currentPages = await executeTool('set_design', { pages: [content] }, sessionId, currentPages);
      }

      // ── 3. Reviewer (visão sobre render fiel em chromium) ─────────────────────
      await checkCancelled();
      // Parada pedida durante o último lote (ou já vista por um lote): o deck com o
      // que existe segue para o salvamento; o revisor não roda.
      if (!stop.interruption) await stopRequested('antes do revisor');
      if (stop.interruption) {
        stop.interruption.slidesKept = design.slides.length;
        stop.interruption.total = slideCount;
      } else {
        ws.progress(sessionId, 85, 'Revisando resultado...');

        await updateSession(sessionId, { phase: 'reviewing', workerStatus: 'running' });
        const reviewingSession = await getSession(sessionId);
        if (reviewingSession) {
          ws.sessionState(sessionId, {
            phase: reviewingSession.phase,
            messages: reviewingSession.messages,
            currentDesign: reviewingSession.currentDesign,
            workerStatus: reviewingSession.workerStatus,
            reviewMode: reviewingSession.reviewMode,
          });
        }

        // Ponto seguro de consumo, o segundo: antes do revisor. A orientação que
        // chegou durante o último lote entra aqui — o revisor julga o deck contra
        // o que o usuário pediu DEPOIS do briefing, não só contra o briefing.
        const reviewerAdvice = await consumePendingAdvice(sessionId, { stage: 'revisor', scope: postId });
        adviceInEffect.push(...reviewerAdvice.map((a) => a.text));
        const reviewerBrief = adviceInEffect.length > 0
          ? `${brief}\n\nOrientações do usuário dadas durante a geração (o deck deve refleti-las):\n${adviceLines(adviceInEffect).join('\n')}`
          : brief;

        // Reviewer do HTML: crítica sobre o render fiel (rasteriza em chromium e o
        // modelo multimodal vê a arte). Fail-safe: se o reviewer estourar, aprova
        // para não travar a entrega.
        try {
          reviewResult = await runHtmlReviewer(design, brandContext, reviewerBrief);
        } catch (reviewErr) {
          logger.error('Reviewer HTML falhou; aprovando por segurança (fail-safe)', { error: (reviewErr as Error).message });
          reviewResult = { approved: true, score: 75, deviations: [], feedback: 'Revisão automática indisponível', correctionInstructions: undefined };
        }

        // O que o laço de correção não conseguiu resolver vira desvio do mesmo formato do reviewer:
        // aparece na análise do chat, deixa o deck como "precisa de revisão" e alimenta o ajuste
        // cirúrgico quando a pessoa recusa. Um veredito só: se o texto reprova, o "peça aprovada"
        // do revisor visual não vai junto (a mensagem se contradizia).
        if (textIssuesLeft.length > 0) {
          logger.warn('Texto dos slides difere do texto aprovado', {
            slides: textIssuesLeft.map((i) => i.slideIndex + 1),
            brandSlug: brand.slug,
          });
          const feedback = textSlidesFixed > 0
            ? `Corrigi o texto de ${textSlidesFixed} slide(s) sozinho, mas o de ${textIssuesLeft.length} slide(s) ainda não confere com o texto aprovado.`
            : `O texto de ${textIssuesLeft.length} slide(s) não confere com o texto aprovado.`;
          reviewResult = {
            ...reviewResult,
            approved: false,
            deviations: [...(reviewResult.deviations ?? []), ...textIssuesToDeviations(textIssuesLeft)],
            // O texto manda no veredito: só mantém a crítica visual se ela já apontava problemas.
            feedback: reviewResult.approved ? feedback : `${feedback} ${reviewResult.feedback ?? ''}`.trim(),
          };
        } else if (textSlidesFixed > 0) {
          reviewResult = {
            ...reviewResult,
            feedback: `Corrigi o texto de ${textSlidesFixed} slide(s) para ficar igual ao aprovado. ${reviewResult.feedback ?? ''}`.trim(),
          };
        }

        // Guarda o review na sessão MESMO quando aprovado: se o usuário recusar
        // (review:decline), o brain usa estas deviations para montar um [EDIT]
        // cirúrgico — sem isto a recusa só tinha o texto solto do chat e a única
        // saída era regenerar o deck inteiro. O brain limpa no approve/decline.
        await updateSession(sessionId, {
          pendingReview: {
            score: reviewResult.score,
            feedback: reviewResult.feedback,
            deviations: reviewResult.deviations ?? [],
          },
        });
      }

      // Sem auto-regeneração: se o revisor não aprovou, mantemos ESTE design e
      // mostramos a análise para o usuário decidir o próximo passo no chat.
      if (reviewResult && !reviewResult.approved) {
        const deviationsText = (reviewResult.deviations ?? [])
          .map((d) => `- [${d.severity}] Slide ${d.slideIndex + 1}: ${d.description}${d.fix ? ` → ${d.fix}` : ''}`)
          .join('\n');
        ws.token(
          sessionId,
          `\n\n**Análise do revisor (score ${reviewResult.score}/100):** ${reviewResult.feedback}\n${deviationsText ? `\n${deviationsText}\n` : ''}\n*Mantive este design como está. Me diga se quer que eu ajuste algo específico ou refaça do zero.*\n`,
        );
      }


      // Fonte oficial do projeto que o sistema não consegue carregar: o artista usou uma substituta.
      // Antes isso passava em silêncio; agora o resultado diz qual faltou e qual entrou no lugar.
      if (designerBrainOn && design.slides.length > 0) {
        const aviso = fontSubstitutionNotice({ official: officialFontsFor(brand.slug), used: design.fonts });
        if (aviso) {
          logger.warn('Fonte oficial do projeto indisponível, usando substituta', { brandSlug: brand.slug, usadas: design.fonts });
          ws.token(sessionId, `

${aviso}
`);
        }
      }

    } catch (err) {
      const isCancellation = err instanceof Error && err.message === 'Generation cancelled by user';
      if (isCancellation) {
        logger.info('Geração interrompida pelo usuário durante o design/review', { sessionId, postId });
        await prisma.post.update({
          where: { id: postId },
          data: { status: 'FAILED' },
        }).catch(() => {});
        throw err;
      }

      logger.error('Erro na geração de design', {
        postId,
        slideCount,
        model: config.models.artist,
        error: (err as Error).message,
        stack: (err as Error).stack,
      });
      // Atualiza o status do post para FAILED no banco de dados
      await prisma.post.update({
        where: { id: postId },
        data: { status: 'FAILED' },
      }).catch(() => {});
      
      ws.error(sessionId, `Não consegui gerar o design agora. ${humanizeGeminiError(err)}`);
      throw err;
    }

  // Parou no primeiro limite de lote, antes de sair um slide sequer: não há o que
  // salvar. Mesmo desfecho da parada antes da geração.
  if (stop.interruption && stop.interruption.slidesKept === 0) {
    return finishInterruptedEarly();
  }

  // ── Salvar post no banco ────────────────────────────────────────────────────
  // Também é o caminho da interrupção COM slides: o que já foi gerado é persistido
  // como um deck de verdade. O syncPostSlides apaga as linhas-placeholder dos
  // slides que não chegaram a ser gerados, então o deck fica com N reais, sem buracos.
  try {
    // currentPages[0] é o envelope html-design; persistimos ele + histórico de chat.
    const envelope = (currentPages[0] ?? {}) as unknown as Record<string, unknown>;
    const postContent = {
      ...envelope,
      sessionId,
      chatHistory: session.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
        .map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          attachments: m.attachments?.map((a) => ({ name: a.name, mimeType: a.mimeType, dataBase64: a.dataBase64 })),
        })),
    };

    // Remove o array pesado de slides do JSON do post para usar a tabela slides
    // (a tabela relacional é a fonte).
    const contentToSave: Record<string, unknown> = { ...postContent };
    delete contentToSave.slides;

    // Quais assets da Biblioteca de Mídia entraram de fato no deck — pra mostrar
    // um card de transparência na tela ("usei estas imagens da sua marca").
    // Cobre tanto o que o artista escolheu sozinho da lista oferecida (assetUrls)
    // quanto o que o imageResolver já resolveu por slide.
    try {
      const finalSlides = Array.isArray(envelope.slides) ? (envelope.slides as HtmlDesignSlide[]) : [];
      const htmlBlob = buildSlidesHtmlBlob(finalSlides);
      const offeredUrls = (brand.assetUrls ?? []).map((a) => a.url);
      const detectedUrls = detectAssetUrlsInHtml(htmlBlob, offeredUrls);
      const usedAssetUrls = mergeUsedAssetUrls(detectedUrls, Array.from(resolvedImages.values()).map((v) => v.imageUrl));

      if (usedAssetUrls.length > 0) {
        const usedAssets = await prisma.asset.findMany({
          where: { brandId: brand.id, url: { in: usedAssetUrls } },
          select: { id: true, url: true, name: true },
        });
        contentToSave.usedAssets = usedAssets;
      }
    } catch (err) {
      logger.warn('Falha ao detectar assets usados no deck (não bloqueia o save)', { postId, error: (err as Error).message });
    }

    await prisma.post.update({
      where: { id: postId },
      data: {
        status: 'READY',
        content: contentToSave as Prisma.InputJsonValue,
      },
    });

    // Sincroniza os slides gerados com a tabela slides relacional
    await syncPostSlides(postId, postContent);

    // Atualiza memória de longo prazo da marca
    const mem = await import('../lib/redis.js').then(m => m.getBrandMemory(session.brandSlug));
    await updateBrandMemory(session.brandSlug, {
      pastPresentations: [
        ...mem.pastPresentations,
        { id: postId, title: brief.slice(0, 60), templateIds: [], createdAt: Date.now() },
      ].slice(-20),
    });
    // Captura os slides gerados como assets da marca (fila própria, best-effort
    // — não atrasa nem arrisca a resposta que o usuário já está vendo na tela).
    // Import dinâmico: queue.ts importa este módulo para o worker do pipeline,
    // um import estático aqui criaria ciclo.
    import('../lib/queue.js')
      .then((m) => m.enqueueAssetCapture({ postId }))
      .catch((err) => logger.error('Falha ao enfileirar captura de assets', { postId, error: (err as Error).message }));
  } catch (err) {
    logger.error('Falha ao salvar o post', { error: (err as Error).message });
  }

  // ── Finalizar ──────────────────────────────────────────────────────────────
  // Interrompido com slides salvos: NÃO é `done` (sem "o que achou do resultado?",
  // sem notificação de conclusão, sem revisão) nem Amostra de Estilo. A sessão volta a
  // ouvir e o cliente é avisado de onde parou; a mensagem do usuário, que motivou a
  // parada, é o próximo turno.
  if (stop.interruption) {
    await announceInterruption(stop.interruption);
    return { interrupted: stop.interruption };
  }

  if (params.generateStyleProofOnly) {
    await updateSession(sessionId, { 
      phase: 'listening', // Volta para listening para aprovar a amostra
      workerStatus: 'idle',
      pendingStyleProof: {
        format,
        aspectRatio: params.aspectRatio,
        postId,
        skeleton,
        brief,
        sourceCopy: params.sourceCopy,
      },
      activeQuestion: {
        id: randomUUID(),
        kind: 'generic',
        question: 'Gerei o primeiro slide como amostra visual. O estilo agradou? Posso seguir por essa linha?',
        options: [
          { id: 'aprovado', label: 'Aprovado', description: 'Gerar o restante da apresentação' },
          { id: 'reprovado', label: 'Quero mudar algo', description: 'Ajustar o estilo primeiro' }
        ],
        allowFreeform: true,
        allowSkip: false,
        mode: session.reviewMode,
      }
    });
  } else {
    await updateSession(sessionId, { 
      phase: 'done', 
      workerStatus: 'done',
      activeQuestion: {
        id: randomUUID(),
        kind: 'generic',
        question: 'O que achou do resultado?',
        options: [
          { id: 'aprovado', label: 'Ficou ótimo!', description: 'Finalizar e manter assim' },
          { id: 'reprovado', label: 'Quero mudar algo', description: 'Pedir ajustes e salvar na memória' }
        ],
        allowFreeform: true,
        allowSkip: true,
        mode: session.reviewMode,
      }
    });
  }
  const finalSession = await getSession(sessionId);
  if (finalSession) {
    ws.sessionState(sessionId, {
      phase: finalSession.phase,
      messages: finalSession.messages,
      currentDesign: finalSession.currentDesign,
      workerStatus: finalSession.workerStatus,
      reviewMode: finalSession.reviewMode,
    });
  }

  if (postId) ws.done(sessionId, postId);

  ws.notify(sessionId, {
    kind: reviewResult?.approved ? 'done' : 'needs_review',
    message: reviewResult?.feedback ?? 'Design gerado com sucesso!',
    sessionId,
  });
}
