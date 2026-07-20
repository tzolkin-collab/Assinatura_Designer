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

describe('Integração Asana', () => {
  const mockedVerify = jwt.verify as unknown as Mock;
  const auth = (r: request.Test) => r.set('Authorization', 'Bearer token');
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    mockedVerify.mockReturnValue({ userId: 'u1' });
    vi.stubGlobal('fetch', mockFetch);
  });

  describe('GET /api/asana/status', () => {
    it('deve retornar connected true se o usuário tiver token', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', asanaToken: 'token-teste' });

      const res = await auth(request(app).get('/api/asana/status'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ connected: true });
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'u1' },
        select: { asanaToken: true },
      });
    });

    it('deve retornar connected false se o usuário não tiver token', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', asanaToken: null });

      const res = await auth(request(app).get('/api/asana/status'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ connected: false });
    });
  });

  describe('GET /api/asana/projects', () => {
    it('deve listar os projetos de todas as workspaces do usuário', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', asanaToken: 'token-teste' });

      // Mock users/me
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            workspaces: [
              { gid: 'ws1', name: 'WS 1' },
              { gid: 'ws2', name: 'WS 2' },
            ],
          },
        }),
      });

      // Mock projects for workspace 1
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { gid: 'p1', name: 'Projeto 1' },
          ],
        }),
      });

      // Mock projects for workspace 2
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { gid: 'p2', name: 'Projeto 2' },
          ],
        }),
      });

      const res = await auth(request(app).get('/api/asana/projects'));

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        { gid: 'p1', name: 'Projeto 1' },
        { gid: 'p2', name: 'Projeto 2' },
      ]);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('deve retornar 401 se o token do Asana for inválido ou expirado', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', asanaToken: 'token-teste' });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Invalid token',
      });

      const res = await auth(request(app).get('/api/asana/projects'));

      expect(res.status).toBe(401);
      expect(res.body.error.message).toContain('Token do Asana inválido ou expirado');
    });
  });

  describe('GET /api/asana/projects/:projectId/tasks', () => {
    it('deve retornar a lista de tarefas do projeto', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', asanaToken: 'token-teste' });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { gid: 't1', name: 'Tarefa 1', completed: false },
          ],
        }),
      });

      const res = await auth(request(app).get('/api/asana/projects/p1/tasks'));

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        { gid: 't1', name: 'Tarefa 1', completed: false },
      ]);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/projects/p1/tasks?limit=100&opt_fields=name,completed,due_on,assignee.name,notes,permalink_url'),
        expect.any(Object)
      );
    });
  });
});
