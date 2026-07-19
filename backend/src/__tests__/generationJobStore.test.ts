import { describe, it, expect } from 'vitest';
import type { Response } from 'express';
import {
  createGenerationJob,
  getGenerationJob,
  broadcastGenerationEvent,
  addGenerationSseClient,
  completeGenerationJob,
} from '../lib/generationJobStore';

type Evt = { type: string; text?: string };

// Response SSE de mentira: registra o que foi escrito, o [DONE] e o close handler.
function fakeRes() {
  const writes: string[] = [];
  let ended = false;
  let onClose: (() => void) | undefined;
  const res = {
    get writableEnded() {
      return ended;
    },
    write: (chunk: string) => {
      writes.push(chunk);
      return true;
    },
    end: () => {
      ended = true;
    },
    on: (ev: string, cb: () => void) => {
      if (ev === 'close') onClose = cb;
    },
  } as unknown as Response;
  return { res, writes, triggerClose: () => onClose?.() };
}

describe('generationJobStore', () => {
  it('cria job pendente, buffer vazio, recuperável por id', () => {
    const job = createGenerationJob<Evt>('marca', 'user-1');
    expect(job.status).toBe('pending');
    expect(job.events).toEqual([]);
    expect(getGenerationJob<Evt>(job.id)?.id).toBe(job.id);
  });

  it('aplica ownership: dono diferente não recupera', () => {
    const job = createGenerationJob<Evt>('marca', 'dono');
    expect(getGenerationJob<Evt>(job.id, 'intruso')).toBeUndefined();
    expect(getGenerationJob<Evt>(job.id, 'dono')?.id).toBe(job.id);
  });

  it('broadcast bufferiza o evento e escreve no cliente conectado', () => {
    const job = createGenerationJob<Evt>('marca');
    const { res, writes } = fakeRes();
    addGenerationSseClient(job, res);
    broadcastGenerationEvent(job, { type: 'text', text: 'oi' });
    expect(job.events).toHaveLength(1);
    expect(writes.join('')).toContain('"text":"oi"');
  });

  it('cliente que entra depois recebe replay do buffer', () => {
    const job = createGenerationJob<Evt>('marca');
    broadcastGenerationEvent(job, { type: 'status', text: 'passo-1' });
    const { res, writes } = fakeRes();
    addGenerationSseClient(job, res); // sem clientes ainda no broadcast acima
    expect(writes.join('')).toContain('passo-1');
  });

  it('complete escreve [DONE], encerra e limpa os clientes', () => {
    const job = createGenerationJob<Evt>('marca');
    const { res, writes } = fakeRes();
    addGenerationSseClient(job, res);
    completeGenerationJob(job);
    expect(job.status).toBe('done');
    expect(writes.join('')).toContain('[DONE]');
    expect(job.sseClients.size).toBe(0);
  });

  it('cliente que conecta a um job já concluído recebe [DONE] na hora', () => {
    const job = createGenerationJob<Evt>('marca');
    completeGenerationJob(job);
    const { res, writes } = fakeRes();
    addGenerationSseClient(job, res);
    expect(writes.join('')).toContain('[DONE]');
    expect(job.sseClients.size).toBe(0);
  });
});
