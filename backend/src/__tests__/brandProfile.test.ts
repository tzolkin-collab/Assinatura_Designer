import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import { prismaMock } from './client';
import { app } from '../app';
import jwt from 'jsonwebtoken';
import {
  brandProfileSchema,
  profileCompleteness,
  profileFromLegacy,
  renderProjectMemory,
  type BrandProfileData,
} from '../lib/brandProfile';

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
    sign: vi.fn(() => 'jwt-assinado'),
    JsonWebTokenError: class JsonWebTokenError extends Error {},
  },
}));

const mockedVerify = jwt.verify as unknown as Mock;
const auth = (r: request.Test) => r.set('Authorization', 'Bearer token');

const fichaCompleta: BrandProfileData = {
  essence: 'Mulher forte, sofisticada, segura e contemporânea.',
  writingDirection: 'Direta e elegante, sem clichê corporativo.',
  palette: [
    { hex: '#410C1C', name: 'Vinho profundo', role: 'principal, fundos dramáticos' },
    { hex: '#FCF9EB', role: 'fundo claro' },
  ],
  typography: [
    { family: 'Queens', role: 'títulos', source: 'reference' },
    { family: 'Aeonik', role: 'textos' },
  ],
  logo: { files: [{ url: 'https://cdn.exemplo.com/logo.png', label: 'wordmark' }], rules: 'Nunca redesenhar.' },
  visualManual: { imageUrl: 'https://cdn.exemplo.com/manual.png' },
  artDirection: 'Editorial, assimétrica, com respiro.',
  realPhoto: 'Só fotos reais fornecidas; P&B é bem-vindo.',
  graphicElements: 'Linhas finas e monograma ampliado.',
  neverDo: ['Degradês coloridos', 'Texto sobre rosto'],
  approvalCriterion: 'Parece de uma empresária que constrói negócios.',
};

describe('brandProfileSchema', () => {
  it('aceita ficha vazia: ela se preenche aos poucos', () => {
    expect(brandProfileSchema.safeParse({}).success).toBe(true);
  });

  it('normaliza o hex para maiúsculas e recusa cor fora do formato', () => {
    const ok = brandProfileSchema.parse({ palette: [{ hex: '#410c1c' }] });
    expect(ok.palette![0]!.hex).toBe('#410C1C');
    expect(brandProfileSchema.safeParse({ palette: [{ hex: 'vinho' }] }).success).toBe(false);
    expect(brandProfileSchema.safeParse({ palette: [{ hex: '#FFF' }] }).success).toBe(false);
  });

  it('recusa arquivo que não é https', () => {
    expect(brandProfileSchema.safeParse({ logo: { files: [{ url: 'javascript:alert(1)' }] } }).success).toBe(false);
    expect(brandProfileSchema.safeParse({ visualManual: { imageUrl: 'http://x.com/a.png' } }).success).toBe(false);
  });

  it('recusa origem de fonte desconhecida', () => {
    expect(brandProfileSchema.safeParse({ typography: [{ family: 'X', source: 'pirata' }] }).success).toBe(false);
  });
});

describe('profileCompleteness', () => {
  it('ficha vazia: 0%, não pronta, todas as seções pendentes', () => {
    const c = profileCompleteness({});
    expect(c.percent).toBe(0);
    expect(c.ready).toBe(false);
    expect(c.pending).toHaveLength(11);
  });

  it('ficha completa: 100% e pronta', () => {
    const c = profileCompleteness(fichaCompleta);
    expect(c.percent).toBe(100);
    expect(c.ready).toBe(true);
    expect(c.pending).toEqual([]);
  });

  it('só faltam as recomendadas: continua pronta, com percentual menor', () => {
    const { writingDirection, logo, realPhoto, graphicElements, ...obrigatorias } = fichaCompleta;
    void writingDirection; void logo; void realPhoto; void graphicElements;
    const c = profileCompleteness(obrigatorias);
    expect(c.ready).toBe(true);
    expect(c.percent).toBe(64);
    expect(c.pending.every((p) => !p.required)).toBe(true);
  });

  it('falta uma obrigatória: não pronta e ela aparece marcada como obrigatória', () => {
    const { approvalCriterion, ...resto } = fichaCompleta;
    void approvalCriterion;
    const c = profileCompleteness(resto);
    expect(c.ready).toBe(false);
    expect(c.pending).toEqual([{ key: 'approvalCriterion', label: 'Critério de aprovação', required: true }]);
  });

  it('texto só de espaços não conta como preenchido', () => {
    expect(profileCompleteness({ essence: '   ' }).pending.some((p) => p.key === 'essence')).toBe(true);
  });
});

describe('profileFromLegacy', () => {
  it('traz cores, fontes e logo sem inventar função nem origem', () => {
    const p = profileFromLegacy({
      colors: ['#410c1c', 'vinho', '#8E242E'],
      primaryFonts: ['Playfair Display', '  '],
      logoUrl: 'https://cdn.exemplo.com/l.png',
    });
    expect(p.palette).toEqual([{ hex: '#410C1C' }, { hex: '#8E242E' }]);
    expect(p.typography).toEqual([{ family: 'Playfair Display' }]);
    expect(p.logo?.files).toEqual([{ url: 'https://cdn.exemplo.com/l.png', label: 'Logo' }]);
    expect(p.essence).toBeUndefined();
  });

  it('diretrizes e instruções do agente vão para as notas, sem reinterpretar', () => {
    const p = profileFromLegacy({ guidelines: 'Tom sério.', agentPrompt: 'Use vinho.' });
    expect(p.legacyNotes).toContain('Tom sério.');
    expect(p.legacyNotes).toContain('Use vinho.');
  });

  it('logo que não é https é descartado; config ausente vira ficha vazia', () => {
    expect(profileFromLegacy({ logoUrl: 'http://x.com/l.png' }).logo).toBeUndefined();
    expect(profileFromLegacy(null)).toEqual({});
  });

  it('o resultado é uma ficha válida', () => {
    const p = profileFromLegacy({ colors: ['#410C1C'], primaryFonts: ['Inter'], guidelines: 'x' });
    expect(brandProfileSchema.safeParse(p).success).toBe(true);
  });
});

describe('renderProjectMemory', () => {
  it('segue o formato da ficha do documento, numerado, com a função de cada cor e fonte', () => {
    const txt = renderProjectMemory('Amanda Coelho', fichaCompleta);
    expect(txt.startsWith('PROJETO: Amanda Coelho')).toBe(true);
    expect(txt).toContain('1. ESSÊNCIA E POSICIONAMENTO');
    expect(txt).toContain('#410C1C Vinho profundo — principal, fundos dramáticos');
    expect(txt).toContain('Queens — títulos (referência visual; a fonte oficial não está instalada)');
    expect(txt).toContain('9. O QUE NUNCA FAZER\n- Degradês coloridos\n- Texto sobre rosto');
    expect(txt).toContain('11. CRITÉRIO DE APROVAÇÃO');
  });

  it('seção vazia some: o cérebro não recebe "a definir" para tratar como regra', () => {
    const txt = renderProjectMemory('Projeto X', { essence: 'Só isto.' });
    expect(txt).toContain('1. ESSÊNCIA E POSICIONAMENTO\nSó isto.');
    expect(txt).not.toMatch(/PALETA|TIPOGRAFIA|NUNCA FAZER|a definir/i);
  });

  it('as notas antigas aparecem no fim, separadas da ficha', () => {
    const txt = renderProjectMemory('X', { essence: 'a', legacyNotes: 'texto antigo' });
    expect(txt.endsWith('OBSERVAÇÕES ANTERIORES À FICHA\ntexto antigo')).toBe(true);
  });
});

describe('rotas da ficha', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedVerify.mockReturnValue({ userId: 'user-1' });
    prismaMock.brand.findUnique.mockResolvedValue({ id: 'brand-1', slug: 'amanda-coelho', name: 'Amanda Coelho' } as any);
    prismaMock.brandMember.findUnique.mockResolvedValue({ role: 'EDITOR' } as any);
  });

  it('GET sem ficha salva devolve a derivada dos campos atuais, sem gravar nada', async () => {
    prismaMock.brandProfile.findUnique.mockResolvedValue(null);
    prismaMock.brandConfig.findUnique.mockResolvedValue({ colors: ['#410C1C'], primaryFonts: ['Inter'], logoUrl: null, guidelines: '', agentPrompt: '' } as any);

    const res = await auth(request(app).get('/api/brands/amanda-coelho/profile'));

    expect(res.status).toBe(200);
    expect(res.body.data.derived).toBe(true);
    expect(res.body.data.profile.palette).toEqual([{ hex: '#410C1C' }]);
    expect(res.body.data.completeness.ready).toBe(false);
    expect(prismaMock.brandProfile.upsert).not.toHaveBeenCalled();
  });

  it('GET com ficha salva devolve a ficha e a completude', async () => {
    prismaMock.brandProfile.findUnique.mockResolvedValue({ data: fichaCompleta } as any);

    const res = await auth(request(app).get('/api/brands/amanda-coelho/profile'));

    expect(res.status).toBe(200);
    expect(res.body.data.derived).toBe(false);
    expect(res.body.data.completeness).toMatchObject({ percent: 100, ready: true });
  });

  it('GET com dado salvo fora do esquema não derruba: volta ficha vazia', async () => {
    prismaMock.brandProfile.findUnique.mockResolvedValue({ data: { palette: 'quebrado' } } as any);

    const res = await auth(request(app).get('/api/brands/amanda-coelho/profile'));

    expect(res.status).toBe(200);
    expect(res.body.data.profile).toEqual({});
  });

  it('PUT: 403 para quem só visualiza', async () => {
    prismaMock.brandMember.findUnique.mockResolvedValue({ role: 'VIEWER' } as any);

    const res = await auth(request(app).put('/api/brands/amanda-coelho/profile').send({ essence: 'x' }));

    expect(res.status).toBe(403);
    expect(prismaMock.brandProfile.upsert).not.toHaveBeenCalled();
  });

  it('PUT: 400 para hex inválido, sem gravar', async () => {
    const res = await auth(request(app).put('/api/brands/amanda-coelho/profile').send({ palette: [{ hex: 'vinho' }] }));

    expect(res.status).toBe(400);
    expect(prismaMock.brandProfile.upsert).not.toHaveBeenCalled();
  });

  it('PUT: 400 quando o logo não está na biblioteca da marca (sem SSRF)', async () => {
    prismaMock.asset.findFirst.mockResolvedValue(null);

    const res = await auth(
      request(app).put('/api/brands/amanda-coelho/profile').send({ logo: { files: [{ url: 'https://interno.exemplo.com/segredo.png' }] } }),
    );

    expect(res.status).toBe(400);
    expect(prismaMock.asset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { brandId: 'brand-1', url: 'https://interno.exemplo.com/segredo.png' } }),
    );
    expect(prismaMock.brandProfile.upsert).not.toHaveBeenCalled();
  });

  it('PUT: grava a ficha inteira quando os arquivos são da biblioteca e devolve a completude', async () => {
    prismaMock.asset.findFirst.mockResolvedValue({ id: 'a1' } as any);
    prismaMock.brandProfile.upsert.mockResolvedValue({} as any);

    const res = await auth(request(app).put('/api/brands/amanda-coelho/profile').send(fichaCompleta));

    expect(res.status).toBe(200);
    expect(res.body.data.completeness).toMatchObject({ percent: 100, ready: true });
    expect(prismaMock.brandProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { brandId: 'brand-1' },
        create: { brandId: 'brand-1', data: expect.objectContaining({ essence: fichaCompleta.essence }) },
      }),
    );
  });
});
