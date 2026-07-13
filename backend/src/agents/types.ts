import type { DesignFormat, DesignTokens } from '../lib/designDocument.js';
import type { WorkerStatus } from '../lib/fabricaSession.js';

// ── Protocolo de comunicação Cérebro ↔ Worker ─────────────────────────────────

export type AgentRole = 'brain' | 'worker';

export type { WorkerStatus };

// ── Brief estruturado que o Cérebro envia ao Worker ──────────────────────────

export interface CreativeBrief {
  id: string;
  sessionId: string;
  createdAt: number;

  // Intenção
  objective: string;
  format: DesignFormat;
  slideCount: number;
  audience: string;
  urgency?: 'low' | 'normal' | 'high';

  // Direção criativa
  narrativeStructure: string;
  visualDirection: string;
  toneAndVoice: string;

  // Marca
  brandSlug: string;
  brandContext: string;
  tokens?: DesignTokens;

  // Conteúdo
  contentOutline: SlideOutline[];

  // Qualidade
  qualityCriteria: string[];

  // Iteração (quando enviado novamente após auditoria)
  correctionInstructions?: string;
  previousResultId?: string;
}

export interface SlideOutline {
  index: number;
  purpose: string;
  keyMessage: string;
  suggestedContent?: string;
  visualHint?: string;
}

// ── Resultado que o Worker devolve ao Cérebro ────────────────────────────────

export interface WorkerResult {
  id: string;
  briefId: string;
  sessionId: string;
  status: WorkerStatus;
  pages?: unknown[];
  postId?: string;
  partialProgress?: number;
  error?: string;
  generatedAt: number;
}

// ── Auditoria do Cérebro sobre o resultado do Worker ────────────────────────

export interface AuditResult {
  approved: boolean;
  score: number;              // 0–100
  deviations: AuditDeviation[];
  correctionBrief?: string;   // instrução para reenvio ao worker
  feedback: string;           // feedback legível para a usuária
}

export interface AuditDeviation {
  type: 'content' | 'visual' | 'brand' | 'quality';
  severity: 'minor' | 'major' | 'critical';
  description: string;
  fix?: string;
}

// ── Forms contextuais gerados pelo Cérebro ───────────────────────────────────

export interface InlineForm {
  id: string;
  type: 'choice' | 'confirm' | 'brief-input' | 'priority';
  question: string;
  options?: FormOption[];
  required: boolean;
}

export interface FormOption {
  id: string;
  label: string;
  description?: string;
}

// ── Eventos SSE da sessão ────────────────────────────────────────────────────

export type BrainEventType =
  | 'message'
  | 'phase-change'
  | 'thinking'
  | 'form'
  | 'worker-started'
  | 'worker-progress'
  | 'worker-done'
  | 'audit-result'
  | 'done'
  | 'error';

export interface BrainEvent {
  type: BrainEventType;
  sessionId: string;
  payload: unknown;
  timestamp: number;
}
