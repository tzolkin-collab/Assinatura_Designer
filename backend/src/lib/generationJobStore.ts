import { randomUUID } from 'crypto';
import type { Response } from 'express';

export type GenerationJobStatus = 'pending' | 'running' | 'done' | 'error';
export type GenerationMode = 'legacy' | 'hybrid';

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

export interface ConsultQuestion {
  id: string;
  type: 'text' | 'choice';
  question: string;
  options?: string[];
}

export interface CreatePlanStep {
  id: string;
  label: string;
  isOptional?: boolean;
}

export interface VisualRef {
  title: string;
  style: string;
  palette: string[];
  relevance: string;
}

export interface GenerationJob {
  id: string;
  slug: string;
  userId?: string;
  status: GenerationJobStatus;
  postId?: string;
  pages?: unknown[];
  mode?: GenerationMode;
  error?: string;
  events: CreateEvent[];
  sseClients: Set<Response>;
  expiresAt: number;
}

const jobStore = new Map<string, GenerationJob>();

export function createGenerationJob(slug: string, userId?: string): GenerationJob {
  const job: GenerationJob = {
    id: randomUUID(),
    slug,
    userId,
    status: 'pending',
    events: [],
    sseClients: new Set(),
    expiresAt: Date.now() + 2 * 60 * 60 * 1000,
  };
  jobStore.set(job.id, job);
  return job;
}

export function getGenerationJob(jobId: string, userId?: string): GenerationJob | undefined {
  const job = jobStore.get(jobId);
  if (!job || job.expiresAt < Date.now()) return undefined;
  if (job.userId && userId && job.userId !== userId) return undefined;
  return job;
}

export function broadcastGenerationEvent(job: GenerationJob, event: CreateEvent): void {
  job.events.push(event);
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of job.sseClients) {
    if (!client.writableEnded) client.write(data);
  }
}

export function addGenerationSseClient(job: GenerationJob, res: Response, fromEventIndex = 0): void {
  for (let i = fromEventIndex; i < job.events.length; i++) {
    const event = job.events[i];
    if (event && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  if (job.status === 'done' || job.status === 'error') {
    if (!res.writableEnded) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
    return;
  }
  job.sseClients.add(res);
  res.on('close', () => job.sseClients.delete(res));
}

export function completeGenerationJob(job: GenerationJob): void {
  job.status = 'done';
  for (const client of job.sseClients) {
    if (!client.writableEnded) {
      client.write('data: [DONE]\n\n');
      client.end();
    }
  }
  job.sseClients.clear();
}

export function failGenerationJob(job: GenerationJob, message: string): void {
  job.status = 'error';
  job.error = message;
  broadcastGenerationEvent(job, { type: 'error', message });
  completeGenerationJob(job);
  job.status = 'error';
}

setInterval(() => {
  const now = Date.now();
  for (const [k, j] of jobStore) {
    if (j.expiresAt < now) {
      for (const client of j.sseClients) if (!client.writableEnded) client.end();
      jobStore.delete(k);
    }
  }
}, 5 * 60 * 1000);
