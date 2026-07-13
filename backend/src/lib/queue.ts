// Fila durável de geração de design (BullMQ sobre Redis).
//
// Antes, `runPipeline` era disparado como promise fire-and-forget dentro do
// handler de WebSocket: se o processo reiniciasse no meio, o job evaporava, sem
// retry e competindo com o event loop das requisições. Aqui os jobs vivem no
// Redis, são reprocessados após um crash/restart (jobs "stalled"), têm retry com
// backoff e rodam desacoplados do ciclo de vida da requisição.

import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config.js';
import { ws } from './websocket.js';
import { runPipeline, type PipelineParams } from '../agents/pipeline.js';
import { runCanvaExport, type CanvaExportParams } from './canvaExport.js';
import { logger } from './logger.js';

const QUEUE_NAME = 'pipeline';

// BullMQ EXIGE maxRetriesPerRequest: null nas conexões de comandos bloqueantes
// (Worker/QueueEvents). Usamos conexões dedicadas — separadas do client `redis`
// compartilhado (que tem maxRetriesPerRequest: 5).
function makeConnection(): IORedis {
  const conn = new IORedis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  conn.on('error', (err) => logger.error('Redis da fila com erro', { error: err.message }));
  return conn;
}

export const pipelineQueue = new Queue<PipelineParams>(QUEUE_NAME, {
  connection: makeConnection(),
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    // Retém histórico limitado para inspeção sem encher o Redis.
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

pipelineQueue.on('error', (err) => logger.error('Fila de pipeline com erro', { error: err.message }));

/**
 * Enfileira uma geração de design. Substitui o antigo `runPipeline(...).catch()`.
 * Retorna assim que o job está persistido no Redis — não espera a geração.
 */
export async function enqueuePipeline(params: PipelineParams): Promise<void> {
  await pipelineQueue.add('generate', params, {
    // Rastreabilidade nos logs/inspeção; não usado para dedup (regenerações
    // legítimas na mesma sessão precisam poder re-enfileirar). NÃO usar ':' —
    // o BullMQ rejeita custom job id com dois-pontos ("Custom Id cannot contain :").
    jobId: `${params.sessionId}-${Date.now()}`,
  });
}

// ── Fila de export para o Canva ───────────────────────────────────────────────
// Export era feito dentro da requisição HTTP, um slide por request. Aqui vira job:
// a resposta volta na hora com o jobId e o cliente acompanha o progresso.

const EXPORT_QUEUE_NAME = 'canva-export';

export const canvaExportQueue = new Queue<CanvaExportParams>(EXPORT_QUEUE_NAME, {
  connection: makeConnection(),
  defaultJobOptions: {
    // Só 1 tentativa: um retry re-renderiza e re-sobe tudo, criando designs
    // duplicados no Canva do usuário. Falhou, o usuário reexporta.
    attempts: 1,
    removeOnComplete: { count: 100, age: 24 * 3600 },
    removeOnFail: { count: 200, age: 24 * 3600 },
  },
});

canvaExportQueue.on('error', (err) => logger.error('Fila de export do Canva com erro', { error: err.message }));

export async function enqueueCanvaExport(params: CanvaExportParams): Promise<string> {
  const job = await canvaExportQueue.add('export', params);
  return job.id!;
}

let exportWorker: Worker<CanvaExportParams> | null = null;

export function startCanvaExportWorker(): Worker<CanvaExportParams> {
  if (exportWorker) return exportWorker;

  exportWorker = new Worker<CanvaExportParams>(
    EXPORT_QUEUE_NAME,
    async (job: Job<CanvaExportParams>) => {
      return runCanvaExport(job.data, async (done, total) => {
        // O progresso vive no próprio job: o cliente lê via GET do status, sem
        // precisar de sessão de WebSocket (o editor não tem uma).
        await job.updateProgress({ done, total });
      });
    },
    {
      connection: makeConnection(),
      // Cada slide é um render full-res no chromium. Concorrência 1 por processo
      // mantém o uso de memória previsível — o gargalo real é o chromium, não o IO.
      concurrency: 1,
    },
  );

  exportWorker.on('failed', (job, err) => {
    logger.error('Job de export do Canva falhou', { jobId: job?.id, error: err.message });
  });
  exportWorker.on('error', (err) => logger.error('Worker de export com erro', { error: err.message }));

  console.log(`  ├─ Worker:       fila "${EXPORT_QUEUE_NAME}" (concorrência 1)`);
  return exportWorker;
}

let worker: Worker<PipelineParams> | null = null;

/**
 * Sobe o worker que consome a fila e roda o pipeline. Pode rodar no mesmo
 * processo da API (deploy simples) ou num processo separado (`worker.ts`).
 */
export function startPipelineWorker(): Worker<PipelineParams> {
  if (worker) return worker;

  worker = new Worker<PipelineParams>(
    QUEUE_NAME,
    async (job: Job<PipelineParams>) => {
      await runPipeline(job.data);
    },
    {
      connection: makeConnection(),
      concurrency: config.pipelineConcurrency,
    },
  );

  worker.on('failed', (job, err) => {
    const attempts = job?.opts.attempts ?? 1;
    const made = job?.attemptsMade ?? 0;
    const isFinal = made >= attempts;
    logger.error('Job de pipeline falhou', { jobId: job?.id, attempt: made, maxAttempts: attempts, error: err.message });
    // Só avisa o usuário quando esgotaram as tentativas — evita ruído em retries.
    if (isFinal && job?.data.sessionId) {
      ws.error(job.data.sessionId, `Erro na geração: ${err.message}`);
    }
  });

  worker.on('error', (err) => logger.error('Worker de pipeline com erro', { error: err.message }));

  console.log(`  ├─ Worker:       fila "${QUEUE_NAME}" (concorrência ${config.pipelineConcurrency})`);
  return worker;
}

/** Fecha filas e workers de forma limpa (shutdown). */
export async function closeQueue(): Promise<void> {
  await worker?.close();
  await exportWorker?.close();
  await pipelineQueue.close();
  await canvaExportQueue.close();
}
