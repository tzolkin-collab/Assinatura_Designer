import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { prismaMock } from './client';
import { app } from '../app';

// Valida os schemas zod de routes/auth.ts. Os casos 400 curto-circuitam no
// parseBody, antes de qualquer acesso ao banco; os casos "shape válido" provam que
// a validação passou ao cair no comportamento downstream (409 email em uso, 401
// credencial inválida).

describe('auth — validação de corpo (zod)', () => {
  beforeEach(() => {
    prismaMock.user.findUnique = vi.fn();
  });

  describe('POST /api/auth/register', () => {
    it('400 com email inválido', async () => {
      const res = await request(app).post('/api/auth/register').send({ email: 'nao-e-email', password: 'senha-forte-1', name: 'Ana' });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Email inválido');
    });

    it('400 com senha curta', async () => {
      const res = await request(app).post('/api/auth/register').send({ email: 'a@b.com', password: '123', name: 'Ana' });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('senha');
    });

    it('400 sem nome', async () => {
      const res = await request(app).post('/api/auth/register').send({ email: 'a@b.com', password: 'senha-forte-1' });
      expect(res.status).toBe(400);
    });

    it('shape válido passa da validação (email já em uso → 409)', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
      const res = await request(app).post('/api/auth/register').send({ email: 'a@b.com', password: 'senha-forte-1', name: 'Ana' });
      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/auth/login', () => {
    it('400 sem senha', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: 'a@b.com' });
      expect(res.status).toBe(400);
    });

    it('shape válido passa da validação (usuário inexistente → 401)', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      const res = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'qualquer-senha' });
      expect(res.status).toBe(401);
    });
  });
});
