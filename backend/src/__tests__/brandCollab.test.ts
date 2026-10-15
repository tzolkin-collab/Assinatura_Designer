import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import { prismaMock } from './client';
import { app } from '../app';
import jwt from 'jsonwebtoken';
import { createCollabSchema, collabSlug } from '../lib/brandCollab';

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
    sign: vi.fn(() => 'jwt-assinado'),
    JsonWebTokenError: class JsonWebTokenError extends Error {},
  },
}));

const mockedVerify = jwt.verify as unknown as Mock;
const auth = (r: request.Test) => r.set('Authorization', 'Bearer token');

describe('createCollabSchema', () => {
  it('aceita desdobramento interno só com nome e contexto', () => {
    const r = createCollabSchema.safeParse({ name: 'Mentoria', kind: 'INTERNAL', details: { context: 'Programa de mentoria' } });
    expect(r.success).toBe(true);
  });

  it('parceria exige parceiro e protagonismo', () => {
    const semParceiro = createCollabSchema.safeParse({ name: 'Estadão', kind: 'PARTNERSHIP', details: { baseProtagonism: 70 } });
    const semProtagonismo = createCollabSchema.safeParse({ name: 'Estadão', kind: 'PARTNERSHIP', details: { partner: { name: 'Estadão' } } });
    expect(semParceiro.success).toBe(false);
    expect(semProtagonismo.success).toBe(false);
  });

  it('parceria completa passa, inclusive 50/50', () => {
    const r = createCollabSchema.safeParse({
      name: 'Amanda + Estadão',
      kind: 'PARTNERSHIP',
      details: { partner: { name: 'Estadão', logoUrl: 'https://cdn.exemplo.com/logo.png' }, baseProtagonism: 50 },
    });
    expect(r.success).toBe(true);
  });

  it('interno não aceita parceiro nem protagonismo', () => {
    const comParceiro = createCollabSchema.safeParse({ name: 'X', kind: 'INTERNAL', details: { partner: { name: 'Y' } } });
    const comProtagonismo = createCollabSchema.safeParse({ name: 'X', kind: 'INTERNAL', details: { baseProtagonism: 60 } });
    expect(comParceiro.success).toBe(false);
    expect(comProtagonismo.success).toBe(false);
  });

  it('protagonismo fora de 0 a 100 ou fracionado é recusado', () => {
    for (const baseProtagonism of [-1, 101, 55.5]) {
      const r = createCollabSchema.safeParse({ name: 'P', kind: 'PARTNERSHIP', details: { partner: { name: 'P' }, baseProtagonism } });
      expect(r.success).toBe(false);
    }
  });

  it('recusa URL de logo que não é URL', () => {
    const r = createCollabSchema.safeParse({ name: 'P', kind: 'PARTNERSHIP', details: { partner: { name: 'P', logoUrl: 'javascript:alert(1)' }, baseProtagonism: 50 } });
    expect(r.success).toBe(false);
  });
});

describe('collabSlug', () => {
  it('prefixa com o slug da base e tira acento e símbolos', () => {
    expect(collabSlug('amanda-coelho', 'Mentoria Amanda')).toBe('amanda-coelho-mentoria-amanda');
    expect(collabSlug('amanda-coelho', 'Amanda + Estadão!')).toBe('amanda-coelho-amanda-estadao');
  });

  it('nome só com símbolos ainda gera um slug válido', () => {
    expect(collabSlug('amanda-coelho', '+++')).toBe('amanda-coelho-desdobramento');
  });
});

describe('POST /api/brands/:slug/collabs', () => {
  const body = { name: 'Mentoria Amanda', kind: 'INTERNAL', details: { context: 'Mentoria' } };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedVerify.mockReturnValue({ userId: 'user-1' });
    // requireBrandRole: marca + membership
    prismaMock.brand.findUnique.mockResolvedValue({ id: 'base-1', slug: 'amanda-coelho', name: 'Amanda Coelho' } as any);
    prismaMock.brandMember.findUnique.mockResolvedValue({ role: 'EDITOR' } as any);
  });

  it('403 para quem só visualiza a base', async () => {
    prismaMock.brandMember.findUnique.mockResolvedValue({ role: 'VIEWER' } as any);

    const res = await auth(request(app).post('/api/brands/amanda-coelho/collabs').send(body));

    expect(res.status).toBe(403);
    expect(prismaMock.brand.create).not.toHaveBeenCalled();
  });

  it('400 quando a marca-pai já é um desdobramento (herança de um nível só)', async () => {
    prismaMock.brand.findUnique
      .mockResolvedValueOnce({ id: 'filho-1', slug: 'amanda-coelho-mentoria', name: 'Mentoria' } as any) // requireBrandRole
      .mockResolvedValueOnce({ id: 'filho-1', slug: 'amanda-coelho-mentoria', color: '#000', kind: 'INTERNAL', members: [] } as any);

    const res = await auth(request(app).post('/api/brands/amanda-coelho-mentoria/collabs').send(body));

    expect(res.status).toBe(400);
    expect(prismaMock.brand.create).not.toHaveBeenCalled();
  });

  it('409 quando já existe desdobramento com esse slug', async () => {
    prismaMock.brand.findUnique
      .mockResolvedValueOnce({ id: 'base-1', slug: 'amanda-coelho', name: 'Amanda Coelho' } as any)
      .mockResolvedValueOnce({ id: 'base-1', slug: 'amanda-coelho', color: '#410C1C', kind: 'BASE', members: [] } as any)
      .mockResolvedValueOnce({ id: 'ja-existe' } as any);

    const res = await auth(request(app).post('/api/brands/amanda-coelho/collabs').send(body));

    expect(res.status).toBe(409);
    expect(prismaMock.brand.create).not.toHaveBeenCalled();
  });

  it('400 para parceria sem parceiro, sem tocar no banco', async () => {
    const res = await auth(
      request(app).post('/api/brands/amanda-coelho/collabs').send({ name: 'Estadão', kind: 'PARTNERSHIP', details: {} }),
    );

    expect(res.status).toBe(400);
    expect(prismaMock.brand.create).not.toHaveBeenCalled();
  });

  const parceria = {
    name: 'Amanda + Estadão',
    kind: 'PARTNERSHIP',
    details: { partner: { name: 'Estadão', logoUrl: 'https://cdn.exemplo.com/estadao.png' }, baseProtagonism: 70 },
  };

  it('400 quando o logo do parceiro não está na biblioteca da base', async () => {
    prismaMock.brand.findUnique
      .mockResolvedValueOnce({ id: 'base-1', slug: 'amanda-coelho', name: 'Amanda Coelho' } as any)
      .mockResolvedValueOnce({ id: 'base-1', slug: 'amanda-coelho', color: '#410C1C', kind: 'BASE', members: [] } as any);
    prismaMock.asset.findFirst.mockResolvedValue(null);

    const res = await auth(request(app).post('/api/brands/amanda-coelho/collabs').send(parceria));

    expect(res.status).toBe(400);
    expect(prismaMock.asset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { brandId: 'base-1', url: 'https://cdn.exemplo.com/estadao.png' } }),
    );
    expect(prismaMock.brand.create).not.toHaveBeenCalled();
  });

  it('cria a parceria quando o logo está na biblioteca da base', async () => {
    prismaMock.brand.findUnique
      .mockResolvedValueOnce({ id: 'base-1', slug: 'amanda-coelho', name: 'Amanda Coelho' } as any)
      .mockResolvedValueOnce({ id: 'base-1', slug: 'amanda-coelho', color: '#410C1C', kind: 'BASE', members: [{ userId: 'user-1', role: 'OWNER' }] } as any)
      .mockResolvedValueOnce(null);
    prismaMock.asset.findFirst.mockResolvedValue({ id: 'asset-1' } as any);
    prismaMock.brand.create.mockResolvedValue({ id: 'filho-2' } as any);

    const res = await auth(request(app).post('/api/brands/amanda-coelho/collabs').send(parceria));

    expect(res.status).toBe(201);
    const data = (prismaMock.brand.create.mock.calls[0]![0] as any).data;
    expect(data.kind).toBe('PARTNERSHIP');
    expect(data.collab).toEqual(parceria.details);
  });

  it('cria ligado à base, herda a cor e a equipe e guarda só os detalhes do desdobramento', async () => {
    prismaMock.brand.findUnique
      .mockResolvedValueOnce({ id: 'base-1', slug: 'amanda-coelho', name: 'Amanda Coelho' } as any)
      .mockResolvedValueOnce({
        id: 'base-1', slug: 'amanda-coelho', color: '#410C1C', kind: 'BASE',
        members: [{ userId: 'user-1', role: 'OWNER' }, { userId: 'user-2', role: 'EDITOR' }],
      } as any)
      .mockResolvedValueOnce(null);
    prismaMock.brand.create.mockResolvedValue({ id: 'filho-1', slug: 'amanda-coelho-mentoria-amanda' } as any);

    const res = await auth(request(app).post('/api/brands/amanda-coelho/collabs').send(body));

    expect(res.status).toBe(201);
    expect(prismaMock.brand.create).toHaveBeenCalledWith({
      data: {
        name: 'Mentoria Amanda',
        slug: 'amanda-coelho-mentoria-amanda',
        color: '#410C1C',
        kind: 'INTERNAL',
        parentBrandId: 'base-1',
        collab: { context: 'Mentoria' },
        members: { create: [{ userId: 'user-1', role: 'OWNER' }, { userId: 'user-2', role: 'EDITOR' }] },
      },
    });
  });
});
