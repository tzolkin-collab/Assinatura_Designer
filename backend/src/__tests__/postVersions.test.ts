import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import { prismaMock } from './client';
import { app } from '../app';
import jwt from 'jsonwebtoken';
import { snapshotPost, restorePostVersion, MAX_VERSIONS_PER_POST } from '../lib/postVersions';

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
    sign: vi.fn(() => 'jwt'),
    JsonWebTokenError: class JsonWebTokenError extends Error {},
  },
}));

/** Post ir-design com os slides na tabela relacional, como o banco guarda. */
const postComSlides = (texto: string) => ({
  id: 'post-1',
  content: { kind: 'ir-design', width: 1080, height: 1080, ir: {} },
  slides: [{ id: 's1', position: 0, contentJson: { id: 'slide-1', elements: [{ text: texto }] } }],
});

describe('Histórico de versões do post', () => {
  const mockedVerify = jwt.verify as unknown as Mock;
  const auth = (r: request.Test) => r.set('Authorization', 'Bearer token');

  beforeEach(() => {
    vi.resetAllMocks();
    mockedVerify.mockReturnValue({ userId: 'u1' });
    prismaMock.postVersion.create.mockResolvedValue({ id: 'v-nova' });
    prismaMock.postVersion.findMany.mockResolvedValue([]);
  });

  describe('snapshotPost', () => {
    it('guarda o conteúdo com os slides re-hidratados (não o blob vazio do post)', async () => {
      prismaMock.post.findUnique.mockResolvedValue(postComSlides('Olá'));
      prismaMock.postVersion.findFirst.mockResolvedValue(null); // primeira versão

      await snapshotPost('post-1', { source: 'MANUAL', label: 'v1', userId: 'u1' });

      const data = prismaMock.postVersion.create.mock.calls[0]![0].data;
      // Sem o merge, a versão salvaria `ir: {}` e restaurar devolveria um deck vazio.
      expect(data.content.ir.slides).toHaveLength(1);
      expect(data.slideCount).toBe(1);
      expect(data.source).toBe('MANUAL');
    });

    it('não grava duas versões iguais (dedupe por hash)', async () => {
      prismaMock.post.findUnique.mockResolvedValue(postComSlides('Olá'));
      prismaMock.postVersion.findFirst.mockResolvedValue(null);
      await snapshotPost('post-1', { source: 'MANUAL' });
      const hash = prismaMock.postVersion.create.mock.calls[0]![0].data.contentHash;

      prismaMock.postVersion.create.mockClear();
      prismaMock.postVersion.findFirst.mockResolvedValue({ contentHash: hash, createdAt: new Date() });

      const repetida = await snapshotPost('post-1', { source: 'MANUAL' });

      expect(repetida).toBeNull();
      expect(prismaMock.postVersion.create).not.toHaveBeenCalled();
    });

    it('debounce: salvar no editor logo depois da última versão não cria outra', async () => {
      prismaMock.post.findUnique.mockResolvedValue(postComSlides('mudou'));
      prismaMock.postVersion.findFirst.mockResolvedValue({
        contentHash: 'outro-hash',
        createdAt: new Date(Date.now() - 60_000), // 1 min atrás
      });

      const v = await snapshotPost('post-1', { source: 'EDITOR' });

      expect(v).toBeNull();
      expect(prismaMock.postVersion.create).not.toHaveBeenCalled();
    });

    it('a IA NUNCA é engolida pelo debounce (é o snapshot que protege o usuário)', async () => {
      prismaMock.post.findUnique.mockResolvedValue(postComSlides('mudou'));
      prismaMock.postVersion.findFirst.mockResolvedValue({
        contentHash: 'outro-hash',
        createdAt: new Date(Date.now() - 1_000), // 1 seg atrás
      });

      const v = await snapshotPost('post-1', { source: 'AI', label: 'antes da IA' });

      expect(v).not.toBeNull();
      expect(prismaMock.postVersion.create).toHaveBeenCalled();
    });

    it('poda as versões que passam do teto', async () => {
      prismaMock.post.findUnique.mockResolvedValue(postComSlides('nova'));
      prismaMock.postVersion.findFirst.mockResolvedValue(null);
      prismaMock.postVersion.findMany.mockResolvedValue([{ id: 'velha-1' }, { id: 'velha-2' }]);

      await snapshotPost('post-1', { source: 'MANUAL' });

      expect(prismaMock.postVersion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: MAX_VERSIONS_PER_POST }),
      );
      expect(prismaMock.postVersion.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['velha-1', 'velha-2'] } },
      });
    });

    it('post legado (slides só no blob, sem linhas na tabela) não vira versão vazia', async () => {
      // O mergeSlidesIntoPost re-hidrata os slides da tabela relacional e, com ela
      // vazia, devolveria um deck vazio: a versão nasceria em branco e restaurá-la
      // apagaria o design do usuário.
      prismaMock.post.findUnique.mockResolvedValue({
        id: 'post-legado',
        content: { kind: 'ir-design', ir: { slides: [{ id: 'no-blob' }, { id: 'no-blob-2' }] } },
        slides: [],
      });
      prismaMock.postVersion.findFirst.mockResolvedValue(null);

      await snapshotPost('post-legado', { source: 'AI' });

      const data = prismaMock.postVersion.create.mock.calls[0]![0].data;
      expect(data.content.ir.slides).toHaveLength(2);
      expect(data.slideCount).toBe(2);
    });

    it('post sem conteúdo não vira versão', async () => {
      prismaMock.post.findUnique.mockResolvedValue({ id: 'post-1', content: null, slides: [] });

      const v = await snapshotPost('post-1', { source: 'MANUAL' });

      expect(v).toBeNull();
      expect(prismaMock.postVersion.create).not.toHaveBeenCalled();
    });
  });

  describe('restorePostVersion', () => {
    it('guarda o estado atual antes de sobrescrever (restaurar tem volta)', async () => {
      prismaMock.postVersion.findFirst
        .mockResolvedValueOnce({ // a versão pedida
          id: 'v-antiga',
          content: { kind: 'ir-design', ir: { slides: [{ id: 'antigo' }] } },
          createdAt: new Date('2026-07-01T10:00:00Z'),
        })
        .mockResolvedValueOnce(null); // dentro do snapshotPost: não há versão anterior
      prismaMock.post.findUnique.mockResolvedValue(postComSlides('estado atual'));
      prismaMock.slide.findMany.mockResolvedValue([]);
      prismaMock.post.update.mockResolvedValue({});

      await restorePostVersion('post-1', 'v-antiga', 'u1');

      const salvo = prismaMock.postVersion.create.mock.calls[0]![0].data;
      expect(salvo.source).toBe('RESTORE');
      expect(salvo.content.ir.slides[0].elements[0].text).toBe('estado atual');
      expect(prismaMock.post.update).toHaveBeenCalled(); // e só então grava a antiga
    });

    it('não restaura versão de outro post', async () => {
      prismaMock.postVersion.findFirst.mockResolvedValue(null);

      await expect(restorePostVersion('post-1', 'v-de-outro-post', 'u1')).rejects.toMatchObject({
        statusCode: 404,
      });
      expect(prismaMock.post.update).not.toHaveBeenCalled();
    });
  });

  describe('rotas', () => {
    it('não lista o histórico de post de outra marca', async () => {
      prismaMock.post.findFirst.mockResolvedValue(null); // não é membro da marca

      const res = await auth(request(app).get('/api/posts/post-alheio/versions'));

      expect(res.status).toBe(404);
      expect(prismaMock.postVersion.findMany).not.toHaveBeenCalled();
    });

    it('lista o histórico sem mandar o conteúdo (são MBs por versão)', async () => {
      prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1' });
      prismaMock.postVersion.findMany.mockResolvedValue([
        { id: 'v2', label: 'antes da IA', source: 'AI', slideCount: 4, createdAt: new Date(), createdBy: null },
      ]);

      const res = await auth(request(app).get('/api/posts/post-1/versions'));

      expect(res.status).toBe(200);
      expect(res.body.data[0].source).toBe('AI');
      expect(res.body.data[0].content).toBeUndefined();
      const select = prismaMock.postVersion.findMany.mock.calls[0]![0].select;
      expect(select.content).toBeUndefined();
    });

    it('versão manual sem mudança devolve 200 sem criar duplicata', async () => {
      prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1' });
      prismaMock.post.findUnique.mockResolvedValue(postComSlides('igual'));
      // O snapshot vai achar a última versão com o mesmo hash: nada a fazer.
      prismaMock.postVersion.findFirst.mockImplementation(async () => {
        const { createHash } = await import('node:crypto');
        const content = {
          kind: 'ir-design',
          width: 1080,
          height: 1080,
          ir: { slides: [{ id: 'slide-1', elements: [{ text: 'igual' }] }] },
        };
        return { contentHash: createHash('sha256').update(JSON.stringify(content)).digest('hex'), createdAt: new Date() };
      });

      const res = await auth(request(app).post('/api/posts/post-1/versions').send({ label: 'x' }));

      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
      expect(prismaMock.postVersion.create).not.toHaveBeenCalled();
    });
  });
});
