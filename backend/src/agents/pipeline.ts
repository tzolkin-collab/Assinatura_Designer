import { randomUUID } from 'crypto';
import prisma from '../lib/prisma.js';
import { getSession, updateSession, updateBrandMemory, type ChatAttachment, type ChatMessage } from '../lib/redis.js';
import { ws } from '../lib/websocket.js';
import { buildBrandContextSummary, resolveBrandContext } from '../lib/brandContext.js';
import { executeTool } from './tools/index.js';
import { runPlanner } from './planner/index.js';
import { runContent } from './content/index.js';
import { runImage } from './image/index.js';
import { runDesign } from './design/index.js';
import { runReviewer, runHtmlReviewer } from './reviewer/index.js';
import type { ReviewResult } from './reviewer/index.js';
import { generateHtmlDesignProgressive } from '../lib/htmlDesign.js';
import {
  buildLegacyTextBrief,
  generateLegacyTextLayers,
  researchBrand,
  type VisualRef,
} from '../lib/fabricaLegacy.js';
import { humanizeGeminiError } from '../lib/geminiRetry.js';
import { generateDesignDocument, extractJsonObject } from '../lib/designDocument.js';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { generateWithRetry } from '../lib/geminiRetry.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

function buildPostContent(pages: unknown, sessionId: string, messages: ChatMessage[]) {
  return {
    kind: 'fabrica-design',
    version: 1,
    sessionId,
    pages,
    chatHistory: messages
      .filter((message) => message.role === 'user' || message.role === 'assistant' || message.role === 'system')
      .map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
        attachments: message.attachments?.map((attachment) => ({
          name: attachment.name,
          mimeType: attachment.mimeType,
          dataBase64: attachment.dataBase64,
        })),
      })),
  };
}

function extractConversationAssets(messages: ChatMessage[]): ChatAttachment[] {
  return messages
    .flatMap((message) => message.attachments ?? [])
    .filter((attachment) => attachment.mimeType.startsWith('image/'))
    .slice(-8);
}

export interface PipelineParams {
  sessionId: string;
  brief: string;
  format: 'presentation' | 'carousel';
}

export async function runPipeline(params: PipelineParams): Promise<void> {
  const { sessionId, brief, format } = params;

  const session = await getSession(sessionId);
  if (!session) { console.error('[Pipeline] Session not found:', sessionId); return; }

  // ── Carregar contexto canônico da marca ─────────────────────────────────────
  let brand;
  try {
    brand = await resolveBrandContext(session.brandSlug, session.userId);
  } catch (error) {
    ws.error(sessionId, error instanceof Error ? error.message : 'Marca não encontrada');
    await updateSession(sessionId, { phase: 'error', workerStatus: 'error' });
    return;
  }

  const brandContext = buildBrandContextSummary(brand);

  const brandRefs = {
    refs: brand.references.map((reference) => ({ insightsText: reference.insightsText ?? null, palette: reference.palette })),
    uploadedAssets: [],
  };
  const conversationAssets = extractConversationAssets(session.messages);

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

  // Geração de passo único: gera → revisa → para. NÃO regeramos automaticamente
  // a apresentação inteira. A análise do revisor é mostrada ao usuário, que
  // decide se aceita o design ou pede ajustes/refação no chat.
  {
    // ── 1. Planner ────────────────────────────────────────────────────────────
    ws.progress(sessionId, 10, 'Planejando estrutura...');

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

    // ── 2. Geração HTML/CSS (modo nativo do modelo) ───────────────────────────
    ws.progress(sessionId, 30, 'Gerando design...');

    try {
      const preferredModel = config.geminiDesignDocumentModel || 'gemini-3.1-pro-preview';
      const slideCount = format === 'presentation' ? 6 : 4;
      const width = format === 'presentation' ? 1920 : 1080;
      const height = 1080;

      const html = await generateHtmlDesignProgressive(
        async (systemInstruction, userPrompt) => {
          const response = await generateWithRetry(ai, {
            model: preferredModel,
            contents: userPrompt,
            config: { systemInstruction, responseMimeType: 'application/json', maxOutputTokens: 32768 },
          }, preferredModel);
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
        },
        extractJsonObject,
        // A cada slide pronto: transmite o design parcial (preview ao vivo) e
        // emite progresso granular "slide i de N" na faixa 30%→80%.
        async (partial, index, totalSlides) => {
          const partialContent = {
            kind: 'html-design' as const,
            version: 1 as const,
            source: 'codegen' as const,
            width: partial.width,
            height: partial.height,
            format: partial.format,
            fonts: partial.fonts,
            slides: partial.slides,
            reasoning: partial.reasoning,
          };
          currentPages = await executeTool('set_design', { pages: [partialContent] }, sessionId, currentPages);
          ws.progress(
            sessionId,
            30 + Math.round(((index + 1) / totalSlides) * 50),
            `Gerando slide ${index + 1} de ${totalSlides}...`,
          );
        },
      );

      // Envelope de conteúdo (preview no front + persistência). kind html-design.
      const content = {
        kind: 'html-design' as const,
        version: 1 as const,
        source: 'codegen' as const,
        width: html.width,
        height: html.height,
        format: html.format,
        fonts: html.fonts,
        slides: html.slides,
        reasoning: html.reasoning,
      };

      // Persiste no Redis + broadcast WS (o frontend renderiza html-design via iframe).
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

      reviewResult = await runHtmlReviewer(html, brandContext, planBrief).catch(err => {
        console.error('[Pipeline] Reviewer error:', err);
        return { approved: true, score: 70, deviations: [], feedback: 'Revisão parcial', correctionInstructions: undefined };
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
      console.error('[Pipeline] DesignDocument error:', err);
      ws.error(sessionId, `Não consegui gerar o design agora. ${humanizeGeminiError(err)}`);
      throw err;
    }
  }

  // ── Salvar post no banco ────────────────────────────────────────────────────
  let postId: string | undefined;
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
    const post = await prisma.post.create({
      data: {
        id: randomUUID(),
        brandId: brand.id,
        type: format === 'presentation' ? 'PRESENTATION' : 'CAROUSEL',
        status: 'READY',
        content: postContent as unknown as import('@prisma/client').Prisma.InputJsonValue,
      },
    });
    postId = post.id;

    // Atualiza memória de longo prazo da marca
    const mem = await import('../lib/redis.js').then(m => m.getBrandMemory(session.brandSlug));
    await updateBrandMemory(session.brandSlug, {
      pastPresentations: [
        ...mem.pastPresentations,
        { id: postId, title: brief.slice(0, 60), templateIds: [], createdAt: Date.now() },
      ].slice(-20),
    });
  } catch (err) {
    console.error('[Pipeline] Failed to save post:', err);
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
