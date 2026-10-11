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
  brandCodes: [{ category: 'Tom', items: ['Sofisticado', 'Seguro'] }],
  mayVary: ['Layout dos slides', 'Ordem narrativa'],
  mustKeep: ['Logo e aplicação correta', 'Paleta como base'],
  collabRules: 'Definir quem lidera a narrativa e manter ao menos um código forte.',
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
    expect(c.pending).toHaveLength(14);
  });

  it('ficha completa: 100% e pronta', () => {
    const c = profileCompleteness(fichaCompleta);
    expect(c.percent).toBe(100);
    expect(c.ready).toBe(true);
    expect(c.pending).toEqual([]);
  });

  it('só faltam as recomendadas: continua pronta, com percentual menor', () => {
    const { writingDirection, logo, realPhoto, graphicElements, brandCodes, mayVary, mustKeep, collabRules, ...obrigatorias } = fichaCompleta;
    void writingDirection; void logo; void realPhoto; void graphicElements; void brandCodes; void mayVary; void mustKeep; void collabRules;
    const c = profileCompleteness(obrigatorias);
    expect(c.ready).toBe(true);
    expect(c.percent).toBe(50);
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

// O manual de regras de marca da Assinatura (Canva, 14 páginas, 16/09) é o exemplo da Gabriela de como um
// projeto que NÃO é a Amanda chega ao sistema. O que vai abaixo é só o que está escrito nas páginas lidas
// (as páginas 13 e 14 são imagem). O teste prova que a mesma ficha serve a outro projeto e que o que o
// manual não traz aparece como pendência, sem ser inventado.
const manualAssinatura: BrandProfileData = {
  writingDirection: 'Tom sofisticado, moderno, acolhedor, acessível e seguro.',
  palette: ['#582731', '#233766', '#8A0E2E', '#545BAE', '#D41D59', '#E9BDA6'].map((hex) => ({ hex })),
  typography: [
    { family: 'Aileron', role: 'Textos, subtítulos, explicações e materiais institucionais' },
    { family: 'Monument', role: 'Títulos curtos, chamadas fortes e palavras-chave' },
  ],
  artDirection:
    'Respiro, elegância, clareza e qualidade visual premium. Imagens elegantes e com boa luz; texturas cosméticas, pele, embalagem, produto e bastidores estratégicos; composição limpa.',
  neverDo: ['Poluição visual', 'Banco de imagem genérico', 'Excesso de informação', 'Descaracterizar a marca em collabs'],
  approvalCriterion:
    'Se eu tirar o logo, ainda parece Assinatura? Transmite sofisticação e autoridade? O tom está moderno, acolhedor e seguro? Cores e fontes estão coerentes? As imagens têm qualidade e respiro? O conteúdo reforça estratégia e valor percebido?',
  brandCodes: [
    { category: 'Personalidade', items: ['Imponente', 'Antenada', 'Altruísta', 'Sofisticada', 'Ambiciosa'] },
    { category: 'Tom', items: ['Sofisticado', 'Moderno', 'Acolhedor', 'Acessível', 'Seguro'] },
    { category: 'Conteúdo', items: ['Estratégia', 'Conhecimento', 'Inovação', 'Marca própria', 'Realização'] },
    { category: 'Acabamento', items: ['Respiro', 'Elegância', 'Clareza', 'Qualidade visual', 'Premium'] },
  ],
  mayVary: ['Layout dos slides', 'Ordem narrativa', 'Imagens e mockups', 'Intensidade das cores', 'Elementos de apoio', 'Estética de campanha'],
  mustKeep: ['Logo e aplicação correta', 'Paleta como base', 'Fonte e hierarquia', 'Tom seguro e acolhedor', 'Sofisticação visual', 'Estratégia no conteúdo'],
  collabRules:
    'Pode adaptar, não pode descaracterizar. Definir quem lidera a narrativa. Definir a hierarquia dos logos. Equilibrar a paleta da Assinatura com a da marca parceira. Manter pelo menos um código forte da Assinatura. Garantir que a parceria some valor sem apagar a marca.',
};

describe('o manual de marca da Assinatura cabe na ficha (outro projeto, não a Amanda)', () => {
  it('é uma ficha válida', () => {
    expect(brandProfileSchema.safeParse(manualAssinatura).success).toBe(true);
  });

  it('o que o manual não traz fica pendente, sem ser inventado', () => {
    const c = profileCompleteness(manualAssinatura);
    // A plataforma de marca em texto é outro documento, e o manual visual em imagem não foi enviado.
    expect(c.pending.filter((p) => p.required).map((p) => p.key)).toEqual(['essence', 'visualManual']);
    expect(c.pending.filter((p) => !p.required).map((p) => p.key)).toEqual(['logo', 'realPhoto', 'graphicElements']);
    expect(c.ready).toBe(false);
    expect(c.percent).toBe(64);
  });

  it('vira a memória do projeto com os códigos, o que varia e o que fica', () => {
    const txt = renderProjectMemory('Assinatura', manualAssinatura);
    expect(txt).toContain('Aileron — Textos, subtítulos, explicações e materiais institucionais');
    expect(txt).toContain('CÓDIGOS QUE NÃO PODEM SUMIR\n- Personalidade: Imponente, Antenada, Altruísta, Sofisticada, Ambiciosa');
    expect(txt).toContain('O QUE PODE VARIAR\n- Layout dos slides');
    expect(txt).toContain('O QUE PRECISA FICAR\n- Logo e aplicação correta');
    expect(txt).toContain('REGRAS DE COLLAB\nPode adaptar, não pode descaracterizar.');
    expect(txt).not.toContain('1. ESSÊNCIA');
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
