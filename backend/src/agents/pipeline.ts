import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { getSession, updateSession, updateBrandMemory } from '../lib/redis.js';
import { ws } from '../lib/websocket.js';
import { buildBrandContextSummary, resolveBrandContext } from '../lib/brandContext.js';
import { executeTool } from './tools/index.js';
import { runPlanner, MAX_SLIDES, type SlideSkeletonItem } from './planner/index.js';
import { runHtmlReviewer } from './reviewer/index.js';
import type { ReviewResult } from './reviewer/index.js';
import { generateHtmlDesignBatched } from '../lib/htmlDesign.js';
import { syncPostSlides } from '../lib/postHelper.js';
import { researchBrand, type VisualRef } from '../lib/fabricaLegacy.js';
import { humanizeGeminiError } from '../lib/geminiRetry.js';
import { extractJsonObject } from '../lib/designDocument.js';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { generateWithRetry } from '../lib/geminiRetry.js';
import { runWithAiContext } from '../lib/aiContext.js';
import { logger } from '../lib/logger.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
// Extrai uma contagem de slides pedida no brief ("de 200 slides", "50 lâminas",
// "30 páginas"). Clampa ao teto de sanidade. Retorna undefined se não citada.
export function parseRequestedSlideCount(brief: string): number | undefined {
  const m = brief.match(/(\d{1,4})\s*(slides?|l[aâ]minas?|p[aá]ginas?|telas?|cards?)/i);
  if (!m) return undefined;
  const n = parseInt(m[1]!, 10);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.min(n, MAX_SLIDES);
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
  /** Roteiro PRÉ-APROVADO pelo usuário no chat (fluxo copy-first): quando
   *  presente, o pipeline NÃO replaneja — gera exatamente estes slides, com a
   *  copy verbatim que cada item carrega. */
  approvedSkeleton?: SlideSkeletonItem[];
  /** Copy oficial completa (para o planner, quando não há roteiro aprovado). */
  sourceCopy?: string;
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
    { sessionId, brandSlug: session.brandSlug, feature: 'pipeline', requestId: sessionId },
    () => runPipelineInner(params, session),
  );
}

async function runPipelineInner(
  params: PipelineParams,
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
): Promise<void> {
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

  const brandContext = buildBrandContextSummary(brand);

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
  let reviewResult: ReviewResult | null = null;
  let researchedRefs: VisualRef[] = [];
  let researchSummary = '';

  const postId = params.postId ?? randomUUID();

  // Geração de passo único: gera → revisa → para. NÃO regeramos automaticamente
  // a apresentação inteira. A análise do revisor é mostrada ao usuário, que
  // decide se aceita o design ou pede ajustes/refação no chat.
  {
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

    ws.progress(sessionId, 20, 'Planejando estrutura lógica...');
    // Roteiro pré-aprovado (fluxo copy-first): o usuário JÁ viu e confirmou esta
    // estrutura no chat — replanejar aqui jogaria fora a aprovação.
    const skeleton = params.approvedSkeleton?.length
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
    const width = format === 'presentation' ? 1920 : 1080;
    const height = 1080;

    ws.progress(sessionId, 25, 'Inicializando design no banco de dados...');
    try {
      await prisma.post.create({
        data: {
          id: postId,
          brandId: brand.id,
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
    } catch (dbErr) {
      // Retry do job: o post da tentativa anterior já existe — seguimos NELE
      // (os writes incrementais são por postId+position e o update final idem).
      const updated = await prisma.post.update({
        where: { id: postId },
        data: { status: 'GENERATING' },
      }).catch(() => null);
      if (updated) {
        logger.warn('Post já existia (retry do job) — continuando no mesmo post', { postId });
      } else {
        logger.error('Falha ao pré-criar Post/Slides no banco', { error: (dbErr as Error).message });
      }
    }

    // ── 2. Geração HTML/CSS (modo nativo do modelo) ───────────────────────────
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
      });

      const design = await generateHtmlDesignBatched(
        async (systemInstruction, userPrompt) => {
          const response = await generateWithRetry(ai, {
            model: preferredModel,
            contents: userPrompt,
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
            logoUrl: brand.logoUrl,
          },
          skeleton,
        },
        extractJsonObject,
        // A cada slide pronto: transmite o delta (preview ao vivo) e emite
        // progresso na faixa 30%→80%. Com lotes paralelos os slides chegam fora
        // de ordem — por isso o progresso usa `completed` (monotônico), não index.
        async (partial, index, totalSlides, completed) => {
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
          ws.designSlide(sessionId, { index, total: totalSlides, slide, envelope });

          // Persistência incremental: salva o slide individual na tabela relacional.
          try {
            const existingSlide = await prisma.slide.findFirst({
              where: { postId, position: index },
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
        { concurrency: config.generationConcurrency },
      );

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
      currentPages = await executeTool('set_design', { pages: [content] }, sessionId, currentPages);

      // ── 3. Reviewer (visão sobre render fiel em chromium) ─────────────────────
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

      // Reviewer do HTML: crítica sobre o render fiel (rasteriza em chromium e o
      // modelo multimodal vê a arte). Fail-safe: se o reviewer estourar, aprova
      // para não travar a entrega.
      try {
        reviewResult = await runHtmlReviewer(design, brandContext, brief);
      } catch (reviewErr) {
        logger.error('Reviewer HTML falhou; aprovando por segurança (fail-safe)', { error: (reviewErr as Error).message });
        reviewResult = { approved: true, score: 75, deviations: [], feedback: 'Revisão automática indisponível', correctionInstructions: undefined };
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

      // Sem auto-regeneração: se o revisor não aprovou, mantemos ESTE design e
      // mostramos a análise para o usuário decidir o próximo passo no chat.
      if (!reviewResult.approved) {
        const deviationsText = (reviewResult.deviations ?? [])
          .map((d) => `- [${d.severity}] Slide ${d.slideIndex + 1}: ${d.description}${d.fix ? ` → ${d.fix}` : ''}`)
          .join('\n');
        ws.token(
          sessionId,
          `\n\n**Análise do revisor (score ${reviewResult.score}/100):** ${reviewResult.feedback}\n${deviationsText ? `\n${deviationsText}\n` : ''}\n*Mantive este design como está. Me diga se quer que eu ajuste algo específico ou refaça do zero.*\n`,
        );
      }

    } catch (err) {
      logger.error('Erro no DesignDocument', {
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
  }

  // ── Salvar post no banco ────────────────────────────────────────────────────
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

    // Remove o array pesado de slides do JSON do post para usar a tabela slides.
    // html-design guarda em `slides` (topo); ir-design em `ir.slides` — sem tirar
    // este último o blob duplica o deck inteiro (a tabela relacional é a fonte).
    const contentToSave: Record<string, unknown> = { ...postContent };
    delete contentToSave.slides;
    if (contentToSave.kind === 'ir-design' && contentToSave.ir) {
      const ir = { ...(contentToSave.ir as Record<string, unknown>) };
      delete ir.slides;
      contentToSave.ir = ir;
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
  } catch (err) {
    logger.error('Falha ao salvar o post', { error: (err as Error).message });
  }

  // ── Finalizar ──────────────────────────────────────────────────────────────
  await updateSession(sessionId, { phase: 'done', workerStatus: 'done' });
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
