// O app REAL (app.ts), sem MCP_ENABLED: nenhuma rota do conector pode existir. Fica em
// arquivo próprio porque importar o app inteiro é pesado e não precisa pesar nos demais.
import '../client'; // mocka prisma e redis do processo de teste (precisa vir antes do resto)
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app as realApp } from '../../app';

describe('módulo desligado por padrão (app real)', () => {
  it('sem MCP_ENABLED, não expõe nenhuma rota do conector', async () => {
    expect((await request(realApp).get('/.well-known/oauth-authorization-server')).status).toBe(404);
    expect((await request(realApp).get('/.well-known/oauth-protected-resource')).status).toBe(404);
    expect((await request(realApp).post('/mcp').send({})).status).toBe(404);
    expect((await request(realApp).get('/authorize')).status).toBe(404);
    expect((await request(realApp).post('/token').send({})).status).toBe(404);
    expect((await request(realApp).post('/register').send({})).status).toBe(404);
    expect((await request(realApp).get('/api/mcp/connections')).status).toBe(404);
  });

  it('as rotas existentes do app continuam respondendo (a montagem do MCP não as quebra)', async () => {
    expect((await request(realApp).get('/api/health')).status).toBe(200);
    expect((await request(realApp).get('/api/brands')).status).toBe(401);
  });

});
