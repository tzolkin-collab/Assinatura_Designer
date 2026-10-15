import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import { prismaMock } from './client';
import { app } from '../app';
import jwt from 'jsonwebtoken';
import { snapshotPost } from '../lib/postVersions';

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
    sign: vi.fn(() => 'jwt'),
    JsonWebTokenError: class JsonWebTokenError extends Error {},
  },
}));
vi.mock('../lib/postVersions', () => ({ snapshotPost: vi.fn(), restorePostVersion: vi.fn() }));

// O enquadramento automático baixa a foto, chama o Gemini e abre o Chromium: nos testes, nada disso.
const framing = vi.hoisted(() => ({ analysis: null as unknown, aspect: null as number | null }));
vi.mock('../lib/photoFraming', async () => {
  const real = await vi.importActual<typeof import('../lib/photoFraming')>('../lib/photoFraming');
  return {
    ...real,
    analyzePhoto: vi.fn(async () => framing.analysis),
    measureSlotAspect: vi.fn(async () => framing.aspect),
  };
});

const auth = (r: request.Test) => r.set('Authorization', 'Bearer token');

const HTML = `<h1>Título</h1><div data-photo-slot="1" style="width:300px;height:400px"></div>`;
const FOTO = 'https://cdn.example.com/brands/b1/amanda-01.jpg';

const post = () => ({
  id: 'post-1',
  brandId: 'b1',
  content: { kind: 'html-design', width: 1920, height: 1080, fonts: ['Inter'] },
  slides: [{ id: 'row-0', position: 0, contentJson: { html: HTML, css: '.a{color:red}' } }],
});

describe('rotas de espaço de foto', () => {
  const mockedVerify = jwt.verify as unknown as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedVerify.mockReturnValue({ userId: 'u1' });
    prismaMock.post.findFirst.mockResolvedValue(post());
    framing.analysis = null;
    framing.aspect = null;
    prismaMock.asset.findFirst.mockResolvedValue({ name: 'amanda-01.jpg' });
    prismaMock.slide.update.mockResolvedValue({});
    prismaMock.post.update.mockResolvedValue({});
  });

  describe('GET /api/posts/:id/slides/:index/photo-slots', () => {
    it('lista os espaços do slide', async () => {
      const res = await auth(request(app).get('/api/posts/post-1/slides/0/photo-slots'));
      expect(res.status).toBe(200);
      expect(res.body.data.slots).toEqual([
        { slot: '1', hasPhoto: false, position: { x: 50, y: 50 }, fit: 'cover' },
      ]);
    });

    it('404 quando o post não é da pessoa', async () => {
      prismaMock.post.findFirst.mockResolvedValue(null);
      const res = await auth(request(app).get('/api/posts/post-1/slides/0/photo-slots'));
      expect(res.status).toBe(404);
    });

    it('404 para slide que não existe', async () => {
      const res = await auth(request(app).get('/api/posts/post-1/slides/9/photo-slots'));
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/posts/:id/slides/:index/photo', () => {
    it('coloca a foto da biblioteca no espaço, sanitiza, versiona antes e grava', async () => {
      const res = await auth(request(app).put('/api/posts/post-1/slides/0/photo').send({ slot: '1', assetUrl: FOTO }));

      expect(res.status).toBe(200);
      expect(res.body.data.slots[0]).toMatchObject({ slot: '1', hasPhoto: true, src: FOTO });
      expect(res.body.data.slide.html).toContain('<h1>Título</h1>'); // o resto do slide não mudou
      expect(snapshotPost).toHaveBeenCalledWith('post-1', expect.objectContaining({ source: 'EDITOR' }));
      expect(prismaMock.slide.update).toHaveBeenCalledTimes(1);
      const dados = prismaMock.slide.update.mock.calls[0]![0] as { data: { htmlRender: string } };
      expect(dados.data.htmlRender).toContain(FOTO);
    });

    describe('enquadramento pelo assunto', () => {
      // Retrato 3:4 com o rosto no terço de cima, num espaço paisagem 16:9: o centro cortaria a cabeça.
      const retrato = { focus: { subject: { x0: 0.2, y0: 0.05, x1: 0.8, y1: 1 }, face: { x0: 0.35, y0: 0.08, x1: 0.65, y1: 0.28 } }, aspect: 3 / 4 };

      it('foto nova: posiciona pelo rosto em vez do centro e avisa que foi automático', async () => {
        framing.analysis = retrato;
        framing.aspect = 16 / 9;
        const res = await auth(request(app).put('/api/posts/post-1/slides/0/photo').send({ slot: '1', assetUrl: FOTO }));
        expect(res.status).toBe(200);
        const pos = res.body.data.slots[0].position;
        expect(pos.x).toBe(50);
        expect(pos.y).toBeLessThan(35); // sobe a janela: o rosto está no alto da foto
        expect(res.body.data.framing).toMatchObject({ mode: 'auto', faceVisible: 1 });
      });

      it('detecção falhou: volta ao centro (como antes), sem erro', async () => {
        framing.analysis = null;
        framing.aspect = 16 / 9;
        const res = await auth(request(app).put('/api/posts/post-1/slides/0/photo').send({ slot: '1', assetUrl: FOTO }));
        expect(res.status).toBe(200);
        expect(res.body.data.slots[0].position).toEqual({ x: 50, y: 50 });
        expect(res.body.data.framing).toEqual({ mode: 'center' });
      });

      it('não conseguiu medir o espaço: centro, sem erro', async () => {
        framing.analysis = retrato;
        framing.aspect = null;
        const res = await auth(request(app).put('/api/posts/post-1/slides/0/photo').send({ slot: '1', assetUrl: FOTO }));
        expect(res.body.data.slots[0].position).toEqual({ x: 50, y: 50 });
        expect(res.body.data.framing.mode).toBe('center');
      });

      it('posição escolhida pela pessoa sempre vence o automático', async () => {
        framing.analysis = retrato;
        framing.aspect = 16 / 9;
        const res = await auth(request(app).put('/api/posts/post-1/slides/0/photo').send({ slot: '1', assetUrl: FOTO, position: { x: 10, y: 90 } }));
        expect(res.body.data.slots[0].position).toEqual({ x: 10, y: 90 });
        expect(res.body.data.framing).toEqual({ mode: 'manual' });
      });

      it('a mesma foto reenviada mantém o ajuste que a pessoa já fez', async () => {
        framing.analysis = retrato;
        framing.aspect = 16 / 9;
        prismaMock.post.findFirst.mockResolvedValue({
          ...post(),
          slides: [{ id: 'row-0', position: 0, contentJson: { html: `<div data-photo-slot="1"><img src="${FOTO}" style="object-position:20% 30%"></div>` } }],
        });
        const res = await auth(request(app).put('/api/posts/post-1/slides/0/photo').send({ slot: '1', assetUrl: FOTO }));
        expect(res.body.data.slots[0].position).toEqual({ x: 20, y: 30 });
        expect(res.body.data.framing).toEqual({ mode: 'kept' });
      });
    });

    it('o snapshot é tirado ANTES de qualquer escrita (dá para desfazer)', async () => {
      const ordem: string[] = [];
      (snapshotPost as Mock).mockImplementation(async () => { ordem.push('snapshot'); });
      prismaMock.slide.update.mockImplementation(async () => { ordem.push('escrita'); return {}; });

      await auth(request(app).put('/api/posts/post-1/slides/0/photo').send({ slot: '1', assetUrl: FOTO }));
      expect(ordem).toEqual(['snapshot', 'escrita']);
    });

    it('recusa foto que não está na biblioteca DESTA marca (nada de URL arbitrária)', async () => {
      prismaMock.asset.findFirst.mockResolvedValue(null);
      const res = await auth(request(app).put('/api/posts/post-1/slides/0/photo')
        .send({ slot: '1', assetUrl: 'https://evil.example.com/x.jpg' }));

      expect(res.status).toBe(400);
      expect(prismaMock.slide.update).not.toHaveBeenCalled();
      expect(snapshotPost).not.toHaveBeenCalled();
      // a checagem é por marca do post, e só imagem
      expect(prismaMock.asset.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ brandId: 'b1', fileType: { startsWith: 'image/' } }),
      }));
    });

    it('esvazia o espaço com assetUrl null, e o espaço continua lá', async () => {
      prismaMock.post.findFirst.mockResolvedValue({
        ...post(),
        slides: [{ id: 'row-0', position: 0, contentJson: { html: `<div data-photo-slot="1"><img src="${FOTO}"></div>` } }],
      });
      const res = await auth(request(app).put('/api/posts/post-1/slides/0/photo').send({ slot: '1', assetUrl: null }));

      expect(res.status).toBe(200);
      expect(res.body.data.slots).toMatchObject([{ slot: '1', hasPhoto: false }]);
    });

    it('só reenquadra quando assetUrl é omitido, mantendo a foto atual', async () => {
      prismaMock.post.findFirst.mockResolvedValue({
        ...post(),
        slides: [{ id: 'row-0', position: 0, contentJson: { html: `<div data-photo-slot="1"><img src="${FOTO}"></div>` } }],
      });
      const res = await auth(request(app).put('/api/posts/post-1/slides/0/photo')
        .send({ slot: '1', position: { x: 30, y: 70 } }));

      expect(res.status).toBe(200);
      expect(res.body.data.slots[0]).toMatchObject({ src: FOTO, position: { x: 30, y: 70 } });
      expect(prismaMock.asset.findFirst).not.toHaveBeenCalled(); // a foto não mudou
    });

    it('reenquadrar não desfaz o "mostrar inteira"; foto nova volta ao centro', async () => {
      prismaMock.post.findFirst.mockResolvedValue({
        ...post(),
        slides: [{ id: 'row-0', position: 0, contentJson: {
          html: `<div data-photo-slot="1"><img src="${FOTO}" style="object-fit:contain;object-position:20% 30%"></div>`,
        } }],
      });
      const so = await auth(request(app).put('/api/posts/post-1/slides/0/photo').send({ slot: '1', position: { x: 60, y: 60 } }));
      expect(so.body.data.slots[0]).toMatchObject({ fit: 'contain', position: { x: 60, y: 60 } });

      const nova = await auth(request(app).put('/api/posts/post-1/slides/0/photo')
        .send({ slot: '1', assetUrl: 'https://cdn.example.com/brands/b1/outra.jpg' }));
      expect(nova.body.data.slots[0]).toMatchObject({ position: { x: 50, y: 50 }, fit: 'contain' });
    });

    it('reenquadrar um espaço vazio é erro claro', async () => {
      const res = await auth(request(app).put('/api/posts/post-1/slides/0/photo').send({ slot: '1', position: { x: 10, y: 10 } }));
      expect(res.status).toBe(400);
    });

    it('404 para espaço que não existe no slide', async () => {
      const res = await auth(request(app).put('/api/posts/post-1/slides/0/photo').send({ slot: '99', assetUrl: FOTO }));
      expect(res.status).toBe(404);
      expect(prismaMock.slide.update).not.toHaveBeenCalled();
    });

    it('404 quando a pessoa não é editora da marca (o filtro de acesso vai na consulta)', async () => {
      prismaMock.post.findFirst.mockResolvedValue(null);
      const res = await auth(request(app).put('/api/posts/post-1/slides/0/photo').send({ slot: '1', assetUrl: FOTO }));
      expect(res.status).toBe(404);
      expect(prismaMock.slide.update).not.toHaveBeenCalled();
    });

    it('400 para corpo inválido', async () => {
      const res = await auth(request(app).put('/api/posts/post-1/slides/0/photo').send({ assetUrl: FOTO }));
      expect(res.status).toBe(400);
    });

    it('400 para design que não é html-design', async () => {
      prismaMock.post.findFirst.mockResolvedValue({ ...post(), content: { kind: 'ir-design' } });
      const res = await auth(request(app).put('/api/posts/post-1/slides/0/photo').send({ slot: '1', assetUrl: FOTO }));
      expect(res.status).toBe(400);
    });
  });
});
