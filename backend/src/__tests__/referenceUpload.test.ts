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

vi.mock('../lib/referenceSync', () => ({
  analyzeReferenceBackground: vi.fn(),
  analyzeReferenceWithUploadedImage: vi.fn(async () => {}),
}));

const mockedVerify = jwt.verify as unknown as Mock;
const auth = (r: request.Test) => r.set('Authorization', 'Bearer token');

describe('POST /api/settings/:slug/referencias/:id/upload-imagem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedVerify.mockReturnValue({ userId: 'user-1' });
    prismaMock.brand.findUnique.mockResolvedValue({ id: 'brand-1', slug: 'minha-marca' });
    prismaMock.brandMember.findUnique.mockResolvedValue({ role: 'EDITOR' });
  });

  it('400 sem arquivo nenhum anexado', async () => {
    const res = await auth(request(app).post('/api/settings/minha-marca/referencias/ref-1/upload-imagem'));
    expect(res.status).toBe(400);
    expect(prismaMock.reference.findFirst).not.toHaveBeenCalled();
  });

  it('400 quando o arquivo não é uma imagem', async () => {
    const res = await auth(
      request(app)
        .post('/api/settings/minha-marca/referencias/ref-1/upload-imagem')
        .attach('file', Buffer.from('não é imagem'), { filename: 'arquivo.txt', contentType: 'text/plain' }),
    );
    expect(res.status).toBe(400);
  });

  it('404 quando a referência não existe na marca', async () => {
    prismaMock.reference.findFirst.mockResolvedValue(null);

    const res = await auth(
      request(app)
        .post('/api/settings/minha-marca/referencias/ref-x/upload-imagem')
        .attach('file', Buffer.from('fake-png-bytes'), { filename: 'print.png', contentType: 'image/png' }),
    );

    expect(res.status).toBe(404);
  });

  it('sucesso: marca PENDING e dispara a análise com a imagem enviada', async () => {
    prismaMock.reference.findFirst.mockResolvedValue({
      id: 'ref-1', name: 'Concorrente', analysisUrl: 'https://instagram.com/concorrente', sourceType: 'INSTAGRAM',
    });
    prismaMock.reference.update.mockResolvedValue({ id: 'ref-1', status: 'PENDING' });

    const res = await auth(
      request(app)
        .post('/api/settings/minha-marca/referencias/ref-1/upload-imagem')
        .attach('file', Buffer.from('fake-png-bytes'), { filename: 'print.png', contentType: 'image/png' }),
    );

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PENDING');
    expect(prismaMock.reference.update).toHaveBeenCalledWith({ where: { id: 'ref-1' }, data: { status: 'PENDING' } });

    const { analyzeReferenceWithUploadedImage } = await import('../lib/referenceSync.js');
    expect(analyzeReferenceWithUploadedImage).toHaveBeenCalledWith(
      'ref-1', 'minha-marca', 'Concorrente', 'https://instagram.com/concorrente', 'INSTAGRAM',
      expect.any(String), 'image/png',
    );
  });
});
