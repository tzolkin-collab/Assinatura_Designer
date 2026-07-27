import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { prismaMock } from './client';
import { getValidAccessToken, CanvaSessionExpiredError, canvaFetch, exchangeCodeForTokens, refreshAccessToken, uploadAsset } from '../lib/canvaClient';
import { encryptToken } from '../lib/tokenCrypto';

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
      canvaScopes: 'design:content:read',
    },
  };
});

describe('canvaClient', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  describe('getValidAccessToken', () => {
    it('retorna token atual quando ainda é válido', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'u1',
        canvaAccessToken: encryptToken('access-vigente'),
        canvaRefreshToken: encryptToken('refresh-vigente'),
        canvaTokenExpiry: new Date(Date.now() + 3600_000),
      } as any);

      const token = await getValidAccessToken('u1');
      expect(token).toBe('access-vigente');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('renova token expirado e salva criptografado', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'u1',
        canvaAccessToken: encryptToken('access-antigo'),
        canvaRefreshToken: encryptToken('refresh-antigo'),
        canvaTokenExpiry: new Date(Date.now() - 1000),
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

      const token = await getValidAccessToken('u1');
      expect(token).toBe('access-novo');
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: expect.objectContaining({
          canvaAccessToken: expect.stringMatching(/^[A-Za-z0-9+/=]+$/),
          canvaRefreshToken: expect.stringMatching(/^[A-Za-z0-9+/=]+$/),
        }),
      });
    });

    it('limpa tokens e lança CanvaSessionExpiredError quando refresh falha', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'u1',
        canvaAccessToken: encryptToken('access-antigo'),
        canvaRefreshToken: encryptToken('refresh-antigo'),
        canvaTokenExpiry: new Date(Date.now() - 1000),
      } as any);
      prismaMock.user.update.mockResolvedValue({ id: 'u1' } as any);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'invalid_grant',
      });

      await expect(getValidAccessToken('u1')).rejects.toThrow(CanvaSessionExpiredError);
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: expect.objectContaining({
          canvaAccessToken: null,
          canvaRefreshToken: null,
          canvaTokenExpiry: null,
          canvaUserId: null,
        }),
      });
    });
  });

  describe('exchangeCodeForTokens', () => {
    it('chama o token endpoint correto da Canva Connect API', async () => {
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

      await exchangeCodeForTokens('code-xyz', 'verifier');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.canva.com/rest/v1/oauth/token',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: expect.stringMatching(/^Basic /),
          }),
        }),
      );
    });
  });

  describe('refreshAccessToken', () => {
    it('chama o token endpoint correto da Canva Connect API', async () => {
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

      await refreshAccessToken('refresh-xyz');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.canva.com/rest/v1/oauth/token',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: expect.stringMatching(/^Basic /),
          }),
        }),
      );
    });
  });

  describe('uploadAsset', () => {
    it('manda application/octet-stream com bytes crus e o nome no header Asset-Upload-Metadata', async () => {
      // Regressão: a versão anterior montava multipart/form-data na mão, que a Canva
      // rejeitava com 415 — o endpoint só aceita o arquivo cru + esse header.
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'u1',
        canvaAccessToken: encryptToken('access-vigente'),
        canvaRefreshToken: encryptToken('refresh-vigente'),
        canvaTokenExpiry: new Date(Date.now() + 3600_000),
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ job: { id: 'job-1', status: 'in_progress' } }),
      });

      const buffer = Buffer.from('conteudo-fake-do-arquivo');
      await uploadAsset('u1', buffer, 'foto.png', 'image/png');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.canva.com/rest/v1/asset-uploads',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/octet-stream',
            'Asset-Upload-Metadata': JSON.stringify({ name_base64: Buffer.from('foto.png').toString('base64') }),
          }),
          body: new Uint8Array(buffer),
        }),
      );
    });
  });

  describe('canvaFetch', () => {
    it('retorna resposta da API Canva', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'u1',
        canvaAccessToken: encryptToken('access-vigente'),
        canvaRefreshToken: encryptToken('refresh-vigente'),
        canvaTokenExpiry: new Date(Date.now() + 3600_000),
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ design: { id: 'd1' } }),
      });

      const res = await canvaFetch('u1', '/designs/d1');
      expect(res.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.canva.com/rest/v1/designs/d1',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer access-vigente' }) }),
      );
    });
  });
});
