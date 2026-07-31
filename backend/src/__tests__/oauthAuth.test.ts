import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { prismaMock } from './client';
import { app } from '../app';
import jwt from 'jsonwebtoken';

vi.mock('../lib/connectorOAuth.js', async () => {
  const actual = await vi.importActual('../lib/connectorOAuth.js') as object;
  return {
    ...actual,
    generateOAuthState: () => 'test-state-nonce',
    exchangeAuthorizationCode: vi.fn().mockResolvedValue({ access_token: 'fake-google-access-token', expires_in: 3600 }),
  };
});

describe('auth — OAuth Google Login', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  });

  describe('GET /api/auth/google/login', () => {
    it('retorna 500 se GOOGLE_CLIENT_ID não estiver configurado', async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      const res = await request(app).get('/api/auth/google/login');
      expect(res.status).toBe(500);
      expect(res.body.error.message).toContain('GOOGLE_CLIENT_ID');
    });

    it('retorna URL JSON quando solicitado com header Accept: application/json', async () => {
      const res = await request(app)
        .get('/api/auth/google/login?redirect=/projetos')
        .set('Accept', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.data.url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(res.body.data.url).toContain('client_id=test-client-id');
      expect(res.body.data.url).toContain('state=test-state-nonce');
      expect(res.headers['set-cookie']?.[0]).toContain('oauth_login_state=test-state-nonce%3A%2Fprojetos');
    });

    it('redireciona diretamente para o Google no browser', async () => {
      const res = await request(app).get('/api/auth/google/login');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    });
  });

  describe('GET /api/auth/google/callback', () => {
    it('400 se o state não bater com o cookie (proteção CSRF)', async () => {
      const res = await request(app)
        .get('/api/auth/google/callback?code=abc&state=wrong-state')
        .set('Cookie', ['oauth_login_state=test-state-nonce%3A%2Fgaleria']);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('CSRF');
    });

    it('autentica usuário com sucesso e redireciona para o callback no frontend', async () => {
      prismaMock.user.findUnique = vi.fn().mockImplementation(({ where }) => {
        if (where.googleId === 'google-123') return Promise.resolve(null);
        if (where.email === 'user@example.com') return Promise.resolve(null);
        return Promise.resolve(null);
      });

      prismaMock.user.create = vi.fn().mockResolvedValue({
        id: 'new-user-id',
        email: 'user@example.com',
        name: 'User Test',
        role: 'DESIGNER',
        googleId: 'google-123',
      });

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        if (url.toString().includes('userinfo')) {
          return {
            ok: true,
            json: async () => ({ sub: 'google-123', email: 'user@example.com', name: 'User Test' }),
          } as Response;
        }
        return { ok: false } as Response;
      });

      const res = await request(app)
        .get('/api/auth/google/callback?code=valid-code&state=test-state-nonce')
        .set('Cookie', ['oauth_login_state=test-state-nonce%3A%2Fprojetos']);

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/auth/callback?token=');
      expect(res.headers.location).toContain('next=%2Fprojetos');

      const urlObj = new URL(res.headers.location);
      const token = urlObj.searchParams.get('token');
      expect(token).toBeTruthy();

      const decoded = jwt.decode(token!) as { userId: string };
      expect(decoded.userId).toBe('new-user-id');
    });
  });
});
