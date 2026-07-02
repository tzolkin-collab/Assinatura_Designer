import { randomUUID } from 'crypto';
import type { Response } from 'express';

// Generic job store — types are owned by the caller (avoids circular imports with designFixer)
export interface FixJob {
  id: string;
  slug?: string;
  userId?: string;
  status: 'running' | 'waiting' | 'done' | 'error' | 'cancelled';
  // SSE
  events: unknown[];
  sseClients: Set<Response>;
  // Human-in-loop
  userInputResolvers: Array<(input: string) => void>;
  waitingFor: string | null;
  autoMode: boolean;
  // Memory + dedup
  memory: string[];
  triedFixes: Map<string, Set<string>>; // issueFingerprint → strategies tried
  // State
  pages: unknown[];
  expiresAt: number;
}

const jobs = new Map<string, FixJob>();

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.expiresAt < now) {
      for (const client of job.sseClients) {
        if (!client.writableEnded) client.end();
      }
      jobs.delete(id);
    }
  }
}, 10 * 60 * 1000);

export function createJob(pages: unknown[]): FixJob {
  const job: FixJob = {
    id: randomUUID(),
    status: 'running',
    events: [],
    sseClients: new Set(),
    userInputResolvers: [],
    waitingFor: null,
    autoMode: false,
    memory: [],
    triedFixes: new Map(),
    pages,
    expiresAt: Date.now() + 2 * 60 * 60 * 1000, // 2h TTL
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): FixJob | undefined {
  return jobs.get(id);
}

export function broadcastEvent(job: FixJob, event: unknown): void {
  job.events.push(event);
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of job.sseClients) {
    if (!client.writableEnded) client.write(data);
  }
}

export function addSseClient(job: FixJob, res: Response, fromEventIndex = 0): void {
  // Replay missed events
  for (let i = fromEventIndex; i < job.events.length; i++) {
    const ev = job.events[i];
    if (ev !== undefined && !res.writableEnded) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  }
  if (['done', 'error', 'cancelled'].includes(job.status)) {
    if (!res.writableEnded) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
    return;
  }
  job.sseClients.add(res);
  res.on('close', () => job.sseClients.delete(res));
}

export function completeJob(job: FixJob, pages?: unknown[]): void {
  job.status = 'done';
  if (pages) job.pages = pages;
  for (const client of job.sseClients) {
    if (!client.writableEnded) {
      client.write('data: [DONE]\n\n');
      client.end();
    }
  }
  job.sseClients.clear();
}

export function failJob(job: FixJob, error: string): void {
  job.status = 'error';
  broadcastEvent(job, { type: 'error', error });
  for (const client of job.sseClients) {
    if (!client.writableEnded) {
      client.write('data: [DONE]\n\n');
      client.end();
    }
  }
  job.sseClients.clear();
}

// Returns a Promise that resolves with the user's next response.
// The orchestrator awaits this to implement human-in-loop checkpoints.
export function waitForUserInput(job: FixJob, question: string): Promise<string> {
  job.waitingFor = question;
  job.status = 'waiting';
  return new Promise<string>(resolve => {
    job.userInputResolvers.push((input: string) => {
      job.waitingFor = null;
      if (job.status === 'waiting') job.status = 'running';
      resolve(input);
    });
  });
}

// Called by the respond endpoint.
// /btw: inject context without consuming a resolver
// /auto: enable auto mode + unblock if waiting
// /stop: cancel + unblock
// Any other text: answer waiting resolver, or store as context
export function sendUserInput(job: FixJob, raw: string): void {
  const input = raw.trim();

  if (input.startsWith('/btw ')) {
    const ctx = input.slice(5).trim();
    if (ctx) job.memory.push(`[Usuário]: ${ctx}`);
    return;
  }

  if (input === '/auto') {
    job.autoMode = true;
    const resolver = job.userInputResolvers.shift();
    if (resolver) resolver('/auto');
    return;
  }

  if (input === '/stop') {
    job.status = 'cancelled';
    const resolver = job.userInputResolvers.shift();
    if (resolver) resolver('/stop');
    return;
  }

  if (input === '/skip') {
    const resolver = job.userInputResolvers.shift();
    if (resolver) resolver('/skip');
    return;
  }

  // Answer waiting resolver, or store as freeform context
  const resolver = job.userInputResolvers.shift();
  if (resolver) {
    resolver(input);
    return;
  }
  
  job.memory.push(`[Usuário]: ${input}`);
}
