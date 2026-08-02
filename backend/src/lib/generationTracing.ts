import prisma from './prisma.js';
import { logger } from './logger.js';
import type { Prisma } from '@prisma/client';

const MAX_TEXT_LENGTH = 100_000;

function truncate(text?: string): string | undefined {
  if (!text) return text;
  if (text.length <= MAX_TEXT_LENGTH) return text;
  return text.slice(0, MAX_TEXT_LENGTH) + '\n\n[...truncado em 100000 caracteres]';
}

export interface GenerationTraceRun {
  id: string;
  postId?: string;
  brandId: string;
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

export async function openRun(run: GenerationTraceRun): Promise<void> {
  try {
    stepSequences.set(run.id, 0);
    await prisma.generationRun.create({
      data: {
        id: run.id,
        postId: run.postId,
        brandId: run.brandId,
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
  } catch (error) {
    logger.warn('Falha ao abrir GenerationRun (fail-open, não quebra a requisição)', {
      runId: run.id, error: error instanceof Error ? error.message : String(error)
    });
  }
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
