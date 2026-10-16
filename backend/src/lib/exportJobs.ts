import prisma from './prisma.js';
import { createError } from '../middleware/errorHandler.js';
import type { DeckExportFormat } from './deckExport.js';
import { mergeSlidesIntoPost, type PostWithSlides } from './postHelper.js';
import { canvaExportQueue, deckExportQueue, enqueueCanvaExport, enqueueDeckExport } from './queue.js';
import { resolveRenderableDeckWithFonts } from './renderableDeck.js';

/**
 * Pedir e acompanhar exportações de uma peça (arquivo PDF/ZIP/PPTX/HTML e Canva). Compartilhado pelas rotas
 * `POST/GET /posts/:id/export-file` e `/export-canva` e pelas ferramentas MCP, para as duas portas passarem pelas mesmas
 * validações e pela mesma fila.
 *
 * Autorização (quem pode exportar esta peça) é de quem chama. O dono do JOB é sempre o usuário que pediu: só ele lê o
 * progresso (e o link do arquivo) depois.
 */

/** Post com as relações que a exportação lê (`slides`) e o id, como o Prisma o devolve. */
export type ExportablePost = PostWithSlides & { id: string };

export interface ExportRequested {
  jobId: string;
  /** Quantidade de slides que serão renderizados. */
  total: number;
}

export type ExportJobState = 'waiting' | 'active' | 'completed' | 'failed' | string;

export interface ExportStatus {
  jobId: string;
  status: ExportJobState;
  done: number;
  total: number;
  result?: unknown;
  error?: string;
}

/** O Canva é a conta de quem pede o export, não da marca. Sem token, o job morreria no worker. */
export class CanvaNotConnectedError extends Error {
  constructor() {
    super('Canva não conectado para este usuário');
    this.name = 'CanvaNotConnectedError';
  }
}

// ── Arquivo (PDF / ZIP / PPTX / HTML) ───────────────────────────────────────────────────────────

/** Valida barato ANTES de enfileirar: um job que morre no worker por post não-renderizável é péssima experiência. */
export async function requestDeckExport(post: ExportablePost, userId: string, format: DeckExportFormat): Promise<ExportRequested> {
  const deck = await resolveRenderableDeckWithFonts(mergeSlidesIntoPost(post).content);
  if (!deck) throw createError(400, 'Export disponível apenas para designs html-design');
  if (deck.count === 0) throw createError(400, 'Este design ainda não tem slides.');

  const jobId = await enqueueDeckExport({ postId: post.id, userId, format });
  return { jobId, total: deck.count };
}

// ── Canva ───────────────────────────────────────────────────────────────────────────────────────

export async function requestCanvaExport(
  post: ExportablePost,
  userId: string,
  options: { slideIndex?: number; mode?: 'png' | 'pptx' } = {},
): Promise<ExportRequested> {
  const requester = await prisma.user.findUnique({ where: { id: userId }, select: { canvaAccessToken: true } });
  if (!requester?.canvaAccessToken) throw new CanvaNotConnectedError();

  const deck = await resolveRenderableDeckWithFonts(mergeSlidesIntoPost(post).content);
  if (!deck) throw createError(400, 'Export Canva disponível apenas para designs html-design');

  const { slideIndex, mode } = options;
  if (typeof slideIndex === 'number' && (slideIndex < 0 || slideIndex >= deck.count)) {
    throw createError(400, 'slideIndex fora do limite');
  }

  // slideIndex só se aplica ao caminho PNG (asset por slide); PPTX sempre exporta o deck inteiro num arquivo só.
  const effectiveSlideIndex = mode === 'pptx' ? undefined : slideIndex;
  const jobId = await enqueueCanvaExport({ postId: post.id, userId, slideIndex: effectiveSlideIndex, mode });
  return { jobId, total: typeof effectiveSlideIndex === 'number' ? 1 : deck.count };
}

// ── Progresso (as duas filas) ───────────────────────────────────────────────────────────────────

interface JobLike {
  data: { userId: string; postId: string };
  progress?: unknown;
  returnvalue?: unknown;
  failedReason?: string;
  getState(): Promise<string>;
}
interface QueueLike {
  getJob(id: string): Promise<JobLike | undefined | null>;
}

async function readJobStatus(queue: QueueLike, jobId: string, userId: string, postId: string): Promise<ExportStatus> {
  const job = await queue.getJob(jobId);
  if (!job) throw createError(404, 'Job de export não encontrado');

  // O job carrega o userId de quem pediu: sem esta checagem, qualquer usuário logado leria o progresso
  // (e o link do arquivo) de um export alheio.
  if (job.data.userId !== userId || job.data.postId !== postId) {
    throw createError(403, 'Este export não pertence a você.');
  }

  const state = await job.getState();
  const progress = (job.progress ?? {}) as { done?: number; total?: number };

  // Corrida getJob→getState: se o job completa ENTRE as duas leituras, o returnvalue lido junto com o job ainda é
  // null e o cliente recebe "completed sem resultado". O estado 'completed' é gravado junto com o returnvalue
  // (mesmo script Lua), então uma releitura resolve.
  let returnvalue: unknown = job.returnvalue;
  if (state === 'completed' && returnvalue == null) {
    returnvalue = (await queue.getJob(jobId))?.returnvalue ?? null;
  }

  return {
    jobId,
    status: state,
    done: progress.done ?? 0,
    total: progress.total ?? 0,
    result: state === 'completed' ? returnvalue : undefined,
    error: state === 'failed' ? job.failedReason : undefined,
  };
}

export const readDeckExportStatus = (jobId: string, userId: string, postId: string) =>
  readJobStatus(deckExportQueue as unknown as QueueLike, jobId, userId, postId);

export const readCanvaExportStatus = (jobId: string, userId: string, postId: string) =>
  readJobStatus(canvaExportQueue as unknown as QueueLike, jobId, userId, postId);
