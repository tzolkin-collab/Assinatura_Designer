import { randomUUID } from 'crypto';
import prisma from './prisma.js';
import { logger } from './logger.js';
import { getAiContext, enrichAiContext } from './aiContext.js';
import type { Prisma } from '@prisma/client';

const MAX_TEXT_LENGTH = 100_000;

// O AiContext carrega o SLUG da marca, mas GenerationRun.brandId é FK para
// Brand.id — passar o slug direto viola a constraint em toda inserção. A
// tradução acontece aqui, uma vez por marca: são poucas e o id nunca muda.
const brandIdBySlug = new Map<string, string>();

async function resolveBrandId(slug: string): Promise<string | null> {
  const cached = brandIdBySlug.get(slug);
  if (cached) return cached;
  const brand = await prisma.brand.findUnique({ where: { slug }, select: { id: true } });
  if (!brand) return null;
  brandIdBySlug.set(slug, brand.id);
  return brand.id;
}

function truncate(text?: string): string | undefined {
  if (!text) return text;
  if (text.length <= MAX_TEXT_LENGTH) return text;
  return text.slice(0, MAX_TEXT_LENGTH) + '\n\n[...truncado em 100000 caracteres]';
}

export interface GenerationTraceRun {
  postId?: string;
  /** Slug da marca — traduzido para Brand.id aqui dentro. */
  brandSlug?: string;
  sessionId?: string;
  requestId?: string;
  feature: string;
  brief?: string;
  format?: string;
  aspectRatio?: string;
}

/** Cache de controle de sequência por runId */
const stepSequences = new Map<string, number>();
function nextSeq(runId: string): number {
  const seq = (stepSequences.get(runId) ?? 0) + 1;
  stepSequences.set(runId, seq);
  return seq;
}

/**
 * Abre um run e devolve o id — ou `null` se não deu para abrir.
 *
 * Devolver `null` em vez de um id inventado é o que impede o modo de falha mais
 * traiçoeiro daqui: um runId sem linha correspondente faz cada `recordStep`
 * violar a FK e ser engolido pelo fail-open, deixando as duas tabelas vazias
 * sem um único erro visível. Quem recebe `null` simplesmente não grava steps.
 */
export async function openRun(run: GenerationTraceRun): Promise<string | null> {
  try {
    // Sem marca resolvível não há run: a FK é obrigatória, e gravar com uma
    // marca errada é pior do que não gravar.
    if (!run.brandSlug) return null;
    const brandId = await resolveBrandId(run.brandSlug);
    if (!brandId) {
      logger.warn('GenerationRun não aberto: marca não encontrada', { brandSlug: run.brandSlug });
      return null;
    }

    const id = randomUUID();
    await prisma.generationRun.create({
      data: {
        id,
        postId: run.postId,
        brandId,
        sessionId: run.sessionId,
        requestId: run.requestId,
        feature: run.feature,
        brief: truncate(run.brief),
        format: run.format,
        aspectRatio: run.aspectRatio,
        status: 'RUNNING',
        startedAt: new Date(),
      }
    });
    stepSequences.set(id, 0);
    return id;
  } catch (error) {
    logger.warn('Falha ao abrir GenerationRun (fail-open, não quebra a requisição)', {
      brandSlug: run.brandSlug, error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Garante um run para a chamada em curso e devolve o id, ou `null`.
 *
 * Chamada de IA fora do pipeline (chat, patch, utilitário) não tem run aberto
 * por ninguém. Em vez de perder o rastro, abrimos um run implícito e o
 * penduramos no AiContext, para que os steps seguintes da mesma requisição caiam
 * todos no mesmo run. Fora de um escopo de AiContext não há onde pendurar — aí
 * a chamada fica sem rastro mesmo, e é o comportamento correto.
 */
export async function ensureRun(): Promise<string | null> {
  const ctx = getAiContext();
  if (ctx.runId) return ctx.runId;
  if (!ctx.brandSlug) return null;

  const id = await openRun({
    brandSlug: ctx.brandSlug,
    postId: ctx.postId,
    sessionId: ctx.sessionId,
    requestId: ctx.requestId,
    feature: ctx.feature ?? 'utility',
  });
  if (id) enrichAiContext({ runId: id });
  return id;
}

export interface GenerationTraceStep {
  runId: string;
  kind: 'MODEL' | 'TOOL' | 'IMAGE';
  role?: string;
  name?: string;
  model?: string;
  tier?: string;
  attemptedModels?: string[];
  promptText?: string;
  responseText?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

/** Registra um step. Dispara a escrita em background para não bloquear (fail-open) */
export function recordStep(step: GenerationTraceStep): void {
  const seq = nextSeq(step.runId);
  const data = {
    runId: step.runId,
    seq,
    kind: step.kind,
    role: step.role,
    name: step.name,
    model: step.model,
    tier: step.tier,
    attemptedModels: step.attemptedModels ?? [],
    promptText: truncate(step.promptText),
    responseText: truncate(step.responseText),
    inputTokens: step.inputTokens,
    outputTokens: step.outputTokens,
    latencyMs: step.latencyMs,
    error: step.error ? truncate(step.error) : undefined,
    metadata: step.metadata ? (step.metadata as Prisma.InputJsonValue) : undefined,
  };

  prisma.generationStep.create({ data }).catch((error) => {
    logger.warn('Falha ao gravar GenerationStep (fail-open)', {
      runId: step.runId, seq, error: error instanceof Error ? error.message : String(error)
    });
  });
}

export async function closeRun(runId: string, params: { status: 'COMPLETED' | 'FAILED', error?: string }): Promise<void> {
  try {
    stepSequences.delete(runId);

    // Soma os tokens dos steps deste run
    const aggr = await prisma.generationStep.aggregate({
      where: { runId },
      _sum: {
        inputTokens: true,
        outputTokens: true,
      }
    });

    await prisma.generationRun.update({
      where: { id: runId },
      data: {
        status: params.status,
        error: params.error ? truncate(params.error) : undefined,
        finishedAt: new Date(),
        totalInputTokens: aggr._sum.inputTokens ?? 0,
        totalOutputTokens: aggr._sum.outputTokens ?? 0,
      }
    });
  } catch (error) {
    logger.warn('Falha ao fechar GenerationRun (fail-open)', {
      runId, error: error instanceof Error ? error.message : String(error)
    });
  }
}
