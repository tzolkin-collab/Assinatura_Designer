import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import { prismaMock } from './client';
import { app } from '../app';
import jwt from 'jsonwebtoken';

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
    sign: vi.fn(() => 'jwt-assinado'),
    JsonWebTokenError: class JsonWebTokenError extends Error {},
  },
}));

vi.mock('../lib/benchmarkOrchestrator', () => ({
  startBenchmarkDiscovery: vi.fn(async () => {}),
  answerBenchmarkQuestion: vi.fn(async () => {}),
  confirmBenchmarkCandidates: vi.fn(async () => {}),
  getBenchmarkSession: vi.fn(async () => null),
}));

import {
  startBenchmarkDiscovery,
  answerBenchmarkQuestion,
  confirmBenchmarkCandidates,
  getBenchmarkSession,
} from '../lib/benchmarkOrchestrator';

const mockedVerify = jwt.verify as unknown as Mock;
const auth = (r: request.Test) => r.set('Authorization', 'Bearer token');

describe('rotas de benchmark', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedVerify.mockReturnValue({ userId: 'user-1' });
    prismaMock.brand.findUnique.mockResolvedValue({ id: 'brand-1', slug: 'minha-marca' });
    prismaMock.brandMember.findUnique.mockResolvedValue({ role: 'EDITOR' });
  });

  describe('POST /api/settings/:slug/referencias/benchmark', () => {
    it('400 com mais de 5 nomes recomendados', async () => {
      const res = await auth(
        request(app).post('/api/settings/minha-marca/referencias/benchmark')
          .send({ recommended: ['A', 'B', 'C', 'D', 'E', 'F'] }),
      );
      expect(res.status).toBe(400);
      expect(startBenchmarkDiscovery).not.toHaveBeenCalled();
    });

    it('202 caminho feliz: dispara startBenchmarkDiscovery com o brandId certo', async () => {
      const res = await auth(
        request(app).post('/api/settings/minha-marca/referencias/benchmark')
          .send({ recommended: ['Rival A'] }),
      );
      expect(res.status).toBe(202);
      expect(startBenchmarkDiscovery).toHaveBeenCalledWith('brand-1', 'minha-marca', ['Rival A']);
    });

    it('aceita recommended vazio (bot escolhe todos sozinho)', async () => {
      const res = await auth(request(app).post('/api/settings/minha-marca/referencias/benchmark').send({}));
      expect(res.status).toBe(202);
      expect(startBenchmarkDiscovery).toHaveBeenCalledWith('brand-1', 'minha-marca', []);
    });
  });

  describe('GET /api/settings/:slug/referencias/benchmark', () => {
    it('devolve a sessão atual (ou null)', async () => {
      (getBenchmarkSession as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'AWAITING_CONFIRMATION', candidates: [] });
      const res = await auth(request(app).get('/api/settings/minha-marca/referencias/benchmark'));
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ status: 'AWAITING_CONFIRMATION', candidates: [] });
    });
  });

  describe('POST /api/settings/:slug/referencias/benchmark/responder', () => {
    it('400 se não há pergunta pendente (sessão null)', async () => {
      (getBenchmarkSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const res = await auth(
        request(app).post('/api/settings/minha-marca/referencias/benchmark/responder').send({ answer: 'x' }),
      );
      expect(res.status).toBe(400);
      expect(answerBenchmarkQuestion).not.toHaveBeenCalled();
    });

    it('400 se o status não é AWAITING_QUESTION', async () => {
      (getBenchmarkSession as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'AWAITING_CONFIRMATION' });
      const res = await auth(
        request(app).post('/api/settings/minha-marca/referencias/benchmark/responder').send({ answer: 'x' }),
      );
      expect(res.status).toBe(400);
    });

    it('202 caminho feliz', async () => {
      (getBenchmarkSession as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'AWAITING_QUESTION' });
      const res = await auth(
        request(app).post('/api/settings/minha-marca/referencias/benchmark/responder').send({ answer: 'Moda esportiva' }),
      );
      expect(res.status).toBe(202);
      expect(answerBenchmarkQuestion).toHaveBeenCalledWith('brand-1', 'minha-marca', 'Moda esportiva');
    });
  });

  describe('POST /api/settings/:slug/referencias/benchmark/confirmar', () => {
    it('400 se o status não é AWAITING_CONFIRMATION', async () => {
      (getBenchmarkSession as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'DISCOVERING' });
      const res = await auth(
        request(app).post('/api/settings/minha-marca/referencias/benchmark/confirmar')
          .send({ candidates: [{ id: 'c1', confirmed: true }] }),
      );
      expect(res.status).toBe(400);
      expect(confirmBenchmarkCandidates).not.toHaveBeenCalled();
    });

    it('202 caminho feliz', async () => {
      (getBenchmarkSession as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'AWAITING_CONFIRMATION' });
      const res = await auth(
        request(app).post('/api/settings/minha-marca/referencias/benchmark/confirmar')
          .send({ candidates: [{ id: 'c1', confirmed: true }, { id: 'c2', confirmed: false }] }),
      );
      expect(res.status).toBe(202);
      expect(confirmBenchmarkCandidates).toHaveBeenCalledWith('brand-1', 'minha-marca', [
        { id: 'c1', confirmed: true }, { id: 'c2', confirmed: false },
      ]);
    });
  });
});
