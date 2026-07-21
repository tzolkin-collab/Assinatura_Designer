// Entrypoint standalone do worker de geração. Use quando quiser escalar workers
// independentemente da API: na API defina RUN_WORKER_IN_PROCESS=false e rode
// `node dist/worker.js` em um ou mais processos/containers separados.
//
// O worker precisa do client Redis compartilhado (o pipeline lê/escreve sessões
// por ele) além das conexões próprias do BullMQ.

import { config, validateConfig } from './config.js';
import { redis } from './lib/redis.js';
import { initEventBus, closeEventBus } from './lib/eventBus.js';
import { startPipelineWorker, startCanvaExportWorker, startDeckExportWorker, startAssetCaptureWorker, startReferenceSyncWorker, closeQueue } from './lib/queue.js';

const start = async () => {
  validateConfig();

  try {
    await redis.connect();
  } catch (err) {
    console.error('\n❌ Redis connection failed:', err instanceof Error ? err.message : String(err));
    console.error(`   URL: ${config.redisUrl}\n`);
    process.exit(1);
  }

  console.log(`\n  ⚙️  Assinatura Worker`);
  console.log(`  ├─ Environment: ${config.nodeEnv}`);
  console.log(`  ├─ Redis:        ${config.redisUrl}`);

  // O worker precisa do EventBus publisher para que chamadas como
  // ws.progress(sessionId, ...) cheguem ao processo da API via Redis Pub/Sub.
  await initEventBus();
  console.log('  ├─ EventBus:     publisher inicializado');
  startPipelineWorker();
  startCanvaExportWorker();
  startDeckExportWorker();
  startAssetCaptureWorker();
  startReferenceSyncWorker();
  console.log('  └─ Aguardando jobs...\n');

  const shutdown = async (signal: string) => {
    console.log(`\n[Worker] ${signal} recebido — encerrando...`);
    try { await closeQueue(); } catch (err) { console.error('[Worker] closeQueue:', err); }
    try { await closeEventBus(); } catch { /* já desconectado */ }
    try { await redis.quit(); } catch { /* já desconectado */ }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
};

start();
