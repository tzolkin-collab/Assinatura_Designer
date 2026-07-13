import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import { prismaMock } from './client';
import { app } from '../app';
import jwt from 'jsonwebtoken';

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
    JsonWebTokenError: class JsonWebTokenError extends Error {},
  }
}));

/**
 * Regressão do vazamento cross-tenant: antes destes testes, rotas como
 * /api/brands/:slug/assets e /api/ai/:slug/* resolviam a marca só pelo slug,
 * sem checar vínculo — qualquer usuário logado alcançava qualquer marca.
 */
describe('Autorização por marca (RBAC)', () => {
  const mockedVerify = jwt.verify as unknown as Mock;

  beforeEach(() => {
    vi.resetAllMocks();
    mockedVerify.mockReturnValue({ userId: 'intruso', email: 'intruso@test.com' });
    prismaMock.brand.findUnique.mockResolvedValue({ id: 'brand-1', slug: 'marca-alheia' });
  });

  const auth = (r: request.Test) => r.set('Authorization', 'Bearer token');

  describe('usuário SEM vínculo com a marca não passa', () => {
    beforeEach(() => {
      // Não é membro: nenhuma BrandMember para esse par (userId, brandId).
      prismaMock.brandMember.findUnique.mockResolvedValue(null);
    });

    it('bloqueia leitura de assets (403)', async () => {
      const res = await auth(request(app).get('/api/brands/marca-alheia/assets'));
      expect(res.status).toBe(403);
      expect(prismaMock.asset.findMany).not.toHaveBeenCalled();
    });

    it('bloqueia geração de design (403)', async () => {
      const res = await auth(
        request(app).post('/api/ai/marca-alheia/create-job').send({ message: 'oi' }),
      );
      expect(res.status).toBe(403);
    });

    it('bloqueia leitura das configurações da marca (403)', async () => {
      const res = await auth(request(app).get('/api/settings/marca-alheia/config'));
      expect(res.status).toBe(403);
      expect(prismaMock.brandConfig.findUnique).not.toHaveBeenCalled();
    });

    it('bloqueia conexão do Canva (403)', async () => {
      const res = await auth(request(app).get('/api/canva/marca-alheia/auth-url'));
      expect(res.status).toBe(403);
    });

    it('bloqueia listagem de pastas (403)', async () => {
      const res = await auth(request(app).get('/api/folders/marca-alheia'));
      expect(res.status).toBe(403);
      expect(prismaMock.folder.findMany).not.toHaveBeenCalled();
    });
  });

  describe('VIEWER: lê, mas não escreve', () => {
    beforeEach(() => {
      prismaMock.brandMember.findUnique.mockResolvedValue({ role: 'VIEWER' });
    });

    it('permite listar assets', async () => {
      prismaMock.asset.findMany.mockResolvedValue([]);
      const res = await auth(request(app).get('/api/brands/marca-alheia/assets'));
      expect(res.status).toBe(200);
    });

    it('bloqueia apagar asset (403)', async () => {
      const res = await auth(request(app).delete('/api/brands/marca-alheia/assets/asset-1'));
      expect(res.status).toBe(403);
      // O guard barra antes de a rota sequer localizar o asset.
      expect(prismaMock.asset.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.asset.delete).not.toHaveBeenCalled();
    });

    it('bloqueia criar pasta (403)', async () => {
      const res = await auth(
        request(app).post('/api/folders/marca-alheia').send({ name: 'Nova' }),
      );
      expect(res.status).toBe(403);
      expect(prismaMock.folder.create).not.toHaveBeenCalled();
    });
  });

  describe('EDITOR: membro que não é dono consegue trabalhar', () => {
    beforeEach(() => {
      prismaMock.brandMember.findUnique.mockResolvedValue({ role: 'EDITOR' });
    });

    it('permite listar assets', async () => {
      prismaMock.asset.findMany.mockResolvedValue([]);
      const res = await auth(request(app).get('/api/brands/marca-alheia/assets'));
      expect(res.status).toBe(200);
    });

    it('permite apagar asset da própria marca', async () => {
      prismaMock.asset.findFirst.mockResolvedValue({ id: 'asset-1', url: 'https://cdn/x.png' });
      prismaMock.asset.delete.mockResolvedValue({});

      const res = await auth(request(app).delete('/api/brands/marca-alheia/assets/asset-1'));

      expect(res.status).toBe(200);
      // Escopado à marca: sem o brandId, alcançaria asset de outra marca.
      expect(prismaMock.asset.findFirst).toHaveBeenCalledWith({
        where: { id: 'asset-1', brandId: 'brand-1' },
        select: { id: true, url: true },
      });
      expect(prismaMock.asset.delete).toHaveBeenCalled();
    });

    it('permite ler as configurações da marca', async () => {
      prismaMock.brandConfig.findUnique.mockResolvedValue({ brandId: 'brand-1' });
      const res = await auth(request(app).get('/api/settings/marca-alheia/config'));
      expect(res.status).toBe(200);
    });
  });
});
