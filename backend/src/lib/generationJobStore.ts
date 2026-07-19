import type { Response } from 'express';
import { randomUUID } from 'crypto';

/**
 * Job store in-memory da geração recuperável (SSE).
 *
 * Guarda, por job, o buffer de eventos já emitidos (para replay ao reconectar) e
 * o conjunto de clientes SSE do processo. É genérico sobre o tipo de evento `E`
 * porque o store não lê a forma do evento — só o serializa como JSON no fio; o
 * contrato de eventos (CreateEvent) mora na camada de rotas, e esta camada de lib
 * não deve depender dela.
 *
 * Ainda é in-memory: o produtor da geração roda no mesmo processo (queueMicrotask
 * no handler). Extrair para cá é o passo que permite, depois, pendurar o buffer no
 * canal `job:{id}` do EventBus e servir a geração de outra réplica.
 */

export type GenerationJobStatus = 'pending' | 'running' | 'done' | 'error';
export type GenerationMode = 'legacy' | 'hybrid';

export interface GenerationJob<E = unknown> {
  id: string;
  slug: string;
  userId?: string;
  status: GenerationJobStatus;
  postId?: string;
  pages?: unknown[];
  mode?: GenerationMode;
  error?: string;
  events: E[];
  sseClients: Set<Response>;
  expiresAt: number;
}

const jobStore = new Map<string, GenerationJob>();

export function createGenerationJob<E = unknown>(slug: string, userId?: string): GenerationJob<E> {
  const job: GenerationJob<E> = {
    id: randomUUID(),
    slug,
    userId,
    status: 'pending',
    events: [],
    sseClients: new Set(),
    expiresAt: Date.now() + 2 * 60 * 60 * 1000,
  };
  jobStore.set(job.id, job as GenerationJob);
  return job;
}

export function getGenerationJob<E = unknown>(jobId: string, userId?: string): GenerationJob<E> | undefined {
  const job = jobStore.get(jobId);
  if (!job || job.expiresAt < Date.now()) return undefined;
  if (job.userId && userId && job.userId !== userId) return undefined;
  return job as GenerationJob<E>;
}

export function broadcastGenerationEvent<E>(job: GenerationJob<E>, event: E): void {
  job.events.push(event);
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of job.sseClients) {
    if (!client.writableEnded) client.write(data);
  }
}

export function addGenerationSseClient<E>(job: GenerationJob<E>, res: Response, fromEventIndex = 0): void {
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

export function completeGenerationJob<E>(job: GenerationJob<E>): void {
  job.status = 'done';
  for (const client of job.sseClients) {
    if (!client.writableEnded) {
      client.write('data: [DONE]\n\n');
      client.end();
    }
  }
  job.sseClients.clear();
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
