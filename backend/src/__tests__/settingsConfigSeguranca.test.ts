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

// A normalização baixa a URL; o que interessa aqui é só a decisão da rota.
vi.mock('../lib/logoTransparency.js', () => ({
  normalizarLogoParaFundoEscuro: vi.fn(async (u: string) => u),
}));

const mockedVerify = jwt.verify as unknown as Mock;
const put = (body: unknown) =>
  request(app).put('/api/settings/minha-marca/config').set('Authorization', 'Bearer token').send(body as object);

function comPapel(role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER', atual: Record<string, unknown> | null = null) {
  prismaMock.brand.findUnique.mockResolvedValue({ id: 'brand-1', slug: 'minha-marca' } as never);
  prismaMock.brandMember.findUnique.mockResolvedValue({ role } as never);
  prismaMock.brandConfig.findUnique.mockResolvedValue(atual as never);
  prismaMock.brandConfig.upsert.mockResolvedValue({ id: 'cfg-1' } as never);
}

describe('PUT /api/settings/:slug/config — campos de custo e logoUrl', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedVerify.mockReturnValue({ userId: 'user-1' });
  });

  describe('B2: teto de custo de IA só muda por OWNER/ADMIN', () => {
    it('EDITOR não liga ignoreAiCostLimit (403, nada gravado)', async () => {
      comPapel('EDITOR', { ignoreAiCostLimit: false });
      const res = await put({ ignoreAiCostLimit: true });
      expect(res.status).toBe(403);
      expect(prismaMock.brandConfig.upsert).not.toHaveBeenCalled();
    });

    it('a pesquisa automática foi removida: autoResearch* no corpo é ignorado e nunca chega ao banco', async () => {
      comPapel('EDITOR', { ignoreAiCostLimit: false });
      const res = await put({ colors: ['#000000'], autoResearchEnabled: true, autoResearchInterval: 1 });
      expect(res.status).toBe(200);
      expect(prismaMock.brandConfig.upsert).toHaveBeenCalledTimes(1);
      const arg = prismaMock.brandConfig.upsert.mock.calls[0]![0] as { update: object; create: object };
      for (const campo of ['autoResearchEnabled', 'autoResearchInterval']) {
        expect(arg.update).not.toHaveProperty(campo);
        expect(arg.create).not.toHaveProperty(campo);
      }
    });

    it('EDITOR salva o branding reenviando os mesmos valores (a tela de Branding faz isso)', async () => {
      comPapel('EDITOR', { ignoreAiCostLimit: true });
      const res = await put({ colors: ['#000000'], ignoreAiCostLimit: true });
      expect(res.status).toBe(200);
      expect(prismaMock.brandConfig.upsert).toHaveBeenCalledTimes(1);
    });

    it('EDITOR sem config prévia: o padrão (false) também passa', async () => {
      comPapel('EDITOR', null);
      const res = await put({ colors: ['#000000'], ignoreAiCostLimit: false });
      expect(res.status).toBe(200);
    });

    it.each(['OWNER', 'ADMIN'] as const)('%s muda o teto de custo', async (role) => {
      comPapel(role, { ignoreAiCostLimit: false });
      const res = await put({ ignoreAiCostLimit: true });
      expect(res.status).toBe(200);
      expect(prismaMock.brandConfig.upsert).toHaveBeenCalledTimes(1);
    });

    it('VIEWER segue sem poder salvar nada', async () => {
      comPapel('VIEWER');
      expect((await put({ colors: ['#000000'] })).status).toBe(403);
    });
  });

  describe('B1: logoUrl não pode apontar para a rede interna', () => {
    it.each([
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:4000/admin',
      'http://127.0.0.1/logo.png',
      'http://10.0.0.5/logo.png',
      'http://redis.internal/logo.png',
      'file:///etc/passwd',
    ])('400 para %s, antes de qualquer download', async (logoUrl) => {
      comPapel('OWNER');
      const res = await put({ logoUrl });
      expect(res.status).toBe(400);
      expect(prismaMock.brandConfig.upsert).not.toHaveBeenCalled();
    });

    it('aceita URL https pública', async () => {
      comPapel('OWNER');
      const res = await put({ logoUrl: 'https://pub-abc.r2.dev/logos/logo.png' });
      expect(res.status).toBe(200);
    });
  });
});
