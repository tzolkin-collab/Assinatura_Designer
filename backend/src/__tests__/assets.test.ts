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

vi.mock('../lib/canvaClient', () => ({
  exportDesign: vi.fn(),
  waitForExport: vi.fn(),
}));

import { deleteFromR2, uploadFileToR2 } from '../lib/r2';
import { exportDesign, waitForExport } from '../lib/canvaClient';

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

  describe('POST /import-base64 (Drive/Asana → pool de assets)', () => {
    it('importa cada attachment: sobe no R2 e cria o Asset', async () => {
      (prismaMock.asset.create as Mock)
        .mockResolvedValueOnce({ id: 'a1', name: 'foto1.png' })
        .mockResolvedValueOnce({ id: 'a2', name: 'foto2.jpg' });

      const res = await auth(request(app).post('/api/brands/marca/assets/import-base64').send({
        attachments: [
          { name: 'foto1.png', mimeType: 'image/png', dataBase64: Buffer.from('a').toString('base64') },
          { name: 'foto2.jpg', mimeType: 'image/jpeg', dataBase64: Buffer.from('b').toString('base64') },
        ],
      }));

      expect(res.status).toBe(201);
      expect(res.body.data).toHaveLength(2);
      expect(prismaMock.asset.create).toHaveBeenCalledTimes(2);
      expect(uploadFileToR2).toHaveBeenCalledTimes(2);
    });

    it('pula item maior que o teto (10MB) em vez de derrubar o lote inteiro', async () => {
      (prismaMock.asset.create as Mock).mockResolvedValueOnce({ id: 'a1', name: 'ok.png' });

      const grande = Buffer.alloc(11 * 1024 * 1024, 1).toString('base64'); // 11MB > teto de 10MB

      const res = await auth(request(app).post('/api/brands/marca/assets/import-base64').send({
        attachments: [
          { name: 'ok.png', mimeType: 'image/png', dataBase64: Buffer.from('ok').toString('base64') },
          { name: 'gigante.png', mimeType: 'image/png', dataBase64: grande },
        ],
      }));

      expect(res.status).toBe(201);
      expect(res.body.data).toHaveLength(1);
      expect(prismaMock.asset.create).toHaveBeenCalledTimes(1);
    });

    it('recusa lote vazio', async () => {
      const res = await auth(request(app).post('/api/brands/marca/assets/import-base64').send({ attachments: [] }));
      expect(res.status).toBe(400);
      expect(prismaMock.asset.create).not.toHaveBeenCalled();
    });
  });

  describe('POST /import-canva/:designId (Canva → pool de assets)', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
      (exportDesign as Mock).mockResolvedValue({ job: { id: 'export-job-1' } });
    });

    it('exporta o design como PNG, baixa cada página e cria um Asset por página', async () => {
      (waitForExport as Mock).mockResolvedValue({
        job: { status: 'success', urls: ['https://canva-export.com/p1.png', 'https://canva-export.com/p2.png'] },
      });
      mockFetch.mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
      (prismaMock.asset.create as Mock)
        .mockResolvedValueOnce({ id: 'a1' })
        .mockResolvedValueOnce({ id: 'a2' });

      const res = await auth(request(app).post('/api/brands/marca/assets/import-canva/design-x').send({ title: 'Meu Design' }));

      expect(res.status).toBe(201);
      expect(res.body.data).toHaveLength(2);
      expect(exportDesign).toHaveBeenCalledWith('u1', 'design-x', 'png');
      expect(uploadFileToR2).toHaveBeenCalledTimes(2);
    });

    it('página que falha ao baixar é pulada sem derrubar as outras', async () => {
      (waitForExport as Mock).mockResolvedValue({
        job: { status: 'success', urls: ['https://canva-export.com/p1.png', 'https://canva-export.com/p2.png'] },
      });
      mockFetch
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
      (prismaMock.asset.create as Mock).mockResolvedValueOnce({ id: 'a1' });

      const res = await auth(request(app).post('/api/brands/marca/assets/import-canva/design-x').send({}));

      expect(res.status).toBe(201);
      expect(res.body.data).toHaveLength(1);
    });

    it('propaga erro claro quando o export do Canva falha', async () => {
      (waitForExport as Mock).mockRejectedValue(new Error('Canva export job failed'));

      const res = await auth(request(app).post('/api/brands/marca/assets/import-canva/design-x').send({}));

      expect(res.status).toBe(502);
      expect(prismaMock.asset.create).not.toHaveBeenCalled();
    });
  });
});
