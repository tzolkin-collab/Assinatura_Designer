import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { prismaMock } from './client';
import { app } from '../app';
import { config } from '../config';

// Ao contrário das outras suítes de rota, esta NÃO mocka jsonwebtoken: exercita o
// requireAuth de verdade contra uma rota protegida (GET /api/brands, montada com
// requireAuth no app.ts). Antes, 100% dos testes HTTP mockavam a verificação do
// token para sempre passar — não havia um único teste de 401. Este fecha esse
// ponto cego: token ausente, malformado, com assinatura errada e expirado devem
// virar 401; token válido assinado com o mesmo segredo deve passar do guard.

const sign = (payload: object, opts?: jwt.SignOptions) =>
  jwt.sign(payload, config.jwtSecret, opts);

describe('requireAuth — autenticação real (sem mock de jwt)', () => {
  beforeEach(() => {
    // A rota raiz de brands lista via findMany; o mock base só traz findUnique.
    prismaMock.brand.findMany = vi.fn().mockResolvedValue([]);
  });

  it('401 quando não há header Authorization', async () => {
    const res = await request(app).get('/api/brands');
    expect(res.status).toBe(401);
  });

  it('401 quando o esquema não é Bearer', async () => {
    const res = await request(app).get('/api/brands').set('Authorization', 'Basic abc123');
    expect(res.status).toBe(401);
  });

  it('401 quando o token é malformado', async () => {
    const res = await request(app).get('/api/brands').set('Authorization', 'Bearer isto-nao-e-um-jwt');
    expect(res.status).toBe(401);
  });

  it('401 quando o token foi assinado com outro segredo', async () => {
    const forged = jwt.sign({ userId: 'u1', role: 'OWNER' }, 'segredo-do-atacante');
    const res = await request(app).get('/api/brands').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('401 quando o token está expirado', async () => {
    const expired = sign({ userId: 'u1', role: 'OWNER' }, { expiresIn: -10 });
    const res = await request(app).get('/api/brands').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it('passa do guard (não-401) com token válido assinado com o segredo real', async () => {
    const valid = sign({ userId: 'u1', role: 'OWNER' });
    const res = await request(app).get('/api/brands').set('Authorization', `Bearer ${valid}`);
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });
});
