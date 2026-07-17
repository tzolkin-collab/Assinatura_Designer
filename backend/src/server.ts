import http from 'http';
import { app } from './app.js';
import { config, validateConfig } from './config.js';
import { redis } from './lib/redis.js';
import { initWebSocket } from './lib/websocket.js';
import { startPipelineWorker, startCanvaExportWorker, startDeckExportWorker, closeQueue } from './lib/queue.js';
import { ensureInternalTeamMemberships } from './lib/internalTeam.js';

const start = async () => {
  // Valida segredos/env obrigatórios antes de tudo — aborta em produção se faltar.
  validateConfig();

  // Connect Redis — fail fast with a helpful message
  try {
    await redis.connect();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('\n❌ Redis connection failed:', msg);
    console.error(`   URL: ${config.redisUrl}`);
    console.error('   Make sure Redis is running:');
    console.error('     Docker:  docker run -d -p 6379:6379 --name redis redis:alpine');
    console.error('     WSL:     wsl sudo service redis-server start\n');
    process.exit(1);
  }

  console.log(`\n  🚀 Assinatura API`);
  console.log(`  ├─ Environment: ${config.nodeEnv}`);
  console.log(`  ├─ CORS origin:  ${config.corsOrigin}`);
  console.log(`  ├─ Redis:        ${config.redisUrl}`);

  const server = http.createServer(app);
  initWebSocket(server);

  // Ferramenta interna: toda conta é membro de toda marca. Auto-cura na subida
  // (novas contas/marcas também são cobertas nos pontos de criação).
  ensureInternalTeamMemberships().catch((err) =>
    console.error('  ⚠ Sincronização de equipe interna falhou:', (err as Error).message),
  );

  // Processa a fila de geração no mesmo processo (deploy simples). Para escalar,
  // desligue com RUN_WORKER_IN_PROCESS=false na API e rode `node dist/worker.js`.
  if (config.runWorkerInProcess) {
    startPipelineWorker();
    startCanvaExportWorker();
    startDeckExportWorker();
  }

  server.listen(config.port, () => {
    console.log(`  ├─ HTTP:         http://localhost:${config.port}`);
    console.log(`  └─ WebSocket:    ws://localhost:${config.port}/ws\n`);
  });

  // Shutdown limpo: fecha fila/worker e Redis antes de sair.
  const shutdown = async (signal: string) => {
    console.log(`\n[Server] ${signal} recebido — encerrando...`);
    server.close();
    try { await closeQueue(); } catch (err) { console.error('[Server] closeQueue:', err); }
    try { await redis.quit(); } catch { /* já desconectado */ }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
};

start();
