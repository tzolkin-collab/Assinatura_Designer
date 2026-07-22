import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { getSession, updateSession, updateBrandMemory, getBrandMemory } from '../lib/redis.js';
import { ws } from '../lib/websocket.js';
import { buildBrandContextSummary, resolveBrandContext } from '../lib/brandContext.js';
import { executeTool } from './tools/index.js';
import { runPlanner, MAX_SLIDES, type SlideSkeletonItem } from './planner/index.js';
import { runHtmlReviewer } from './reviewer/index.js';
import type { ReviewResult } from './reviewer/index.js';
import { generateHtmlDesignBatched, type HtmlDesignSlide } from '../lib/htmlDesign.js';
import { syncPostSlides } from '../lib/postHelper.js';
import { researchBrand, type VisualRef } from '../lib/fabricaLegacy.js';
import { resolveSlideImages } from '../lib/imageResolver.js';
import { buildSlidesHtmlBlob, detectAssetUrlsInHtml, mergeUsedAssetUrls } from '../lib/assetUsage.js';
import { humanizeGeminiError } from '../lib/geminiRetry.js';
import { extractJsonObject } from '../lib/jsonHelper.js';
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
  /** Se true, o pipeline gera apenas a capa (Slide 0) e pausa aguardando aprovação visual. */
  generateStyleProofOnly?: boolean;
  /** Se true, o pipeline retoma a geração de uma pausa de estilo (gerando do Slide 1 em diante). */
  resumeFromStyleProof?: boolean;
  /** Fotos que o usuário anexou no chat desta sessão (já com URL do R2) — o
   *  artista as recebe igual a um asset da marca, podendo embutir de verdade. */
  attachmentImages?: Array<{ url: string; name: string }>;
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

  // Preferências que a IA aprendeu no chat desta marca (skill updateBrandMemory).
  // Antes só eram gravadas, nunca lidas de volta — o usuário "ensinava" uma regra
  // e ela nunca mudava a próxima geração.
  const brandMemory = await getBrandMemory(session.brandSlug).catch(() => null);
  const learnedPreferences = brandMemory?.preferences;
  const learnedPreferencesText = learnedPreferences && Object.keys(learnedPreferences).length > 0
    ? `Regras aprendidas sobre esta marca em conversas anteriores (respeite):\n${Object.entries(learnedPreferences).map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n')}`
    : '';

  const brandContext = [buildBrandContextSummary(brand), learnedPreferencesText].filter(Boolean).join('\n\n');

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

  // Geração de passo único: gera → revisa → para. NÃO regeramos automaticamente
  // a apresentação inteira. A análise do revisor é mostrada ao usuário, que
  // decide se aceita o design ou pede ajustes/refação no chat.
  await checkCancelled();
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

    await checkCancelled();
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

    // ── 1.5. Imagens dos slides que pedem (reaproveita da biblioteca ou gera) ──
    await checkCancelled();
    const resolvedImages = await resolveSlideImages({
      brandId: brand.id,
      brandName: brand.name,
      brandColors: brand.colors,
      width,
      height,
      skeleton,
      postId,
      allowGeneratedGraphics: brand.presentationConfig?.allowGeneratedGraphics,
      allowSvgLayouts: brand.presentationConfig?.allowSvgLayouts,
    }).catch((err) => {
      logger.error('Resolução de imagens dos slides falhou; seguindo sem imagens geradas', { error: (err as Error).message });
      return new Map<number, { imageUrl?: string; svgMarkup?: string }>();
    });
    const enrichedSkeleton = skeleton.map((item, index) => ({ ...item, ...resolvedImages.get(index) }));

    // ── 2. Geração HTML/CSS (modo nativo do modelo) ───────────────────────────
    await checkCancelled();
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
          await checkCancelled();
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
            // Fotos anexadas pelo usuário no chat entram JUNTO com os assets da
            // marca — o artista as trata igual, prefere a inventar foto de banco.
            assetUrls: [...(params.attachmentImages ?? []), ...brand.assetUrls],
            presentationConfig: brand.presentationConfig ?? undefined,
            references: brand.references,
            learnedPreferences,
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
      await checkCancelled();
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
  if (params.generateStyleProofOnly) {
    await updateSession(sessionId, { 
      phase: 'listening', // Volta para listening para aprovar a amostra
      workerStatus: 'idle',
      pendingStyleProof: {
        format,
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
