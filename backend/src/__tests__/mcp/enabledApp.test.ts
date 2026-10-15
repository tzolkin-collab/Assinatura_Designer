// O app REAL (app.ts) com MCP_ENABLED=true: prova a fiação do `mountMcp` no app — o conector
// aparece e, ao mesmo tempo, as rotas e o CORS que já existiam continuam iguais.
import '../client'; // mocka prisma e redis do processo de teste (precisa vir antes do resto)
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

let app: Express;

beforeAll(async () => {
  vi.stubEnv('MCP_ENABLED', 'true');
  vi.stubEnv('PUBLIC_BASE_URL', 'https://api.example.test');
  vi.stubEnv('FRONTEND_URL', 'https://app.example.test');
  // O app lê o env na importação. Cada arquivo de teste tem o próprio registro de módulos,
  // então basta ajustar o env ANTES do primeiro (e único) import — sem resetModules, que
  // criaria uma segunda leva de filas/conexões do BullMQ e deixaria handles abertos.
  // Importar o app inteiro é lento (~30 s a frio), por isso o timeout generoso.
  app = (await import('../../app')).app;
}, 180_000);

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('app real com MCP_ENABLED=true', () => {
  it('expõe metadados e o 401 do /mcp', async () => {
    const prm = await request(app).get('/.well-known/oauth-protected-resource');
    expect(prm.status).toBe(200);
    expect(prm.body.resource).toBe('https://api.example.test/mcp');

    const res = await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain(
      'resource_metadata="https://api.example.test/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it('a API do usuário (/api/mcp) exige o JWT do app', async () => {
    expect((await request(app).get('/api/mcp/connections')).status).toBe(401);
    expect((await request(app).get(`/api/mcp/consent/${'x'.repeat(43)}`)).status).toBe(401);
  });

  it('as rotas e o CORS existentes seguem como antes', async () => {
    const health = await request(app).get('/api/health').set('Origin', 'http://localhost:3000');
    expect(health.status).toBe(200);
    expect(health.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect((await request(app).get('/api/brands')).status).toBe(401);
  });
});
