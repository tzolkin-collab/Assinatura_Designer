import { GoogleGenAI } from '@google/genai';
import { randomUUID } from 'crypto';
import { config } from '../../config.js';
import {
  getSession,
  updateSession,
  appendMessage,
  getRecentSession,
  touchRecentBrand,
  createSession,
  type ChatAttachment,
  type ChatMessage,
  type FabricaSession,
} from '../../lib/redis.js';
import type { FabricaQuestion, PresentationConfig, ReviewMode } from '../../lib/fabricaSession.js';
import { ws, onWsMessage, type WsAttachment } from '../../lib/websocket.js';
import { generateStreamWithRetry, generateWithRetry, humanizeGeminiError } from '../../lib/geminiRetry.js';
import { enqueuePipeline } from '../../lib/queue.js';
import { BRAIN_SYSTEM_PROMPT } from './prompts.js';
import prisma from '../../lib/prisma.js';
import { editHtmlSlide, type HtmlDesignContent } from '../../lib/htmlDesign.js';
import { executeTool } from '../tools/index.js';
import { resolveBrandContext } from '../../lib/brandContext.js';
import { mergeSlidesIntoPost, syncPostSlides } from '../../lib/postHelper.js';
import { snapshotPost } from '../../lib/postVersions.js';
import { runWithAiContext, enrichAiContext } from '../../lib/aiContext.js';
import { extractJsonObject } from '../../lib/designDocument.js';
import { logger } from '../../lib/logger.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

function parseQuestionTag(response: string, mode: ReviewMode): FabricaQuestion | null {
  const match = response.match(/\[QUESTION:\s*(\{[\s\S]*?\})\s*\]/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1]) as {
      q?: string;
      options?: unknown;
      kind?: string;
      field?: string;
      helperText?: string;
      allowFreeform?: boolean;
      allowSkip?: boolean;
    };

    if (typeof parsed.q !== 'string' || parsed.q.trim().length === 0 || !Array.isArray(parsed.options)) {
      return null;
    }

    const options = parsed.options
      .map((option, index) => {
        if (typeof option === 'string') {
          return { id: `option-${index + 1}`, label: option, value: option };
        }
        if (option && typeof option === 'object' && typeof (option as { label?: unknown }).label === 'string') {
          const optionObj = option as { id?: unknown; label: string; description?: unknown; value?: unknown };
          return {
            id: typeof optionObj.id === 'string' ? optionObj.id : `option-${index + 1}`,
            label: optionObj.label,
            description: typeof optionObj.description === 'string' ? optionObj.description : undefined,
            value: typeof optionObj.value === 'string' ? optionObj.value : optionObj.label,
          };
        }
        return null;
      })
      .filter((option): option is NonNullable<typeof option> => option !== null);

    if (options.length === 0) return null;

    const allowedKinds = new Set<FabricaQuestion['kind']>(['palette', 'format', 'priority', 'brief', 'style', 'generic']);
    const kind = typeof parsed.kind === 'string' && allowedKinds.has(parsed.kind as FabricaQuestion['kind'])
      ? parsed.kind as FabricaQuestion['kind']
      : 'generic';

    return {
      id: randomUUID(),
      kind,
      question: parsed.q.trim(),
      options,
      allowFreeform: parsed.allowFreeform !== false,
      allowSkip: parsed.allowSkip !== false,
      mode,
      field: typeof parsed.field === 'string' ? parsed.field : undefined,
      helperText: typeof parsed.helperText === 'string' ? parsed.helperText : undefined,
    };
  } catch {
    return null;
  }
}

function stripQuestionTag(content: string): string {
  // Remove tags de controle (QUESTION/EDIT/DISPATCH) da mensagem exibida ao usuário.
  // A detecção de despacho/edição usa o texto cru (fullResponse), então isto é seguro.
  return content
    .replace(/\[QUESTION:\s*(\{[\s\S]*?\})\s*\]/g, '')
    .replace(/\[EDIT:\s*(\{[\s\S]*?\})\s*\]/gi, '')
    .replace(/\[DISPATCH:(presentation|carousel)\]/gi, '')
    .trim();
}

function emitSessionState(sessionId: string, session: NonNullable<Awaited<ReturnType<typeof getSession>>>) {
  ws.sessionState(sessionId, {
    phase: session.phase,
    messages: session.messages,
    currentDesign: session.currentDesign,
    workerStatus: session.workerStatus,
    reviewMode: session.reviewMode,
    activeQuestion: session.activeQuestion,
  });
}

function buildQuestionAnswerMessage(
  question: FabricaQuestion | null | undefined,
  payload: { optionLabel?: string; freeform?: string; skipped?: boolean },
): string {
  if (!question) {
    return payload.freeform?.trim() || payload.optionLabel?.trim() || 'Pode pular e decidir no modo automático.';
  }

  if (payload.skipped) {
    return `Pode pular a pergunta "${question.question}" e decidir no modo automático.`;
  }

  if (payload.freeform && payload.freeform.trim()) {
    return `Em resposta à pergunta "${question.question}": ${payload.freeform.trim()}`;
  }

  const answer = payload.optionLabel?.trim();
  if (answer) return answer;

  return `Pode pular a pergunta "${question.question}" e decidir no modo automático.`;
}

const BRAIN_MODEL = 'gemini-2.5-pro';

function normalizeAttachments(value: unknown): ChatAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const attachments = value
    .filter((item) => item && typeof item === 'object')
    .map((item) => item as WsAttachment)
    .filter((item) => typeof item.name === 'string'
      && typeof item.mimeType === 'string'
      && item.mimeType.startsWith('image/')
      && typeof item.dataBase64 === 'string'
      && item.dataBase64.trim().length > 0)
    .slice(0, 6)
    .map((item) => ({
      name: item.name,
      mimeType: item.mimeType,
      dataBase64: item.dataBase64,
    }));

  return attachments.length > 0 ? attachments : undefined;
}

function buildModelMessage(content: string, attachments?: ChatAttachment[]): string {
  if (!attachments || attachments.length === 0) return content;
  const attachmentBlock = attachments
    .map((attachment, index) => `- Imagem ${index + 1}: ${attachment.name} (${attachment.mimeType})`)
    .join('\n');
  return `${content}\n\n[Imagens anexadas pelo usuário]\n${attachmentBlock}`;
}

// ── Bootstrap: registra handlers WebSocket ────────────────────────────────────

export function initBrainHandlers(): void {
  // Mensagem do usuário
  onWsMessage('message', async (sessionId, userId, data) => {
    const { content, attachments } = data as { content: string; attachments?: unknown };
    if (!content?.trim()) return;
    await handleUserMessage(sessionId, userId, content.trim(), normalizeAttachments(attachments));
  });

  onWsMessage('question:answer', async (sessionId, userId, data) => {
    const payload = (data ?? {}) as {
      optionLabel?: string;
      freeform?: string;
      skipped?: boolean;
      attachments?: unknown;
    };
    const session = await getSession(sessionId);
    const message = buildQuestionAnswerMessage(session?.activeQuestion, payload);
    if (!message.trim()) return;
    await handleUserMessage(sessionId, userId, message, normalizeAttachments(payload.attachments));
  });

  // Aprovação manual do resultado
  onWsMessage('review:approve', async (sessionId) => {
    await updateSession(sessionId, { phase: 'done', activeQuestion: null });
    const updated = await getSession(sessionId);
    if (updated) emitSessionState(sessionId, updated);
    ws.token(sessionId, '\n\nPerfeito! O design foi aprovado e está na galeria.');
  });

  // Rejeição manual com instruções de correção
  onWsMessage('review:decline', async (sessionId, userId, data) => {
    const { reason } = (data ?? {}) as { reason?: string };
    const session = await getSession(sessionId);
    if (!session) return;

    await updateSession(sessionId, { phase: 'revising', workerStatus: 'running', activeQuestion: null });
    const updated = await getSession(sessionId);
    if (updated) emitSessionState(sessionId, updated);
    ws.token(sessionId, '\n\nEntendido, vou corrigir. Um momento...');
    await enqueuePipeline({
      sessionId,
      brief: reason ?? 'Refazer com melhorias gerais',
      format: 'presentation',
    });
  });

  // Trocar modo auto/manual
  onWsMessage('mode:set', async (sessionId, _, data) => {
    const { mode } = data as { mode: 'auto' | 'manual' };
    const current = await getSession(sessionId);
    const nextQuestion = current?.activeQuestion
      ? { ...current.activeQuestion, mode }
      : current?.activeQuestion ?? null;
    await updateSession(sessionId, {
      reviewMode: mode,
      activeQuestion: nextQuestion,
    });
    const latest = await getSession(sessionId);
    if (latest) emitSessionState(sessionId, latest);
  });
}

// ── Criar sessão ──────────────────────────────────────────────────────────────

export async function createBrainSession(params: {
  sessionId: string;
  brandSlug: string;
  userId?: string;
  brandContextSummary: string;
  presentationConfig?: PresentationConfig;
}) {
  const reviewMode: ReviewMode = params.presentationConfig?.autoMode ? 'auto' : 'manual';
  const session = await createSession(params.sessionId, params.brandSlug, params.userId, reviewMode);

  // Injeta contexto de marca na memória da sessão
  await appendMessage(params.sessionId, {
    role: 'system',
    content: `Contexto da marca:\n${params.brandContextSummary}`,
    timestamp: Date.now(),
  });

  if (params.userId) await touchRecentBrand(params.userId, params.brandSlug);

  return session;
}

// ── Reconectar sessão existente ───────────────────────────────────────────────

export async function reconnectSession(sessionId: string, userId?: string) {
  // Tenta hot cache primeiro (reabertura rápida de aba)
  const recent = await getRecentSession(sessionId);
  if (recent) {
    if (userId && recent.userId && recent.userId !== userId) return null;
    emitSessionState(sessionId, recent);
    return recent;
  }

  let session = await getSession(sessionId);
  
  // Fallback: se a sessão expirou no Redis, tenta recuperar do histórico do Post
  if (!session) {
    try {
      // Procura post que contenha esse sessionId no content (JSON)
      const post = await prisma.post.findFirst({
        where: {
          content: {
            path: ['sessionId'],
            equals: sessionId
          }
        },
        include: { brand: true, slides: { orderBy: { position: 'asc' } } }
      });
      
      if (post && post.content) {
        const postWithSlides = mergeSlidesIntoPost(post);
        const content = (postWithSlides?.content ?? {}) as {
          chatHistory?: ChatMessage[];
          pages?: FabricaSession['currentDesign'];
        };
        if (content.chatHistory) {
          // Recria a sessão no Redis a partir do histórico
          // Dono da sessão é quem criou o post — não "o dono da marca" (campo legacy removido).
          session = await createSession(sessionId, post.brand.slug, post.createdById ?? undefined);
          session.messages = content.chatHistory;
          session.phase = 'done';
          if (content.pages) {
            session.currentDesign = content.pages;
          }
          await updateSession(sessionId, session);
          logger.info('Sessão recuperada a partir do Post', { sessionId, postId: post.id });
        }
      }
    } catch (err) {
      logger.error('Erro ao recuperar sessão do banco', { error: (err as Error).message });
    }
  }

  if (!session) return null;
  if (userId && session.userId && session.userId !== userId) return null;

  emitSessionState(sessionId, session);
  return session;
}

// ── Processar mensagem do usuário ─────────────────────────────────────────────

function getSessionBrandContextSummary(session: NonNullable<Awaited<ReturnType<typeof getSession>>>): string {
  const systemMessage = session.messages.find((message) => message.role === 'system');
  if (!systemMessage?.content) return '';
  return systemMessage.content.replace(/^Contexto da marca:\s*/u, '').trim();
}

async function handleUserMessage(
  sessionId: string,
  userId: string | undefined,
  userMessage: string,
  attachments?: ChatAttachment[],
): Promise<void> {
  // O chat é o caminho mais usado do produto: sem o contexto aqui, o gasto de IA
  // dele ficaria sem marca e o teto por marca seria furado justamente por ele.
  return runWithAiContext({ sessionId, userId, feature: 'chat', requestId: sessionId }, () =>
    handleUserMessageInner(sessionId, userId, userMessage, attachments),
  );
}

async function handleUserMessageInner(
  sessionId: string,
  userId: string | undefined,
  userMessage: string,
  attachments?: ChatAttachment[],
): Promise<void> {
  // Retry curto para absorver gap de reconexão Redis pós-ECONNRESET
  let session = await getSession(sessionId);
  if (!session) {
    await new Promise(r => setTimeout(r, 1200));
    session = await getSession(sessionId);
  }
  if (!session) {
    ws.error(sessionId, 'Sessão expirou ou não foi encontrada. Recarregue a página.');
    return;
  }

  if (userId && session.userId && session.userId !== userId) return;

  // A marca só se conhece depois de carregar a sessão; sem isto o gasto do chat
  // não cairia no teto da marca.
  enrichAiContext({ brandSlug: session.brandSlug });

  // Persiste mensagem do usuário
  await appendMessage(sessionId, {
    role: 'user',
    content: userMessage,
    timestamp: Date.now(),
    attachments,
  });
  if (session.activeQuestion) {
    await updateSession(sessionId, { activeQuestion: null });
  }
  const latestSession = await getSession(sessionId);
  if (!latestSession) return;

  const brandContextSummary = getSessionBrandContextSummary(latestSession);

  // Constrói histórico para o LLM (apenas user + assistant)
  const history = latestSession.messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role === 'user' ? 'user' : 'model' as const,
      parts: [{ text: buildModelMessage(m.content, m.attachments) }],
    }));

  // Remove a última (já está em userMessage)
  const historyWithoutLast = history.slice(0, -1);

  try {
    const stream = await generateStreamWithRetry(ai, {
      model: BRAIN_MODEL,
      contents: [
        ...historyWithoutLast,
        { role: 'user', parts: [{ text: `[FASE: ${latestSession.phase.toUpperCase()}]\n\n${buildModelMessage(userMessage, attachments)}` }] },
      ],
      config: {
        systemInstruction: [
          BRAIN_SYSTEM_PROMPT,
          brandContextSummary ? `## Contexto atual da marca\n${brandContextSummary}` : '',
        ].filter(Boolean).join('\n\n'),
        temperature: 0.7,
        thinkingConfig: { thinkingBudget: 6000 },
      },
    }, BRAIN_MODEL, {
      onRetry: ({ attempt }) => {
        ws.token(sessionId, attempt === 1
          ? '\n\nO modelo está com alta demanda. Tentando novamente...\n\n'
          : '\n\nAinda estou tentando destravar a geração...\n\n');
      },
      onFallback: () => {
        ws.token(sessionId, '\n\nTroquei para um modelo de fallback para não travar sua criação.\n\n');
      },
    });

    let fullResponse = '';

    for await (const chunk of stream) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if ((part as { thought?: boolean }).thought) {
          const thoughtText = (part as { text?: string }).text ?? '';
          if (thoughtText) {
            ws.emit(sessionId, 'thinking', { text: thoughtText });
          }
          continue;
        }
        const text = (part as { text?: string }).text ?? '';
        if (!text) continue;
        fullResponse += text;
        ws.token(sessionId, text);
      }
    }

    const activeQuestion = parseQuestionTag(fullResponse, latestSession.reviewMode);
    const assistantMessage = stripQuestionTag(fullResponse);

    // Persiste resposta do Brain
    await appendMessage(sessionId, { role: 'assistant', content: assistantMessage, timestamp: Date.now() });
    await updateSession(sessionId, { activeQuestion });

    // Sinaliza fim do stream conversacional (habilita input no frontend)
    ws.end(sessionId);

    const refreshedSession = await getSession(sessionId);
    if (refreshedSession) emitSessionState(sessionId, refreshedSession);

    // Detecta dispatch → inicia pipeline
    await detectAndDispatch(sessionId, refreshedSession ?? latestSession, fullResponse, userMessage);

  } catch (err) {
    ws.error(sessionId, humanizeGeminiError(err));
  }
}

// ── Detectar sinal de despacho para o pipeline ────────────────────────────────

async function detectAndDispatch(
  sessionId: string,
  session: Awaited<ReturnType<typeof getSession>>,
  response: string,
  _userMessage: string,
): Promise<void> {
  if (!session) return;

  // [EDIT:{...}] — ajuste cirúrgico de uma arte existente, SEM regenerar tudo.
  const editMatch = response.match(/\[EDIT:\s*(\{[\s\S]*?\})\s*\]/i);
  if (editMatch) {
    const applied = await applySlideEdits(sessionId, session, editMatch[1] as string);
    if (applied) return; // editou preservando o resto; não cai no dispatch
    // Se não havia arte para editar ou o payload era inválido, segue para DISPATCH.
  }

  // [DISPATCH:presentation] ou [DISPATCH:carousel]
  const match = response.match(/\[DISPATCH:(presentation|carousel)\]/i);
  if (!match) return;

  const format = match[1] as 'presentation' | 'carousel';

  await updateSession(sessionId, { phase: 'ready', workerStatus: 'running', activeQuestion: null });
  const updated = await getSession(sessionId);
  if (updated) emitSessionState(sessionId, updated);

  // Concatena as intenções do usuário para formar o brief completo (essencial para edições)
  const fullBrief = session.messages
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join('\n\n[Nova solicitação de edição]:\n');

  // Enfileira a geração (durável, com retry) — não bloqueia o stream. O erro
  // aqui é só de enfileiramento (ex.: Redis fora); falhas da geração em si são
  // tratadas no worker (queue.ts) e notificadas via ws.
  enqueuePipeline({ sessionId, brief: fullBrief, format }).catch(err => {
    logger.error('Falha ao enfileirar o pipeline', { error: (err as Error).message });
    ws.error(sessionId, `Erro ao iniciar a geração: ${err instanceof Error ? err.message : String(err)}`);
  });
}

// ── Ajuste cirúrgico de slides (preserva o design existente) ──────────────────
// Aplica editHtmlSlide apenas nos slides citados, mantendo o resto idêntico.
// Retorna false (sem editar) se não houver arte html-design ou o payload for
// inválido — nesse caso o chamador pode seguir para regeneração completa.
async function applySlideEdits(
  sessionId: string,
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  rawPayload: string,
): Promise<boolean> {
  let payload: { edits?: Array<{ index?: number; instruction?: string }> };
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return false;
  }
  const edits = Array.isArray(payload.edits) ? payload.edits : [];
  if (edits.length === 0) return false;

  const envelope = (session.currentDesign?.[0] ?? null) as unknown as HtmlDesignContent | null;
  if (!envelope || envelope.kind !== 'html-design' || !Array.isArray(envelope.slides) || envelope.slides.length === 0) {
    return false; // sem arte html-design para editar → cai para DISPATCH
  }

  let brand;
  try {
    brand = await resolveBrandContext(session.brandSlug);
  } catch {
    return false;
  }

  const model = config.geminiDesignDocumentModel || 'gemini-3.1-pro-preview';
  const slides = [...envelope.slides];
  const width = envelope.width ?? 1080;
  const height = envelope.height ?? 1080;

  // Congela o design de antes da IA mexer. Depois do loop de edições o estado
  // anterior já não existe em lugar nenhum — o post é sobrescrito no fim daqui.
  try {
    const alvo = await prisma.post.findFirst({
      where: { content: { path: ['sessionId'], equals: sessionId } },
      select: { id: true },
    });
    if (alvo) {
      const instrucoes = edits
        .map(e => (typeof e?.instruction === 'string' ? e.instruction.trim() : ''))
        .filter(Boolean)
        .join('; ');
      await snapshotPost(alvo.id, {
        source: 'AI',
        label: `Antes da IA ajustar o design: "${instrucoes.slice(0, 100)}"`,
      });
    }
  } catch (err) {
    // Não derruba a edição por causa do histórico, mas o usuário perde o ponto de volta.
    logger.error('Falha ao versionar o design antes da edição por IA', { error: (err as Error).message });
  }

  await updateSession(sessionId, { phase: 'revising', workerStatus: 'running', activeQuestion: null });
  const revising = await getSession(sessionId);
  if (revising) emitSessionState(sessionId, revising);

  let changed = 0;
  for (let i = 0; i < edits.length; i++) {
    const instruction = typeof edits[i]?.instruction === 'string' ? edits[i]!.instruction!.trim() : '';
    if (!instruction) continue;
    const idx = Math.max(0, Math.min(Number(edits[i]?.index) || 0, slides.length - 1));
    ws.progress(sessionId, 40 + Math.round(((i + 1) / edits.length) * 50), `Ajustando slide ${idx + 1}...`);
    try {
      slides[idx] = await editHtmlSlide(
        async (si, up) =>
          (await generateWithRetry(ai, {
            model,
            contents: up,
            config: { systemInstruction: si, responseMimeType: 'application/json', maxOutputTokens: 32768 },
          }, model)).text ?? '{}',
        {
          slide: slides[idx]!,
          instruction,
          brand: { name: brand.name, colors: brand.colors, primaryFonts: brand.primaryFonts },
          width,
          height,
        },
        extractJsonObject,
      );
      changed++;
    } catch (err) {
      logger.error('editHtmlSlide falhou', { slide: idx, error: (err as Error).message });
    }
  }

  if (changed === 0) return false;

  const newEnvelope: HtmlDesignContent = { ...envelope, slides };
  // set_design persiste currentDesign no Redis e faz broadcast (ws.designUpdate).
  await executeTool('set_design', { pages: [newEnvelope] }, sessionId, session.currentDesign);

  // Persiste no Post correspondente (galeria/reconexão), se existir.
  try {
    const post = await prisma.post.findFirst({ where: { content: { path: ['sessionId'], equals: sessionId } } });
    if (post && post.content) {
      const content = post.content as Record<string, unknown>;
      content.slides = slides;

      // Sincroniza os slides relacionais na tabela slides
      await syncPostSlides(post.id, content);

      // Remove os slides do blob para manter a tabela leve
      const contentToSave = { ...content };
      delete contentToSave.slides;

      await prisma.post.update({
        where: { id: post.id },
        data: { content: contentToSave as import('@prisma/client').Prisma.InputJsonValue },
      });
    }
  } catch (err) {
    logger.error('Falha ao persistir a edição no Post', { error: (err as Error).message });
  }

  await updateSession(sessionId, { phase: 'done', workerStatus: 'done' });
  const done = await getSession(sessionId);
  if (done) emitSessionState(sessionId, done);
  ws.token(sessionId, `\n\n*Ajustei ${changed} slide${changed > 1 ? 's' : ''} e mantive o resto do design intacto.*\n`);
  return true;
}
