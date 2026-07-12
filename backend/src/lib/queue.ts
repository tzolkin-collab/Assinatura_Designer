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

const QUEUE_NAME = 'pipeline';

// BullMQ EXIGE maxRetriesPerRequest: null nas conexões de comandos bloqueantes
// (Worker/QueueEvents). Usamos conexões dedicadas — separadas do client `redis`
// compartilhado (que tem maxRetriesPerRequest: 5).
function makeConnection(): IORedis {
  const conn = new IORedis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  conn.on('error', (err) => console.error('[Queue][Redis]', err.message));
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

pipelineQueue.on('error', (err) => console.error('[Queue] pipelineQueue error:', err.message));

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
    console.error(`[Queue] job ${job?.id} falhou (tentativa ${made}/${attempts}):`, err.message);
    // Só avisa o usuário quando esgotaram as tentativas — evita ruído em retries.
    if (isFinal && job?.data.sessionId) {
      ws.error(job.data.sessionId, `Erro na geração: ${err.message}`);
    }
  });

  worker.on('error', (err) => console.error('[Queue] worker error:', err.message));

  console.log(`  ├─ Worker:       fila "${QUEUE_NAME}" (concorrência ${config.pipelineConcurrency})`);
  return worker;
}

/** Fecha fila e worker de forma limpa (shutdown). */
export async function closeQueue(): Promise<void> {
  await worker?.close();
  await pipelineQueue.close();
}
