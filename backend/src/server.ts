import http from 'http';
import { app } from './app.js';
import { config } from './config.js';
import { redis } from './lib/redis.js';
import { initWebSocket } from './lib/websocket.js';

const start = async () => {
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

  server.listen(config.port, () => {
    console.log(`  ├─ HTTP:         http://localhost:${config.port}`);
    console.log(`  └─ WebSocket:    ws://localhost:${config.port}/ws\n`);
  });
};

start();
