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

describe('Hierarquia de pastas', () => {
  const mockedVerify = jwt.verify as unknown as Mock;
  const auth = (r: request.Test) => r.set('Authorization', 'Bearer token');

  beforeEach(() => {
    vi.resetAllMocks();
    mockedVerify.mockReturnValue({ userId: 'u1' });
    prismaMock.brand.findUnique.mockResolvedValue({ id: 'brand-1', slug: 'marca' });
    prismaMock.brandMember.findUnique.mockResolvedValue({ role: 'EDITOR' });
  });

  describe('POST /folders/:slug', () => {
    it('cria subpasta quando o pai é da mesma marca', async () => {
      prismaMock.folder.findFirst.mockResolvedValue({ id: 'pai' }); // pai existe NESTA marca
      prismaMock.folder.create.mockResolvedValue({ id: 'nova', name: 'Campanha', parentId: 'pai' });

      const res = await auth(
        request(app).post('/api/folders/marca').send({ name: 'Campanha', parentId: 'pai' }),
      );

      expect(res.status).toBe(201);
      expect(res.body.data.parentId).toBe('pai');
      expect(prismaMock.folder.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { name: 'Campanha', brandId: 'brand-1', parentId: 'pai', type: 'POST' } }),
      );
    });

    it('recusa pai de outra marca (vazamento cross-tenant)', async () => {
      prismaMock.folder.findFirst.mockResolvedValue(null); // o pai não é desta marca

      const res = await auth(
        request(app).post('/api/folders/marca').send({ name: 'Campanha', parentId: 'pasta-alheia' }),
      );

      expect(res.status).toBe(404);
      expect(prismaMock.folder.create).not.toHaveBeenCalled();
    });

    it('cria na raiz quando não vem parentId', async () => {
      prismaMock.folder.create.mockResolvedValue({ id: 'nova', name: 'Raiz', parentId: null });

      const res = await auth(request(app).post('/api/folders/marca').send({ name: 'Raiz' }));

      expect(res.status).toBe(201);
      expect(prismaMock.folder.findFirst).not.toHaveBeenCalled(); // nem procura pai
      expect(prismaMock.folder.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { name: 'Raiz', brandId: 'brand-1', parentId: null, type: 'POST' } }),
      );
    });
  });

  describe('PATCH /folders/:id', () => {
    it('move a pasta para um novo pai', async () => {
      prismaMock.folder.findFirst
        .mockResolvedValueOnce({ id: 'a', brandId: 'brand-1' }) // a pasta movida
        .mockResolvedValueOnce({ id: 'b' }); // o novo pai, na mesma marca
      prismaMock.folder.findUnique.mockResolvedValueOnce({ parentId: null }); // b está na raiz
      prismaMock.folder.update.mockResolvedValue({ id: 'a', name: 'A', parentId: 'b' });

      const res = await auth(request(app).patch('/api/folders/a').send({ parentId: 'b' }));

      expect(res.status).toBe(200);
      expect(res.body.data.parentId).toBe('b');
    });

    it('recusa mover a pasta para dentro de si mesma', async () => {
      prismaMock.folder.findFirst
        .mockResolvedValueOnce({ id: 'a', brandId: 'brand-1' })
        .mockResolvedValueOnce({ id: 'a' });

      const res = await auth(request(app).patch('/api/folders/a').send({ parentId: 'a' }));

      expect(res.status).toBe(400);
      expect(prismaMock.folder.update).not.toHaveBeenCalled();
    });

    it('recusa mover a pasta para dentro de uma descendente (ciclo)', async () => {
      // Árvore: a -> b -> c. Mover `a` para dentro de `c` desligaria o ramo da raiz.
      prismaMock.folder.findFirst
        .mockResolvedValueOnce({ id: 'a', brandId: 'brand-1' }) // pasta movida
        .mockResolvedValueOnce({ id: 'c' }); // novo pai existe na marca
      prismaMock.folder.findUnique
        .mockResolvedValueOnce({ parentId: 'b' }) // c é filha de b
        .mockResolvedValueOnce({ parentId: 'a' }); // b é filha de a  -> ciclo

      const res = await auth(request(app).patch('/api/folders/a').send({ parentId: 'c' }));

      expect(res.status).toBe(400);
      expect(prismaMock.folder.update).not.toHaveBeenCalled();
    });

    it('não move pasta de outra marca', async () => {
      prismaMock.folder.findFirst.mockResolvedValueOnce(null); // não é membro da marca dessa pasta

      const res = await auth(request(app).patch('/api/folders/alheia').send({ parentId: null }));

      expect(res.status).toBe(404);
      expect(prismaMock.folder.update).not.toHaveBeenCalled();
    });
  });
});
