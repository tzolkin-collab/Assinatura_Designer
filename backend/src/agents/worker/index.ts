import { randomUUID } from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { config } from '../../config.js';
import { generateWithRetry } from '../../lib/geminiRetry.js';
import {
  generateDesignDocument,
  reviewDesignDocument,
  type DesignDocumentBrandContext,
  type HybridDesignPostContent,
  type DesignDocument,
} from '../../lib/designDocument.js';
import type { CreativeBrief, WorkerResult, WorkerStatus } from '../types.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

const WORKER_MODEL = config.geminiDesignDocumentModel || 'gemini-2.5-pro';

// ── Worker job store ──────────────────────────────────────────────────────────

interface WorkerJob {
  id: string;
  briefId: string;
  sessionId: string;
  status: WorkerStatus;
  result?: WorkerResult;
}

const workerJobs = new Map<string, WorkerJob>();

// ── Execute brief ─────────────────────────────────────────────────────────────

export async function executeBrief(
  brief: CreativeBrief,
  brandCtx: BrandContextForWorker,
  callbacks: {
    onProgress?: (progress: number) => void;
    onDone?: (result: WorkerResult) => void;
    onError?: (error: string) => void;
  },
): Promise<string> {
  const jobId = randomUUID();

  const job: WorkerJob = {
    id: jobId,
    briefId: brief.id,
    sessionId: brief.sessionId,
    status: 'running',
  };

  workerJobs.set(jobId, job);

  runJob(job, brief, brandCtx, callbacks).catch(err => {
    const msg = err instanceof Error ? err.message : 'Erro no worker';
    job.status = 'error';
    callbacks.onError?.(msg);
  });

  return jobId;
}

export function getWorkerJob(jobId: string): WorkerJob | undefined {
  return workerJobs.get(jobId);
}

// ── Execução principal ────────────────────────────────────────────────────────

async function runJob(
  job: WorkerJob,
  brief: CreativeBrief,
  brandCtx: BrandContextForWorker,
  callbacks: {
    onProgress?: (progress: number) => void;
    onDone?: (result: WorkerResult) => void;
    onError?: (error: string) => void;
  },
): Promise<void> {
  const { onProgress, onDone } = callbacks;

  onProgress?.(5);

  const dimensions = getDimensions(brief.format);
  const prompt = buildTextualBrief(brief);

  const docBrandCtx: DesignDocumentBrandContext = {
    name: brandCtx.name,
    slug: brandCtx.slug,
    guidelines: brandCtx.guidelines,
    agentPrompt: brief.visualDirection,
    colors: brandCtx.colors,
    primaryFonts: brandCtx.primaryFonts,
    logoUrl: brandCtx.logoUrl,
    presentationConfig: brandCtx.presentationConfig,
    references: brandCtx.references ?? [],
  };

  const generateText = async (systemInstruction: string, userPrompt: string): Promise<string> => {
    const response = await generateWithRetry(ai, {
      model: WORKER_MODEL,
      contents: userPrompt,
      config: { systemInstruction, responseMimeType: 'application/json' },
    });
    return response.text ?? '{}';
  };

  onProgress?.(20);

  let designPost: HybridDesignPostContent;
  try {
    designPost = await generateDesignDocument(generateText, {
      prompt,
      format: brief.format,
      slideCount: brief.slideCount,
      width: dimensions.width,
      height: dimensions.height,
      brand: docBrandCtx,
    });
  } catch (err) {
    throw new Error(`Falha na geração: ${err instanceof Error ? err.message : err}`);
  }

  onProgress?.(60);

  // Revisão do documento interno
  let reviewedDoc: DesignDocument;
  try {
    reviewedDoc = await reviewDesignDocument(generateText, designPost.document, docBrandCtx);
  } catch {
    reviewedDoc = designPost.document;
  }

  onProgress?.(85);

  // Correções do Cérebro sobre o resultado
  if (brief.correctionInstructions) {
    try {
      reviewedDoc = await applyCorrections(reviewedDoc, brief.correctionInstructions, prompt);
    } catch {
      // mantém o reviewed sem correção
    }
  }

  onProgress?.(95);

  const result: WorkerResult = {
    id: randomUUID(),
    briefId: brief.id,
    sessionId: brief.sessionId,
    status: 'done',
    pages: reviewedDoc.pages,
    generatedAt: Date.now(),
  };

  job.status = 'done';
  job.result = result;
  onProgress?.(100);
  onDone?.(result);
}

// ── Aplicar correções pontuais ────────────────────────────────────────────────

async function applyCorrections(
  doc: DesignDocument,
  corrections: string,
  prompt: string,
): Promise<DesignDocument> {
  const systemInstruction = `Você é um diretor de arte revisando um DesignDocument.
Aplique apenas as correções solicitadas. Retorne o documento completo em JSON puro, sem markdown.
Mantenha a estrutura idêntica, altere só o necessário.

Correções:
${corrections}`;

  const userPrompt = `Briefing: ${prompt.slice(0, 800)}

Documento atual:
${JSON.stringify(doc).slice(0, 8000)}

Retorne o documento corrigido.`;

  const response = await generateWithRetry(ai, {
    model: WORKER_MODEL,
    contents: userPrompt,
    config: { systemInstruction, responseMimeType: 'application/json' },
  });

  const raw = response.text ?? '{}';
  return JSON.parse(raw) as DesignDocument;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDimensions(format: string): { width: number; height: number } {
  if (format === 'story') return { width: 1080, height: 1920 };
  return { width: 1080, height: 1080 };
}

function buildTextualBrief(brief: CreativeBrief): string {
  const lines: string[] = [
    `OBJETIVO: ${brief.objective}`,
    `FORMATO: ${brief.format} — ${brief.slideCount} slides`,
    `TOM: ${brief.toneAndVoice}`,
    `NARRATIVA: ${brief.narrativeStructure}`,
    `DIREÇÃO VISUAL: ${brief.visualDirection}`,
  ];

  if (brief.audience) lines.push(`PÚBLICO: ${brief.audience}`);

  if (brief.contentOutline.length > 0) {
    lines.push('\nROTEIRO:');
    for (const s of brief.contentOutline) {
      lines.push(`Slide ${s.index + 1} — ${s.purpose}: ${s.keyMessage}`);
      if (s.suggestedContent) lines.push(`  Texto: ${s.suggestedContent}`);
      if (s.visualHint) lines.push(`  Visual: ${s.visualHint}`);
    }
  }

  if (brief.qualityCriteria.length > 0) {
    lines.push('\nQUALIDADE:', ...brief.qualityCriteria.map(c => `- ${c}`));
  }

  return lines.join('\n');
}

// ── Tipos exportados ──────────────────────────────────────────────────────────

export interface BrandContextForWorker {
  name: string;
  slug: string;
  guidelines: string;
  colors: string[];
  primaryFonts: string[];
  logoUrl?: string | null;
  presentationConfig?: {
    autoMode?: boolean;
    requirePaletteConfirmation?: boolean;
    paletteApproved?: string[];
    paletteDirection?: string;
    paletteNotes?: string;
    visualVibe?: string;
    boldness?: 'safe' | 'balanced' | 'bold';
    photoPreference?: 'minimal' | 'balanced' | 'high';
    imageryStyle?: string;
    allowGeneratedGraphics?: boolean;
    allowSvgLayouts?: boolean;
    notes?: string;
  };
  references?: Array<{
    name: string;
    archetype?: string | null;
    toneOfVoice?: string | null;
    density?: string | null;
    palette: string[];
    insightsText?: string | null;
  }>;
}
