// Fila durável de geração de design (BullMQ sobre Redis).
//
// Antes, `runPipeline` era disparado como promise fire-and-forget dentro do
// handler de WebSocket: se o processo reiniciasse no meio, o job evaporava, sem
// retry e competindo com o event loop das requisições. Aqui os jobs vivem no
// Redis, são reprocessados após um crash/restart (jobs "stalled"), têm retry com
// backoff e rodam desacoplados do ciclo de vida da requisição.

import { randomUUID } from 'crypto';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import prisma from './prisma.js';
import { config } from '../config.js';
import { ws } from './websocket.js';
import { runPipeline, type PipelineParams } from '../agents/pipeline.js';
import { runCanvaExport, runCanvaPptxExport, type CanvaExportParams } from './canvaExport.js';
import { CanvaSessionExpiredError } from './canvaClient.js';
import { getCanvaDesignName } from './canvaSync.js';
import { runDeckExport, type DeckExportParams } from './deckExport.js';
import { runAssetCapture, type AssetCaptureParams } from './assetCapture.js';
import { analyzeReferenceBackground } from './referenceSync.js';
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
  // A identidade do Post nasce AQUI e viaja no job: um retry (crash/restart no
  // meio da geração) reusa o mesmo post em vez de duplicar e deixar zumbi.
  const withPostId: PipelineParams = { ...params, postId: params.postId ?? randomUUID() };
  await pipelineQueue.add('generate', withPostId, {
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

// ── Fila de export do deck como ARQUIVO (PDF / ZIP de PNGs) ───────────────────
// Mesmo motivo da fila do Canva: um deck de 30 slides são 30 renders no chromium,
// dezenas de segundos. Como request HTTP síncrono isso é timeout na cara do usuário.

const DECK_EXPORT_QUEUE_NAME = 'deck-export';

export const deckExportQueue = new Queue<DeckExportParams>(DECK_EXPORT_QUEUE_NAME, {
  connection: makeConnection(),
  defaultJobOptions: {
    // 1 tentativa: um retry re-renderiza o deck inteiro e sobe outro arquivo no R2.
    // Falhou, o usuário clica de novo — mais barato do que duplicar 200 renders.
    attempts: 1,
    removeOnComplete: { count: 100, age: 24 * 3600 },
    removeOnFail: { count: 200, age: 24 * 3600 },
  },
});

deckExportQueue.on('error', (err) => logger.error('Fila de export de deck com erro', { error: err.message }));

export async function enqueueDeckExport(params: DeckExportParams): Promise<string> {
  const job = await deckExportQueue.add('export', params);
  return job.id!;
}

// ── Fila de captura de assets (slides gerados → pool de mídia) ────────────────
// Best-effort e desacoplada da resposta ao usuário: a geração já terminou
// (post READY) quando isto roda. Ninguém espera o resultado, por isso não tem
// endpoint de progresso — só loga e segue.

const ASSET_CAPTURE_QUEUE_NAME = 'asset-capture';

export const assetCaptureQueue = new Queue<AssetCaptureParams>(ASSET_CAPTURE_QUEUE_NAME, {
  connection: makeConnection(),
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 50, age: 24 * 3600 },
    removeOnFail: { count: 100, age: 24 * 3600 },
  },
});

assetCaptureQueue.on('error', (err) => logger.error('Fila de captura de assets com erro', { error: err.message }));

export async function enqueueAssetCapture(params: AssetCaptureParams): Promise<void> {
  await assetCaptureQueue.add('capture', params);
}

let deckWorker: Worker<DeckExportParams> | null = null;

export function startDeckExportWorker(): Worker<DeckExportParams> {
  if (deckWorker) return deckWorker;

  deckWorker = new Worker<DeckExportParams>(
    DECK_EXPORT_QUEUE_NAME,
    async (job: Job<DeckExportParams>) => {
      return runDeckExport(job.data, async (done, total) => {
        // O progresso vive no job: o editor/fábrica lê por polling, sem depender
        // de sessão de WebSocket (o export também é pedido fora da Fábrica).
        await job.updateProgress({ done, total });
      });
    },
    {
      connection: makeConnection(),
      // Cada slide é um render full-res. Concorrência 1 por processo mantém a
      // memória previsível — o gargalo é o chromium, não o IO.
      concurrency: 1,
    },
  );

  deckWorker.on('failed', (job, err) => {
    logger.error('Job de export de deck falhou', { jobId: job?.id, format: job?.data.format, error: err.message });
  });
  deckWorker.on('error', (err) => logger.error('Worker de export de deck com erro', { error: err.message }));

  console.log(`  ├─ Worker:       fila "${DECK_EXPORT_QUEUE_NAME}" (concorrência 1)`);
  return deckWorker;
}

let assetCaptureWorker: Worker<AssetCaptureParams> | null = null;

export function startAssetCaptureWorker(): Worker<AssetCaptureParams> {
  if (assetCaptureWorker) return assetCaptureWorker;

  assetCaptureWorker = new Worker<AssetCaptureParams>(
    ASSET_CAPTURE_QUEUE_NAME,
    async (job: Job<AssetCaptureParams>) => runAssetCapture(job.data),
    {
      connection: makeConnection(),
      // Mesmo raciocínio dos outros workers de render: 1 por processo, o
      // gargalo é o chromium, não a fila.
      concurrency: 1,
    },
  );

  assetCaptureWorker.on('failed', (job, err) => {
    logger.error('Job de captura de assets falhou', { jobId: job?.id, postId: job?.data.postId, error: err.message });
  });
  assetCaptureWorker.on('error', (err) => logger.error('Worker de captura de assets com erro', { error: err.message }));

  console.log(`  ├─ Worker:       fila "${ASSET_CAPTURE_QUEUE_NAME}" (concorrência 1)`);
  return assetCaptureWorker;
}

let exportWorker: Worker<CanvaExportParams> | null = null;

export function startCanvaExportWorker(): Worker<CanvaExportParams> {
  if (exportWorker) return exportWorker;

  exportWorker = new Worker<CanvaExportParams>(
    EXPORT_QUEUE_NAME,
    async (job: Job<CanvaExportParams>) => {
      const onProgress = async (done: number, total: number) => {
        // O progresso vive no próprio job: o cliente lê via GET do status, sem
        // precisar de sessão de WebSocket (o editor não tem uma).
        await job.updateProgress({ done, total });
      };
      const result = job.data.mode === 'pptx'
        ? await runCanvaPptxExport(job.data, onProgress)
        : await runCanvaExport(job.data, onProgress);

      // Salva os dados do design no banco após o export ter sucesso
      try {
        const designName = await getCanvaDesignName(job.data.userId, result.designId).catch(() => null);
        await prisma.post.update({
          where: { id: job.data.postId },
          data: {
            canvaDesignId: result.designId,
            canvaExportUrl: result.designUrl,
            canvaDesignName: designName,
            canvaLastSyncedAt: new Date(),
          },
        });
      } catch (dbErr) {
        logger.error('Falha ao atualizar post com dados do Canva após export', { error: (dbErr as Error).message });
      }

      return result;
    },
    {
      connection: makeConnection(),
      // Cada slide é um render full-res no chromium. Concorrência 1 por processo
      // mantém o uso de memória previsível — o gargalo real é o chromium, não o IO.
      concurrency: 1,
    },
  );

  exportWorker.on('failed', (job, err) => {
    if (err instanceof CanvaSessionExpiredError) {
      logger.error('Job de export do Canva falhou: sessão expirada', {
        jobId: job?.id,
        userId: job?.data.userId,
        postId: job?.data.postId,
        error: err.message,
      });
    } else {
      logger.error('Job de export do Canva falhou', { jobId: job?.id, error: err.message });
    }
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
      try {
        await runPipeline(job.data);
      } catch (err) {
        const isCancellation = err instanceof Error && err.message === 'Generation cancelled by user';
        if (isCancellation) {
          logger.info('Job de pipeline interrompido pelo usuário no worker.', { jobId: job.id, sessionId: job.data.sessionId });
          return;
        }
        throw err;
      }
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

  // Zumbis de crash: um restart no meio da geração deixava posts GENERATING
  // órfãos para sempre. Com o postId no job, o retry retoma o post; o que
  // continua GENERATING além de qualquer geração plausível não tem job vivo
  // por trás — é FAILED. (45min cobre com folga decks grandes e não alcança
  // gerações legítimas de outro processo em deploys multi-worker.)
  const ZOMBIE_MIN = 45;
  prisma.post.updateMany({
    where: { status: 'GENERATING', updatedAt: { lt: new Date(Date.now() - ZOMBIE_MIN * 60_000) } },
    data: { status: 'FAILED' },
  }).then((r) => {
    if (r.count > 0) logger.info('Posts GENERATING órfãos marcados como FAILED', { count: r.count, olderThanMin: ZOMBIE_MIN });
  }).catch((e) => logger.error('Varredura de posts zumbis falhou', { error: (e as Error).message }));

  console.log(`  ├─ Worker:       fila "${QUEUE_NAME}" (concorrência ${config.pipelineConcurrency})`);
  return worker;
}

const REF_SYNC_QUEUE_NAME = 'reference-sync';

type ReferenceSyncJobData =
  | { refId: string; slug: string; name: string; analysisUrl: string; sourceType: 'WEBSITE' | 'INSTAGRAM' }
  | { brandId: string; slug: string };

export const referenceSyncQueue = new Queue<ReferenceSyncJobData>(REF_SYNC_QUEUE_NAME, {
  connection: makeConnection(),
  defaultJobOptions: {
    attempts: 2,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  },
});

referenceSyncQueue.on('error', (err) => logger.error('Fila de reference sync com erro', { error: err.message }));

let refSyncWorker: Worker | null = null;
export function startReferenceSyncWorker(): Worker {
  if (refSyncWorker) return refSyncWorker;
  refSyncWorker = new Worker(
    REF_SYNC_QUEUE_NAME,
    async (job) => {
      if (job.name === 'sync-single') {
        const data = job.data as { refId: string; slug: string; name: string; analysisUrl: string; sourceType: 'WEBSITE' | 'INSTAGRAM' };
        await analyzeReferenceBackground(data.refId, data.slug, data.name, data.analysisUrl, data.sourceType);
      }
    },
    { connection: makeConnection(), concurrency: 1 }
  );


  console.log(`  ├─ Worker:       fila "${REF_SYNC_QUEUE_NAME}" (concorrência 1)`);
  return refSyncWorker;
}

/** Fecha filas e workers de forma limpa (shutdown). */
export async function closeQueue(): Promise<void> {
  await worker?.close();
  await exportWorker?.close();
  await deckWorker?.close();
  await assetCaptureWorker?.close();
  await refSyncWorker?.close();
  await pipelineQueue.close();
  await canvaExportQueue.close();
  await deckExportQueue.close();
  await assetCaptureQueue.close();
  await referenceSyncQueue.close();
}
