import type { GenerationMode } from './generationJobStore.js';

/**
 * Contrato de eventos SSE da geração de design.
 *
 * Antes vivia dentro de routes/ai.ts, o que forçava qualquer service que emite
 * eventos (`send: (e: CreateEvent) => void`) a depender da camada de rotas. Aqui,
 * o contrato fica neutro: tanto os handlers quanto os services de geração o
 * importam sem inversão de dependência.
 */

export interface ConsultQuestion {
  id: string;
  text: string;
  options: string[];
}

export interface CreatePlanStep {
  id: string;
  text: string;
  status: 'pending' | 'active' | 'done' | 'error';
}

export interface VisualRef {
  id: string;
  title: string;
  style: string;
  palette: string[];
  relevance: string;
}

export type CreateEvent =
  | { type: 'text'; text: string }
  | { type: 'questions'; questions: ConsultQuestion[] }
  | { type: 'plan'; steps: CreatePlanStep[] }
  | { type: 'plan-step'; stepId: string; status: 'active' | 'done' | 'error' }
  | { type: 'reference'; item: VisualRef }
  | { type: 'status'; text: string }
  | { type: 'started'; jobId: string; status?: string }
  | { type: 'thinking'; text: string }
  | { type: 'slide-ready'; index: number; page: unknown }
  | { type: 'slide-update'; index: number; page: unknown }
  | { type: 'hybrid-document'; document: unknown; postId: string }
  | { type: 'done'; postId?: string; mode?: GenerationMode }
  | { type: 'error'; message: string };

export const CREATE_PLAN: CreatePlanStep[] = [
  { id: 'p1', text: 'Buscando referências visuais', status: 'pending' },
  { id: 'p2', text: 'Criando roteiro dos slides', status: 'pending' },
  { id: 'p3', text: 'Gerando design visual', status: 'pending' },
  { id: 'p4', text: 'Validando qualidade', status: 'pending' },
];
