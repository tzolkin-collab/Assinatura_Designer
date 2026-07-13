import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { prismaMock } from './client';
import { app } from '../app';
import jwt from 'jsonwebtoken';
import { hashInviteToken, generateInviteToken } from '../lib/invites';

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
    sign: vi.fn(() => 'jwt-assinado'),
    JsonWebTokenError: class JsonWebTokenError extends Error {},
  }
}));

describe('Convite de equipe', () => {
  const mockedVerify = jwt.verify as unknown as Mock;
  const auth = (r: request.Test) => r.set('Authorization', 'Bearer token');

  beforeEach(() => {
    vi.resetAllMocks();
    mockedVerify.mockReturnValue({ userId: 'admin-1' });
    prismaMock.brand.findUnique.mockResolvedValue({ id: 'brand-1', slug: 'minha-marca' });
    prismaMock.brandMember.findUnique.mockResolvedValue({ role: 'ADMIN' });
  });

  describe('emissão (POST /members/invite)', () => {
    it('NÃO cria conta com senha placeholder para email novo — emite token', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.invite.create.mockResolvedValue({
        id: 'inv-1', email: 'novo@test.com', role: 'EDITOR', expiresAt: new Date(Date.now() + 1000),
      });

      const res = await auth(
        request(app).post('/api/brands/minha-marca/members/invite').send({ email: 'novo@test.com', role: 'EDITOR' }),
      );

      expect(res.status).toBe(201);
      // A regressão que este teste tranca: antes nascia um User com password literal.
      expect(prismaMock.user.create).not.toHaveBeenCalled();
      expect(res.body.data.invite.url).toContain('/convite/');

      // No banco vai o hash, nunca o token cru.
      const gravado = prismaMock.invite.create.mock.calls[0][0].data.tokenHash;
      const tokenNaUrl = res.body.data.invite.url.split('/convite/')[1];
      expect(gravado).not.toBe(tokenNaUrl);
      expect(gravado).toBe(hashInviteToken(tokenNaUrl));
    });

    it('recusa convite com role OWNER (escalonamento de privilégio)', async () => {
      const res = await auth(
        request(app).post('/api/brands/minha-marca/members/invite').send({ email: 'x@test.com', role: 'OWNER' }),
      );
      expect(res.status).toBe(400);
      expect(prismaMock.invite.create).not.toHaveBeenCalled();
      expect(prismaMock.brandMember.create).not.toHaveBeenCalled();
    });

    it('recusa role inexistente', async () => {
      const res = await auth(
        request(app).post('/api/brands/minha-marca/members/invite').send({ email: 'x@test.com', role: 'SUPERUSER' }),
      );
      expect(res.status).toBe(400);
    });

    it('emite convite mesmo quando o usuário já existe (sem convite pendente)', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'user-9' });
      prismaMock.invite.create.mockResolvedValue({ role: 'EDITOR', email: 'ja@test.com' });
      prismaMock.notification.create.mockResolvedValue({});

      const res = await auth(
        request(app).post('/api/brands/minha-marca/members/invite').send({ email: 'ja@test.com', role: 'EDITOR' }),
      );

      expect(res.status).toBe(201);
      expect(res.body.data.invite).toBeDefined();
      expect(res.body.data.invite.role).toBe('EDITOR');
      expect(prismaMock.invite.create).toHaveBeenCalled();
    });
  });

  describe('aceite (POST /auth/invite/:token/accept)', () => {
    const futuro = () => new Date(Date.now() + 60_000);

    it('cria conta com senha em bcrypt e vincula à marca', async () => {
      const { token } = generateInviteToken();
      prismaMock.invite.findUnique.mockResolvedValue({
        id: 'inv-1', email: 'novo@test.com', role: 'EDITOR', brandId: 'brand-1',
        acceptedAt: null, expiresAt: futuro(), brand: { name: 'Marca', slug: 'minha-marca' },
      });
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue({ id: 'u-novo', email: 'novo@test.com', name: 'Novo', role: 'DESIGNER' });
      prismaMock.brandMember.create.mockResolvedValue({});
      prismaMock.invite.updateMany.mockResolvedValue({ count: 1 });

      const res = await request(app)
        .post(`/api/auth/invite/${token}/accept`)
        .send({ name: 'Novo', password: 'senha-forte-123' });

      expect(res.status).toBe(201);
      expect(res.body.data.token).toBe('jwt-assinado');

      // Senha precisa estar hasheada — o bug original guardava texto puro.
      const salva = prismaMock.user.create.mock.calls[0][0].data.password;
      expect(salva).not.toBe('senha-forte-123');
      expect(await bcrypt.compare('senha-forte-123', salva)).toBe(true);

      // A role vem do convite, não do body: convidado não escolhe o próprio poder.
      expect(prismaMock.brandMember.create.mock.calls[0][0].data.role).toBe('EDITOR');
    });

    it('recusa token inválido (404)', async () => {
      prismaMock.invite.findUnique.mockResolvedValue(null);
      const res = await request(app)
        .post('/api/auth/invite/token-forjado/accept')
        .send({ name: 'X', password: 'senha-forte-123' });
      expect(res.status).toBe(404);
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });

    it('recusa convite expirado (410)', async () => {
      prismaMock.invite.findUnique.mockResolvedValue({
        id: 'inv-1', email: 'a@test.com', role: 'EDITOR', brandId: 'brand-1',
        acceptedAt: null, expiresAt: new Date(Date.now() - 1000), brand: { name: 'M', slug: 's' },
      });
      const res = await request(app)
        .post('/api/auth/invite/qualquer/accept')
        .send({ name: 'X', password: 'senha-forte-123' });
      expect(res.status).toBe(410);
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });

    it('recusa convite já usado — token é de uso único (410)', async () => {
      prismaMock.invite.findUnique.mockResolvedValue({
        id: 'inv-1', email: 'a@test.com', role: 'EDITOR', brandId: 'brand-1',
        acceptedAt: new Date(), expiresAt: futuro(), brand: { name: 'M', slug: 's' },
      });
      const res = await request(app)
        .post('/api/auth/invite/qualquer/accept')
        .send({ name: 'X', password: 'senha-forte-123' });
      expect(res.status).toBe(410);
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });

    it('recusa senha curta', async () => {
      const res = await request(app)
        .post('/api/auth/invite/qualquer/accept')
        .send({ name: 'X', password: '123' });
      expect(res.status).toBe(400);
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });
  });
});
