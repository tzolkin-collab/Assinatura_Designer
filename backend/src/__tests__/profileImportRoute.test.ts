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

// A IA não é chamada nos testes de rota: o que importa aqui é o que a rota entrega ao extrator.
vi.mock('../lib/profileExtraction', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/profileExtraction')>();
  return { ...original, extractProfileFromManual: vi.fn() };
});

import { extractProfileFromManual } from '../lib/profileExtraction';

const mockedVerify = jwt.verify as unknown as Mock;
const mockedExtract = extractProfileFromManual as unknown as Mock;
const auth = (r: request.Test) => r.set('Authorization', 'Bearer token');

const resultado = {
  draft: { palette: [{ hex: '#582731' }] },
  evidence: { palette: [{ label: '#582731', quote: 'Paleta: #582731', page: 7 }] },
  notFound: ['essence'],
  warnings: [],
  status: 'ok',
  quotesChecked: true,
};

describe('POST /api/brands/:slug/profile/import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedVerify.mockReturnValue({ userId: 'user-1' });
    prismaMock.brand.findUnique.mockResolvedValue({ id: 'brand-1', slug: 'assinatura', name: 'Assinatura' } as any);
    prismaMock.brandMember.findUnique.mockResolvedValue({ role: 'EDITOR' } as any);
    mockedExtract.mockResolvedValue(resultado);
  });

  it('403 para quem só visualiza, sem chamar a IA', async () => {
    prismaMock.brandMember.findUnique.mockResolvedValue({ role: 'VIEWER' } as any);

    const res = await auth(request(app).post('/api/brands/assinatura/profile/import').attach('files', Buffer.from('x'), 'manual.md'));

    expect(res.status).toBe(403);
    expect(mockedExtract).not.toHaveBeenCalled();
  });

  it('400 sem arquivo', async () => {
    const res = await auth(request(app).post('/api/brands/assinatura/profile/import'));

    expect(res.status).toBe(400);
    expect(mockedExtract).not.toHaveBeenCalled();
  });

  it('400 para tipo que não é manual (zip, executável)', async () => {
    const res = await auth(
      request(app).post('/api/brands/assinatura/profile/import').attach('files', Buffer.from('PK'), { filename: 'tudo.zip', contentType: 'application/zip' }),
    );

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('tudo.zip');
    expect(mockedExtract).not.toHaveBeenCalled();
  });

  it('entrega ao extrator o PDF como parte e o texto do md como texto de conferência', async () => {
    const res = await auth(
      request(app)
        .post('/api/brands/assinatura/profile/import')
        .attach('files', Buffer.from('%PDF-1.4 conteudo'), { filename: 'manual.pdf', contentType: 'application/pdf' })
        .attach('files', Buffer.from('Paleta: #582731'), { filename: 'regras.md', contentType: 'text/markdown' }),
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(resultado);
    const input = mockedExtract.mock.calls[0]![0] as any;
    expect(input.brandName).toBe('Assinatura');
    expect(input.parts).toHaveLength(1);
    expect(input.parts[0]).toMatchObject({ kind: 'pdf', fileName: 'manual.pdf' });
    expect(input.sourceText).toBe('Paleta: #582731');
  });

  it('HTML entra como texto visível, sem script nem estilo', async () => {
    await auth(
      request(app)
        .post('/api/brands/assinatura/profile/import')
        .attach('files', Buffer.from('<html><style>p{}</style><script>alert(1)</script><p>Tom &amp; voz</p></html>'), { filename: 'manual.html', contentType: 'text/html' }),
    );

    const input = mockedExtract.mock.calls[0]![0] as any;
    expect(input.sourceText).toBe('Tom & voz');
    expect(input.parts).toEqual([]);
  });

  it('é só leitura: nada é gravado na ficha', async () => {
    await auth(request(app).post('/api/brands/assinatura/profile/import').attach('files', Buffer.from('Paleta'), 'manual.txt'));

    expect(prismaMock.brandProfile.upsert).not.toHaveBeenCalled();
  });
});
