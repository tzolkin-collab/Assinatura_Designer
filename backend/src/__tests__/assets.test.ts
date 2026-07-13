import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import { prismaMock } from './client';
import { app } from '../app';
import jwt from 'jsonwebtoken';

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
    sign: vi.fn(() => 'jwt'),
    JsonWebTokenError: class JsonWebTokenError extends Error {},
  },
}));

vi.mock('../lib/r2', () => ({
  uploadFileToR2: vi.fn(async () => 'https://cdn.exemplo.com/brands/brand-1/uuid-logo.png'),
  deleteFromR2: vi.fn(async () => true),
  assertR2Configured: vi.fn(),
  uploadPngToR2: vi.fn(),
  r2KeyFromUrl: vi.fn(),
}));

import { deleteFromR2 } from '../lib/r2';

describe('Biblioteca de mídia (assets)', () => {
  const mockedVerify = jwt.verify as unknown as Mock;
  const auth = (r: request.Test) => r.set('Authorization', 'Bearer token');

  beforeEach(() => {
    vi.resetAllMocks();
    mockedVerify.mockReturnValue({ userId: 'u1' });
    prismaMock.brand.findUnique.mockResolvedValue({ id: 'brand-1', slug: 'marca' });
    prismaMock.brandMember.findUnique.mockResolvedValue({ role: 'EDITOR' });
  });

  it('apaga o arquivo no R2, não só a linha do banco', async () => {
    prismaMock.asset.findFirst.mockResolvedValue({
      id: 'a1',
      url: 'https://cdn.exemplo.com/brands/brand-1/uuid-logo.png',
    });
    prismaMock.asset.delete.mockResolvedValue({});

    const res = await auth(request(app).delete('/api/brands/marca/assets/a1'));

    expect(res.status).toBe(200);
    expect(prismaMock.asset.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
    // Sem isto o objeto fica no R2 para sempre: lixo que continua sendo cobrado.
    expect(deleteFromR2).toHaveBeenCalledWith('https://cdn.exemplo.com/brands/brand-1/uuid-logo.png');
  });

  it('não apaga asset de outra marca (escopo por brandId)', async () => {
    prismaMock.asset.findFirst.mockResolvedValue(null); // não existe NESTA marca

    const res = await auth(request(app).delete('/api/brands/marca/assets/asset-alheio'));

    expect(res.status).toBe(404);
    expect(prismaMock.asset.delete).not.toHaveBeenCalled();
    expect(deleteFromR2).not.toHaveBeenCalled();
  });

  it('falha no R2 não deixa asset zumbi na biblioteca', async () => {
    prismaMock.asset.findFirst.mockResolvedValue({ id: 'a1', url: 'https://cdn.exemplo.com/x.png' });
    prismaMock.asset.delete.mockResolvedValue({});
    (deleteFromR2 as Mock).mockRejectedValue(new Error('R2 fora do ar'));

    const res = await auth(request(app).delete('/api/brands/marca/assets/a1'));

    // A linha sai do banco mesmo assim: o usuário não fica vendo um asset que
    // "não some". O arquivo órfão fica registrado no log para limpeza posterior.
    expect(res.status).toBe(200);
    expect(prismaMock.asset.delete).toHaveBeenCalled();
  });
});
