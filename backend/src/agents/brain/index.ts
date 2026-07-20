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
import { extractJsonObject } from '../../lib/jsonHelper.js';
import { editHtmlSlide, type HtmlDesignSlide } from '../../lib/htmlDesign.js';
import { enqueuePipeline } from '../../lib/queue.js';
import { BRAIN_SYSTEM_PROMPT } from './prompts.js';
import prisma from '../../lib/prisma.js';
import { executeTool } from '../tools/index.js';
import { mergeSlidesIntoPost, persistPostContent } from '../../lib/postHelper.js';
import { snapshotPost } from '../../lib/postVersions.js';
import { runWithAiContext, enrichAiContext } from '../../lib/aiContext.js';
import { logger } from '../../lib/logger.js';
import { generateIRPatchForSlide } from '../../lib/designIR/aiPatch.js';
import { applyPatchToSlide } from '../../lib/designIR/patcher.js';
import type { SlideNode as IRSlideNode } from '../../lib/designIR/types.js';
import { runPlanner, type SlideSkeletonItem } from '../planner/index.js';
import { parseRequestedSlideCount } from '../pipeline.js';
import { extractBracketedJson, stripBracketedJson, mapDeviationsToEdits } from '../../lib/tagExtract.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

function parseQuestionTag(response: string, mode: ReviewMode): FabricaQuestion | null {
  // Extrator balanceado: a regex lazy antiga truncava no primeiro `}` seguido de
  // `]`, o que quebrava a tag sempre que uma opção era objeto (`{label, ...}`).
  const match = extractBracketedJson(response, 'QUESTION');
  if (!match) return null;

  try {
    const parsed = JSON.parse(match.json) as {
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
  // QUESTION/EDIT passam pelo extrator balanceado — a regex lazy antiga deixava
  // resíduo de JSON aninhado (opções-objeto, payload do [EDIT]) vazar para o chat.
  return stripBracketedJson(
    stripBracketedJson(
      content.replace(/\[DISPATCH:(presentation|carousel)\]/gi, ''),
      'QUESTION',
    ),
    'EDIT',
  );
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

const BRAIN_MODEL = config.models.brain;

// ── Fluxo copy-first: detecção da copy oficial na conversa ─────────────────────
// A Gabi entrega a copy inteira (colada no chat ou como anexo de texto). Quando
// ela existe, o deck NÃO nasce de um brief resumido: o planner distribui esse
// texto verbatim pelos slides e o usuário aprova o roteiro ANTES da geração.

/** Mensagem avulsa só vira "copy" se for claramente um texto colado, não um pedido. */
const LONG_MESSAGE_CHARS = 1200;
/** Total mínimo para ativar o fluxo copy-first (roteiro + pausa de aprovação). */
const COPY_MIN_CHARS = 500;

function decodeTextAttachment(a: ChatAttachment): string | null {
  const isText = (a.mimeType ?? '').startsWith('text/') || /\.(txt|md|markdown|csv)$/i.test(a.name ?? '');
  if (!isText || !a.dataBase64) return null;
  try {
    return Buffer.from(a.dataBase64, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function extractSourceCopy(messages: ChatMessage[]): string | undefined {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role !== 'user') continue;
    for (const a of m.attachments ?? []) {
      const text = decodeTextAttachment(a);
      if (text?.trim()) parts.push(`--- ${a.name} ---\n${text.trim()}`);
    }
    if (m.content.length >= LONG_MESSAGE_CHARS) parts.push(m.content);
  }
  const joined = parts.join('\n\n');
  return joined.length >= COPY_MIN_CHARS ? joined : undefined;
}

/** Resumo legível do roteiro para o chat (títulos + amostra da copy por slide). */
function resumoDoRoteiro(skeleton: SlideSkeletonItem[]): string {
  const MAX_LINHAS = 30;
  const linhas = skeleton.slice(0, MAX_LINHAS).map((s) => {
    const copyPreview = s.copy ? ` — “${s.copy.replace(/\s+/g, ' ').slice(0, 70)}${s.copy.length > 70 ? '…' : ''}”` : '';
    return `${s.order}. **${s.title}** (${s.layout_type})${copyPreview}`;
  });
  if (skeleton.length > MAX_LINHAS) linhas.push(`… e mais ${skeleton.length - MAX_LINHAS} slides.`);
  return linhas.join('\n');
}

const APROVAR_ROTEIRO_LABEL = 'Aprovar roteiro e gerar';

/**
 * Planeja o roteiro a partir da copy oficial e PAUSA para aprovação no chat.
 * A geração só é enfileirada quando o usuário aprova (interceptação determinística
 * em handleUserMessageInner) — é a pausa barata ANTES do trabalho caro.
 */
async function planAndAskApproval(
  sessionId: string,
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  format: 'presentation' | 'carousel',
  fullBrief: string,
  sourceCopy: string,
): Promise<void> {
  await updateSession(sessionId, { phase: 'ready', workerStatus: 'running' });
  const planning = await getSession(sessionId);
  if (planning) emitSessionState(sessionId, planning);
  ws.token(sessionId, '\n\nRecebi a copy oficial — montando o roteiro slide a slide para você aprovar antes de eu gerar...\n');

  try {
    const skeleton = await runPlanner({
      brief: fullBrief,
      brandContext: getSessionBrandContextSummary(session),
      format,
      targetSlideCount: parseRequestedSlideCount(fullBrief),
      sourceCopy,
    });

    const texto = `\n**Roteiro proposto (${skeleton.length} slides, copy oficial distribuída):**\n\n${resumoDoRoteiro(skeleton)}\n\n*Confira se a divisão da copy faz sentido. Ao aprovar, eu gero o deck inteiro de uma vez, sem mais pausas.*`;
    ws.token(sessionId, texto);
    await appendMessage(sessionId, { role: 'assistant', content: texto.trim(), timestamp: Date.now() });

    await updateSession(sessionId, {
      pendingPlan: { format, skeleton, sourceCopy, brief: fullBrief },
      activeQuestion: {
        id: randomUUID(),
        kind: 'generic',
        question: 'O roteiro está bom?',
        options: [
          { id: 'aprovar', label: APROVAR_ROTEIRO_LABEL, description: 'Gerar o deck inteiro com esta estrutura e copy' },
          { id: 'ajustar', label: 'Ajustar o roteiro', description: 'Me diga o que mudar que eu replanejo' },
        ],
        allowFreeform: true,
        allowSkip: false,
        mode: session.reviewMode,
      },
      phase: 'listening',
      workerStatus: 'idle',
    });
    const atual = await getSession(sessionId);
    if (atual) emitSessionState(sessionId, atual);
  } catch (err) {
    // Planner indisponível: não trava a entrega — gera direto (o pipeline ainda
    // recebe a copy e replaneja lá dentro, só perde a pausa de aprovação).
    logger.error('Roteiro copy-first falhou; caindo para geração direta', { error: (err as Error).message });
    ws.token(sessionId, '\n\n*Não consegui montar o roteiro prévio agora — vou gerar direto usando a copy como fonte.*\n');
    enqueuePipeline({ sessionId, brief: fullBrief, format, sourceCopy }).catch((e) => {
      logger.error('Falha ao enfileirar o pipeline (fallback copy-first)', { error: (e as Error).message });
      ws.error(sessionId, `Erro ao iniciar a geração: ${(e as Error).message}`);
    });
  }
}

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
    // Limpa o pendingReview junto: a decisão foi tomada, as deviations guardadas
    // não podem vazar para um decline FUTURO de um deck diferente.
    await updateSession(sessionId, { phase: 'done', activeQuestion: null, pendingReview: null });
    const updated = await getSession(sessionId);
    if (updated) emitSessionState(sessionId, updated);
    ws.token(sessionId, '\n\nPerfeito! O design foi aprovado e está na galeria.');
  });

  // Rejeição manual com instruções de correção.
  //
  // Com arte existente + deviations do último review (session.pendingReview), o
  // decline vira um [EDIT] cirúrgico — só os slides apontados são refeitos e o
  // resto do deck sobrevive. Antes a recusa sempre regenerava TUDO: recusar por
  // 2 slides ruins destruía os outros 13 bons. Sem arte ou sem deviations úteis,
  // cai no comportamento legado (regeneração total com o brief).
  onWsMessage('review:decline', async (sessionId, userId, data) => {
    const { reason } = (data ?? {}) as { reason?: string };
    const session = await getSession(sessionId);
    if (!session) return;

    // Ownership check no mesmo padrão do handleUserMessage: sem isto, quem tivesse
    // o sessionId de outra pessoa poderia rejeitar e REGENERAR o deck dela.
    if (userId && session.userId && session.userId !== userId) return;

    const pending = session.pendingReview ?? null;

    // Comportamento legado: regeneração total. O pendingReview morre aqui também —
    // qualquer que seja o caminho do decline, a decisão sobre aquele review foi
    // tomada e ele não pode vazar para o próximo deck.
    const regenerarTudo = async (brief: string) => {
      await updateSession(sessionId, {
        phase: 'revising',
        workerStatus: 'running',
        activeQuestion: null,
        pendingReview: null,
      });
      const updated = await getSession(sessionId);
      if (updated) emitSessionState(sessionId, updated);
      ws.token(sessionId, '\n\nEntendido, vou corrigir. Um momento...');
      await enqueuePipeline({
        sessionId,
        brief,
        format: 'presentation',
      });
    };

    // Fonte de verdade da arte é o Post (mesmo padrão do applySlideEdits): o
    // currentDesign do Redis expira e volta vazio na reconexão — decidir "não há
    // arte" por ele regeneraria um deck que existe.
    const postRow = await prisma.post.findFirst({
      where: { content: { path: ['sessionId'], equals: sessionId } },
      include: { slides: { orderBy: { position: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });

    const arte = (postRow ? mergeSlidesIntoPost(postRow).content : null) as {
      kind?: string;
      ir?: { slides?: unknown[] };
      slides?: unknown[];
    } | null;
    const totalSlides = arte?.kind === 'ir-design' && Array.isArray(arte.ir?.slides)
      ? arte.ir.slides.length
      : arte?.kind === 'html-design' && Array.isArray(arte.slides)
        ? arte.slides.length
        : 0;
    const temArte = postRow !== null && totalSlides > 0;

    if (temArte) {
      const edits = mapDeviationsToEdits(pending?.deviations ?? [], reason, totalSlides);
      if (edits.length > 0) {
        // Edição cirúrgica: applySlideEdits já snapshot, emite progresso, persiste
        // e atualiza o preview ao vivo — aqui só tratamos o desfecho.
        const resultado = await applySlideEdits(sessionId, session, JSON.stringify({ edits }));
        if (resultado.outcome === 'editado') {
          const slides = [...new Set(edits.map((e) => e.index + 1))].sort((a, b) => a - b).join(', ');
          ws.token(sessionId, `\n\nAjustei os slides ${slides} com base na revisão e mantive o resto do design intacto.`);
          await updateSession(sessionId, { pendingReview: null });
          return;
        }
        if (resultado.outcome === 'falhou') {
          // Diz a verdade antes de regenerar: a cirurgia falhou, então o que resta
          // é o que o decline sempre fez.
          ws.token(sessionId, `\n\n*Não consegui aplicar os ajustes pontuais (${resultado.motivo}) — vou refazer a peça inteira.*`);
        }
        // 'sem-arte' aqui = a arte sumiu entre a checagem e a edição; cai no legado.
      }
    }

    // Brief do legado: o motivo da pessoa primeiro; sem ele, o feedback do revisor
    // (quando há arte — as deviations viraram texto útil); senão o default de sempre.
    const brief = reason ?? (temArte ? pending?.feedback : undefined) ?? 'Refazer com melhorias gerais';
    await regenerarTudo(brief);
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

  // Cancelar geração da IA
  onWsMessage('generation:cancel', async (sessionId, userId) => {
    const session = await getSession(sessionId);
    if (!session) return;

    // Validação de ownership
    if (userId && session.userId && session.userId !== userId) return;

    // Atualiza o estado da sessão para interromper a execução no pipeline
    await updateSession(sessionId, {
      workerStatus: 'idle',
      phase: 'listening',
    });

    const latest = await getSession(sessionId);
    if (latest) emitSessionState(sessionId, latest);

    // Emite mensagem no chat informando o cancelamento
    ws.token(sessionId, '\n\nGeração interrompida pelo usuário.');

    // Cancela/remove os jobs correspondentes na fila do BullMQ
    try {
      const { pipelineQueue } = await import('../../lib/queue.js');
      const jobs = await pipelineQueue.getJobs(['active', 'waiting', 'delayed']);
      for (const job of jobs) {
        if (job.id?.startsWith(`${sessionId}-`)) {
          await job.remove().catch(() => {});
        }
      }
    } catch (err) {
      logger.error('Erro ao cancelar jobs do pipeline no BullMQ', { sessionId, error: (err as Error).message });
    }
  });
}

// ── Criar sessão ──────────────────────────────────────────────────────────────

export async function createBrainSession(params: {
  sessionId: string;
  brandSlug: string;
  userId?: string;
  brandContextSummary: string;
  presentationConfig?: PresentationConfig;
  /** Pasta de destino do deck. A rota já validou que ela é desta marca. */
  folderId?: string | null;
}) {
  const reviewMode: ReviewMode = params.presentationConfig?.autoMode ? 'auto' : 'manual';
  const session = await createSession(params.sessionId, params.brandSlug, params.userId, reviewMode, params.folderId);

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
          } else if ((content as any).kind === 'ir-design' || (content as any).kind === 'html-design') {
            session.currentDesign = [content as any];
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

  // ── Pausa do fluxo copy-first: a aprovação do roteiro é DETERMINÍSTICA ───────
  // O roteiro pendente foi mostrado no chat; a resposta não passa pelo LLM (que
  // poderia "decidir" replanejar). Aprovou → gera com o roteiro exato aprovado.
  // Qualquer outra resposta → o plano pendente morre e a conversa segue; um
  // próximo [DISPATCH] replaneja com o contexto novo.
  if (session.pendingPlan) {
    const plan = session.pendingPlan;
    const msg = userMessage.trim();
    const aprovou = msg.toLowerCase() === APROVAR_ROTEIRO_LABEL.toLowerCase()
      || /^(aprovado|aprovo|aprovar|pode gerar|gera|manda ver|perfeito,? pode gerar)[.!]?$/i.test(msg);
    if (aprovou) {
      await updateSession(sessionId, { pendingPlan: null, activeQuestion: null, phase: 'ready', workerStatus: 'running' });
      const aprovada = await getSession(sessionId);
      if (aprovada) emitSessionState(sessionId, aprovada);
      ws.token(sessionId, '\nRoteiro aprovado — gerando o deck inteiro agora, sem mais pausas.\n');
      ws.end(sessionId);
      enqueuePipeline({
        sessionId,
        brief: plan.brief,
        format: plan.format,
        approvedSkeleton: plan.skeleton,
        sourceCopy: plan.sourceCopy,
      }).catch((err) => {
        logger.error('Falha ao enfileirar o pipeline (roteiro aprovado)', { error: (err as Error).message });
        ws.error(sessionId, `Erro ao iniciar a geração: ${(err as Error).message}`);
      });
      return;
    }
    await updateSession(sessionId, { pendingPlan: null });
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

  let semArteParaEditar = false;

  // [EDIT:{...}] — ajuste cirúrgico de uma arte existente, SEM regenerar tudo.
  // Extrator balanceado: a regex lazy antiga truncava o JSON no primeiro `}` seguido
  // de `]`, então o payload documentado do [EDIT] SEMPRE falhava no JSON.parse.
  const editMatch = extractBracketedJson(response, 'EDIT');
  if (editMatch) {
    const resultado = await applySlideEdits(sessionId, session, editMatch.json);

    // Editou preservando o resto: acabou aqui.
    if (resultado.outcome === 'editado') return;

    // Havia arte e a edição não deu. É preciso DIZER — o prompt manda a IA usar [EDIT]
    // ou [DISPATCH], nunca os dois, então antes daqui o código simplesmente retornava
    // em silêncio: a Gabi prometia "vou ajustar" e o design ficava intacto, sem erro
    // nenhum. E regenerar o deck por conta própria seria pior: ninguém pediu para
    // refazer a peça inteira.
    if (resultado.outcome === 'falhou') {
      ws.token(
        sessionId,
        `\n\n*Não consegui fazer esse ajuste (${resultado.motivo}). O design continua como estava — descreva de outro jeito, ou peça para eu refazer a peça do zero.*\n`,
      );
      await updateSession(sessionId, { phase: 'done', workerStatus: 'idle' });
      const atual = await getSession(sessionId);
      if (atual) emitSessionState(sessionId, atual);
      return;
    }

    // `sem-arte`: ainda não existe deck para editar → é legítimo cair para geração.
    semArteParaEditar = true;
  }

  // [DISPATCH:presentation] ou [DISPATCH:carousel]
  const match = response.match(/\[DISPATCH:(presentation|carousel)\]/i);
  if (!match) {
    // A IA pediu para EDITAR, não há arte, e ela não pediu geração. Sem isto, o pedido
    // morreria calado — o mesmo silêncio que este bloco inteiro existe para matar.
    // Não geramos por conta própria: criar uma peça do zero é uma decisão da pessoa.
    if (semArteParaEditar) {
      ws.token(
        sessionId,
        '\n\n*Ainda não há nenhuma arte criada para eu ajustar. Quer que eu crie a peça do zero?*\n',
      );
      await updateSession(sessionId, { phase: 'listening', workerStatus: 'idle' });
      const atual = await getSession(sessionId);
      if (atual) emitSessionState(sessionId, atual);
    }
    return;
  }

  const format = match[1] as 'presentation' | 'carousel';

  // Concatena as intenções do usuário para formar o brief completo (essencial para edições)
  const fullBrief = session.messages
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join('\n\n[Nova solicitação de edição]:\n');

  // Fluxo copy-first: com copy oficial na conversa (colada ou anexo de texto),
  // o roteiro é planejado ANTES e pausado para aprovação — a geração cara só
  // roda depois do "aprovar". Sem copy, o fluxo direto continua o mesmo.
  const sourceCopy = extractSourceCopy(session.messages);
  if (sourceCopy) {
    await planAndAskApproval(sessionId, session, format, fullBrief, sourceCopy);
    return;
  }

  await updateSession(sessionId, { phase: 'ready', workerStatus: 'running', activeQuestion: null });
  const updated = await getSession(sessionId);
  if (updated) emitSessionState(sessionId, updated);

  // Enfileira a geração (durável, com retry) — não bloqueia o stream. O erro
  // aqui é só de enfileiramento (ex.: Redis fora); falhas da geração em si são
  // tratadas no worker (queue.ts) e notificadas via ws.
  enqueuePipeline({ sessionId, brief: fullBrief, format }).catch(err => {
    logger.error('Falha ao enfileirar o pipeline', { error: (err as Error).message });
    ws.error(sessionId, `Erro ao iniciar a geração: ${err instanceof Error ? err.message : String(err)}`);
  });
}

// ── Ajuste cirúrgico de slides (preserva o design existente) ──────────────────

/**
 * O que aconteceu com o `[EDIT]`. O chamador precisa saber a DIFERENÇA entre "não há
 * arte ainda" e "havia arte e a edição falhou" — antes ele não sabia, e o custo disso
 * era o produto mentir: a IA dizia "vou ajustar" e nada acontecia, em silêncio.
 *
 * - `sem-arte`  → ainda não existe deck; é legítimo cair para geração.
 * - `editado`   → aplicado e persistido.
 * - `falhou`    → havia arte e não deu. Diga a verdade. NUNCA regenerar por baixo dos
 *                 panos: refazer um deck que a pessoa não pediu para refazer é pior do
 *                 que não fazer nada.
 */
type ResultadoEdicao =
  | { outcome: 'sem-arte' }
  | { outcome: 'editado'; changed: number }
  | { outcome: 'falhou'; motivo: string };

/**
 * Edita slides de um deck a partir de instruções em linguagem natural.
 *
 * Dual-formato: `html-design` (o que o pipeline produz desde 07-17, via
 * `editHtmlSlide`) e `ir-design` (decks legados da era IR, via
 * `generateIRPatchForSlide` + `applyPatchToSlide` no servidor — aqui não há
 * canvas do outro lado para aplicar o patch).
 *
 * Fonte de verdade é o POST, não `session.currentDesign`: o Redis expira, e o
 * `currentDesign` volta vazio na reconexão. Editar a partir dele daria
 * "não há arte" para um deck que existe.
 */
async function applySlideEdits(
  sessionId: string,
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  rawPayload: string,
): Promise<ResultadoEdicao> {
  let payload: { edits?: Array<{ index?: number; instruction?: string }> };
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return { outcome: 'falhou', motivo: 'não entendi quais slides ajustar' };
  }

  const edits = (Array.isArray(payload.edits) ? payload.edits : [])
    .map((e) => ({
      index: Math.max(0, Number(e?.index) || 0),
      instruction: typeof e?.instruction === 'string' ? e.instruction.trim() : '',
    }))
    .filter((e) => e.instruction.length > 0);

  if (edits.length === 0) return { outcome: 'falhou', motivo: 'não entendi o que mudar' };

  // A linha do Prisma fica com o tipo dela (para `id`/`brand`); o `mergeSlidesIntoPost`
  // serve só para reidratar o `content` com os slides da tabela relacional — que é onde
  // eles realmente vivem (o blob não os guarda).
  const postRow = await prisma.post.findFirst({
    where: { content: { path: ['sessionId'], equals: sessionId } },
    include: { brand: true, slides: { orderBy: { position: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  });
  if (!postRow) return { outcome: 'sem-arte' };

  const content = (mergeSlidesIntoPost(postRow).content ?? null) as {
    kind?: string;
    width?: number;
    height?: number;
    ir?: { slides?: IRSlideNode[] };
    slides?: HtmlDesignSlide[];
  } | null;

  const isIr = content?.kind === 'ir-design' && Array.isArray(content.ir?.slides) && content.ir!.slides!.length > 0;
  const isHtml = content?.kind === 'html-design' && Array.isArray(content.slides) && content.slides.length > 0;
  if (!isIr && !isHtml) {
    return { outcome: 'sem-arte' };
  }
  const irSlides = isIr ? content!.ir!.slides! : [];
  const htmlSlides = isHtml ? content!.slides! : [];
  const total = isIr ? irSlides.length : htmlSlides.length;

  // Congela o design de ANTES da IA mexer — depois do loop o estado anterior não
  // existe em lugar nenhum. Uma vez só, cobrindo o turno inteiro.
  try {
    await snapshotPost(postRow.id, {
      source: 'AI',
      label: `Antes da IA ajustar o design: "${edits.map((e) => e.instruction).join('; ').slice(0, 100)}"`,
    });
  } catch (err) {
    // Não derruba a edição por causa do histórico, mas o usuário perde o ponto de volta.
    logger.error('Falha ao versionar o design antes da edição por IA', { error: (err as Error).message });
  }

  await updateSession(sessionId, { phase: 'revising', workerStatus: 'running', activeQuestion: null });
  const revising = await getSession(sessionId);
  if (revising) emitSessionState(sessionId, revising);

  const brand = postRow.brand as { name?: string; colors?: string[]; primaryFonts?: string[]; guidelines?: string | null; agentPrompt?: string | null } | null;
  const brandColors = brand?.colors ?? [];

  // Envelope leve do delta: o front (useFabricaWs) acumula os slides por índice e só
  // reseta o acúmulo se o `postId` mudar. Emitindo com o postId do próprio deck, o
  // preview troca SÓ o slide editado, ao vivo — sem uma linha de frontend.
  const envelopeDelta = isIr
    ? {
        ...(content as Record<string, unknown>),
        postId: postRow.id,
        ir: { ...(content!.ir as Record<string, unknown>), slides: [] as unknown[] },
      }
    : {
        ...(content as Record<string, unknown>),
        postId: postRow.id,
        slides: [] as unknown[],
      };

  // editHtmlSlide precisa de um gerador de texto; usa o mesmo caminho com retry
  // do resto do produto (tier estética preservada pelo preferredModel).
  const editModel = config.models.artist;
  const generateText = async (systemInstruction: string, userPrompt: string): Promise<string> => {
    const response = await generateWithRetry(ai, {
      model: editModel,
      contents: userPrompt,
      config: { systemInstruction, responseMimeType: 'application/json', maxOutputTokens: 16384 },
    }, editModel);
    return response.text ?? '{}';
  };

  let changed = 0;
  const falhas: string[] = [];

  for (let i = 0; i < edits.length; i++) {
    const { index, instruction } = edits[i]!;
    const idx = Math.min(index, total - 1);

    ws.progress(sessionId, 40 + Math.round(((i + 1) / edits.length) * 50), `Ajustando slide ${idx + 1}...`);

    try {
      if (isIr) {
        const slide = irSlides[idx];
        if (!slide) continue;
        const patch = await generateIRPatchForSlide({ slide, instruction, brandColors });

        // O sanitizador descartou tudo: a IA não conseguiu traduzir o pedido em uma
        // alteração válida. Isso é uma FALHA e vai ser dita — não engolida.
        if (patch.ops.length === 0) {
          falhas.push(`slide ${idx + 1}`);
          continue;
        }

        const novo = applyPatchToSlide(slide, patch);
        irSlides[idx] = novo;
        changed++;
        ws.designSlide(sessionId, { index: idx, total, slide: novo, envelope: envelopeDelta });
      } else {
        const slide = htmlSlides[idx];
        if (!slide) continue;
        const novo = await editHtmlSlide(generateText, {
          slide,
          instruction,
          brand: {
            name: brand?.name ?? '',
            colors: brandColors,
            primaryFonts: brand?.primaryFonts ?? [],
            guidelines: brand?.guidelines ?? undefined,
            agentPrompt: brand?.agentPrompt ?? undefined,
          },
          width: content?.width ?? 1080,
          height: content?.height ?? 1080,
        }, extractJsonObject);

        if (!novo.html.trim()) {
          falhas.push(`slide ${idx + 1}`);
          continue;
        }

        htmlSlides[idx] = novo;
        changed++;
        ws.designSlide(sessionId, { index: idx, total, slide: novo, envelope: envelopeDelta });
      }
    } catch (err) {
      falhas.push(`slide ${idx + 1}`);
      logger.error('Edição de slide por IA falhou', { slide: idx + 1, error: (err as Error).message });
    }
  }

  if (changed === 0) {
    await updateSession(sessionId, { phase: 'done', workerStatus: 'idle' });
    const parado = await getSession(sessionId);
    if (parado) emitSessionState(sessionId, parado);
    return { outcome: 'falhou', motivo: 'não consegui traduzir o pedido numa alteração válida' };
  }

  // Persiste: os slides vão para a tabela relacional e SAEM do blob. Gravar o blob com
  // os slides dentro faria o `mergeSlidesIntoPost` sobrescrever esta edição com os
  // slides antigos na próxima leitura.
  try {
    await persistPostContent(postRow.id, content);
  } catch (err) {
    logger.error('Falha ao persistir a edição no Post', { error: (err as Error).message });
  }

  // Espelha no Redis (preview/reconexão) — set_design faz o broadcast do design cheio.
  try {
    await executeTool('set_design', { pages: [content] }, sessionId, session.currentDesign);
  } catch (err) {
    logger.error('Falha ao espelhar o design editado na sessão', { error: (err as Error).message });
  }

  await updateSession(sessionId, { phase: 'done', workerStatus: 'done' });
  const done = await getSession(sessionId);
  if (done) emitSessionState(sessionId, done);

  const resumo = `\n\n*Ajustei ${changed} slide${changed > 1 ? 's' : ''} e mantive o resto do design intacto.*\n`;
  const aviso = falhas.length > 0
    ? `\n*Não consegui aplicar o pedido em: ${falhas.join(', ')}. Tente descrever de outro jeito.*\n`
    : '';
  ws.token(sessionId, resumo + aviso);

  return { outcome: 'editado', changed };
}
