import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { prismaMock } from './client';
import { app } from '../app';
import { config } from '../config';

// Valida o schema zod de POST /api/ai/:slug/create-job. Antes, o corpo era lido
// com cast manual (req.body as ...) e campos escalares malformados viravam erro
// obscuro ou default silencioso lá adiante. Agora assertValidCreateBody rejeita
// com 400 claro logo no início de resolveCreatePayload. A rota passa antes pelo
// param middleware requireBrandRole (aiRouter.param('slug', ...)), por isso a
// marca e o membro são mockados; a validação malformada dispara antes do segundo
// lookup de marca / do pipeline, então nenhuma geração async é iniciada.

const token = jwt.sign({ userId: 'u1', role: 'OWNER' }, config.jwtSecret);
const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
const post = (body: unknown) => auth(request(app).post('/api/ai/qualquer-marca/create-job').send(body as object));

describe('POST /api/ai/:slug/create-job — validação de corpo (zod)', () => {
  beforeEach(() => {
    // requireBrandRole(EDITORS) resolve a marca e a associação do usuário.
    prismaMock.brand.findUnique = vi.fn().mockResolvedValue({ id: 'brand-1', slug: 'qualquer-marca' });
    prismaMock.brandMember.findUnique = vi.fn().mockResolvedValue({ role: 'EDITOR' });
  });

  it('400 quando slideCount não é número', async () => {
    const res = await post({ message: 'oi', slideCount: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Corpo da requisição inválido');
    expect(res.body.error.message).toContain('slideCount');
  });

  it('400 quando mode é desconhecido', async () => {
    const res = await post({ message: 'oi', mode: 'teletransporte' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('mode');
  });

  it('400 quando generateImages não é booleano', async () => {
    const res = await post({ message: 'oi', generateImages: 'sim' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('generateImages');
  });

  it('400 quando width é negativo', async () => {
    const res = await post({ message: 'oi', width: -5 });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('width');
  });

  it('400 quando projectAssets não é array', async () => {
    const res = await post({ message: 'oi', projectAssets: 'nao-e-array' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('projectAssets');
  });

  it('escalares válidos passam do zod e caem na checagem de message (message ausente → 400 "message is required")', async () => {
    const res = await post({ slideCount: 8, width: 1080, height: 1080, mode: 'hybrid', generateImages: true });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('message is required');
  });
});
