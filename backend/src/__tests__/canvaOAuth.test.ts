import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import { prismaMock } from './client';
import { app } from '../app';
import jwt from 'jsonwebtoken';
import { encryptToken } from '../lib/tokenCrypto';

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
    sign: vi.fn(() => 'jwt'),
    JsonWebTokenError: class JsonWebTokenError extends Error {},
  },
}));

// Garante que a criptografia tenha uma chave disponível nos testes.
vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      jwtSecret: 'jwt-secret-de-teste-que-tem-mais-de-32-bytes-para-pbkdf2',
      canvaClientId: 'client-id-teste',
      canvaClientSecret: 'client-secret-teste',
      canvaRedirectUri: 'http://localhost:4000/api/canva/callback',
      canvaScopes: 'design:meta:read design:content:read design:content:write asset:write profile:read',
      corsOrigin: 'http://localhost:3000',
    },
  };
});

describe('OAuth do Canva', () => {
  const mockedVerify = jwt.verify as unknown as Mock;
  const auth = (r: request.Test) => r.set('Authorization', 'Bearer token');
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    mockedVerify.mockReturnValue({ userId: 'u1' });
    vi.stubGlobal('fetch', mockFetch);
  });

  describe('GET /api/canva/auth-url', () => {
    it('retorna URL de autorização com PKCE e state', async () => {
      prismaMock.user.update.mockResolvedValue({ id: 'u1' } as any);

      const res = await auth(request(app).get('/api/canva/auth-url'));

      expect(res.status).toBe(200);
      expect(res.body.data.authUrl).toMatch(/^https:\/\/www\.canva\.com\/api\/oauth\/authorize\?/);
      expect(res.body.data.authUrl).toContain('code_challenge=');
      expect(res.body.data.authUrl).toContain('code_challenge_method=S256');
      expect(res.body.data.authUrl).toContain('state=');
      expect(res.body.data.state).toBeDefined();
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: expect.objectContaining({
          canvaCodeVerifier: expect.any(String),
          canvaOauthState: res.body.data.state,
          canvaOauthStateAt: expect.any(Date),
        }),
      });
    });
  });

  describe('GET /api/canva/callback', () => {
    it('troca code por tokens, criptografa e limpa PKCE', async () => {
      prismaMock.user.findFirst.mockResolvedValue({
        id: 'u1',
        canvaCodeVerifier: 'verifier',
        canvaOauthState: 'state-valido',
        canvaOauthStateAt: new Date(),
      } as any);
      prismaMock.user.update.mockResolvedValue({ id: 'u1' } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'access-novo',
          refresh_token: 'refresh-novo',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'design:content:read',
        }),
      });

      const res = await request(app)
        .get('/api/canva/callback')
        .query({ code: 'code-xyz', state: 'state-valido' });

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('connected=canva');
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: expect.objectContaining({
          canvaAccessToken: expect.stringMatching(/^[A-Za-z0-9+/=]+$/),
          canvaRefreshToken: expect.stringMatching(/^[A-Za-z0-9+/=]+$/),
          canvaCodeVerifier: null,
          canvaOauthState: null,
          canvaOauthStateAt: null,
        }),
      });
    });

    it('rejeita state inexistente', async () => {
      prismaMock.user.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/canva/callback')
        .query({ code: 'code-xyz', state: 'state-invalido' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/invalid or expired/i);
    });

    it('rejeita state expirado (>10min)', async () => {
      const oldState = new Date(Date.now() - 11 * 60 * 1000);
      prismaMock.user.findFirst.mockResolvedValue({
        id: 'u1',
        canvaCodeVerifier: 'verifier',
        canvaOauthState: 'state-antigo',
        canvaOauthStateAt: oldState,
      } as any);

      const res = await request(app)
        .get('/api/canva/callback')
        .query({ code: 'code-xyz', state: 'state-antigo' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/expired/i);
    });
  });

  describe('GET /api/canva/designs', () => {
    it('mapeia items da Canva API para designs no contrato do frontend', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'u1',
        canvaAccessToken: encryptToken('token-valido'),
        canvaRefreshToken: encryptToken('refresh-valido'),
        canvaTokenExpiry: new Date(Date.now() + 3600_000),
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            { id: 'd1', title: 'Design 1', urls: { edit_url: 'https://canva.com/edit/d1' } },
            { id: 'd2', title: 'Design 2', urls: { view_url: 'https://canva.com/view/d2' } },
          ],
          continuation: 'next-page-token',
        }),
      });

      const res = await auth(request(app).get('/api/canva/designs'));

      expect(res.status).toBe(200);
      expect(res.body.designs).toHaveLength(2);
      expect(res.body.designs[0].id).toBe('d1');
      expect(res.body.continuation).toBe('next-page-token');
    });
  });

  describe('GET /api/canva/status', () => {
    it('retorna connected true quando há token criptografado', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'u1',
        canvaAccessToken: encryptToken('token-valido'),
        canvaUserId: 'canva-user-1',
        canvaTokenExpiry: new Date(Date.now() + 3600_000),
      } as any);

      const res = await auth(request(app).get('/api/canva/status'));

      expect(res.status).toBe(200);
      expect(res.body.data.connected).toBe(true);
      expect(res.body.data.canvaUserId).toBe('canva-user-1');
    });

    it('retorna connected false quando não há token', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'u1',
        canvaAccessToken: null,
      } as any);

      const res = await auth(request(app).get('/api/canva/status'));

      expect(res.status).toBe(200);
      expect(res.body.data.connected).toBe(false);
    });
  });
});
