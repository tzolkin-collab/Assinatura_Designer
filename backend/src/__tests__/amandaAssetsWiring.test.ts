import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateHtmlDesignBatched, logoBackgroundRule, brainTextRule, type GenerateHtmlDesignInput } from '../lib/htmlDesign';
import { REFERENCE_ASSET_TAGS } from '../lib/designerBrain/referenceTags';

const h = vi.hoisted(() => ({
  assets: [] as Array<{ url: string; name: string; tags?: string[] }>,
  calls: [] as unknown[],
  fail: false,
}));

vi.mock('../lib/prisma.js', () => ({
  default: {
    asset: {
      findMany: vi.fn(async (q: unknown) => {
        h.calls.push(q);
        if (h.fail) throw new Error('banco fora');
        const where = (q as { where: { url?: { in: string[] }; tags?: { has: string } } }).where;
        if (where.url) return h.assets.filter((a) => where.url!.in.includes(a.url));
        if (where.tags?.has) return h.assets.filter((a) => a.tags?.includes(where.tags!.has));
        return [];
      }),
    },
  },
}));

import { profileStyleReferences } from '../lib/designerBrain/styleReferences';

const MANUAL = 'https://r2.example/brands/b1/manual.png';
const MOOD = 'https://r2.example/brands/b1/moodboard.png';
const FONTE = 'https://r2.example/brands/b1/fonte.jpg';
const FORA = 'https://r2.example/brands/OUTRA/manual.png';

beforeEach(() => {
  h.calls.length = 0;
  h.fail = false;
  h.assets = [
    { url: MANUAL, name: 'Manual visual', tags: ['visual-manual'] },
    { url: MOOD, name: 'Moodboard para apresentações', tags: ['moodboard'] },
    { url: FONTE, name: 'Fontes', tags: ['font-reference'] },
  ];
});

describe('referências visuais da ficha que o artista passa a VER', () => {
  it('manual, moodboard e referência de fonte, nessa ordem de importância', async () => {
    const refs = await profileStyleReferences(
      { visualManual: { imageUrl: MANUAL }, typography: [{ family: 'Queens', referenceImageUrl: FONTE }, { family: 'Aeonik', referenceImageUrl: FONTE }] },
      ['b1'],
    );
    expect(refs.map((r) => r.url)).toEqual([MANUAL, MOOD, FONTE]); // a fonte repetida entra uma vez só
    expect(refs.every((r) => r.role === 'style-reference')).toBe(true);
  });

  it('URL da ficha que NÃO está na biblioteca do projeto é descartada (o servidor não baixa o que não conferiu)', async () => {
    const refs = await profileStyleReferences({ visualManual: { imageUrl: FORA } }, ['b1']);
    expect(refs.map((r) => r.url)).toEqual([MOOD]); // só o moodboard, que veio da própria biblioteca
  });

  it('confere contra as bibliotecas pedidas (a do projeto e a da base)', async () => {
    await profileStyleReferences({ visualManual: { imageUrl: MANUAL } }, ['desdobramento', 'base']);
    const q = h.calls[0] as { where: { brandId: { in: string[] } } };
    expect(q.where.brandId.in).toEqual(['desdobramento', 'base']);
  });

  it('sem ficha ou sem biblioteca: nada', async () => {
    expect(await profileStyleReferences(null, ['b1'])).toEqual([]);
    expect(await profileStyleReferences({ visualManual: { imageUrl: MANUAL } }, [])).toEqual([]);
  });

  it('o banco falhar não derruba a geração: segue sem as referências', async () => {
    h.fail = true;
    expect(await profileStyleReferences({ visualManual: { imageUrl: MANUAL } }, ['b1'])).toEqual([]);
  });

  it('as tags de referência são as que ficam fora dos arquivos oferecidos ao artista', () => {
    expect([...REFERENCE_ASSET_TAGS].sort()).toEqual(['font-reference', 'moodboard', 'palette-reference', 'visual-manual']);
  });
});

describe('logo com variantes oficiais', () => {
  it('sem variantes, vale a regra de sempre (logo opaco: coloque sobre superfície clara)', () => {
    const r = logoBackgroundRule(false);
    expect(r).toContain('LOGO SOBRE FUNDO ESCURO');
    expect(r).toContain('superfície CLARA');
  });

  it('com variantes, a escolha é pela cor do fundo, e a regra antiga ("só sobre claro") NÃO vale', () => {
    const r = logoBackgroundRule(true);
    expect(r).toContain('VARIANTES OFICIAIS');
    expect(r).toContain('a mesma cor do lugar');
    expect(r).not.toContain('superfície CLARA');
    expect(r).toContain('NUNCA aplique filtro de inversão');
  });

  it('com variantes o logo existe: a regra de texto não manda omitir nem digitar o nome', () => {
    expect(brainTextRule(true)).toContain('é a imagem fornecida');
  });

  const base = (extra: Partial<GenerateHtmlDesignInput['brand']>): GenerateHtmlDesignInput => ({
    prompt: 'Deck',
    format: 'presentation',
    width: 1920,
    height: 1080,
    slideCount: 1,
    brand: { name: 'Amanda', colors: ['#410C1C'], primaryFonts: ['Queens'], ...extra },
    skeleton: [{ title: 'Capa', goal: 'g', layout_type: 'title-hero', order: 1 }],
  });

  async function promptsDe(input: GenerateHtmlDesignInput) {
    const capturados: Array<{ sys: string; user: string }> = [];
    const gen = vi.fn(async (sys: string, user: string) => {
      capturados.push({ sys, user });
      return JSON.stringify({ reasoning: 'x', fonts: ['Inter'], slides: [{ html: '<div>a</div>', css: '' }] });
    });
    await generateHtmlDesignBatched(gen, input, (raw) => JSON.parse(raw), undefined, { concurrency: 1 });
    return capturados[0]!;
  }

  it('o artista recebe a lista das variantes (com URL) e a regra de escolha pelo fundo', async () => {
    const { sys, user } = await promptsDe(
      base({
        designerBrain: 'CÉREBRO',
        logoVariants: [
          { url: 'https://r2.example/logo-creme.png', label: 'Logo AMANDACOELHO, tinta vinho sobre fundo creme' },
          { url: 'https://r2.example/logo-vinho.png', label: 'Logo AMANDACOELHO, tinta vermelho sobre fundo vinho' },
        ],
      }),
    );
    expect(user).toContain('Logos oficiais');
    expect(user).toContain('https://r2.example/logo-creme.png');
    expect(user).toContain('tinta vermelho sobre fundo vinho');
    expect(sys).toContain('VARIANTES OFICIAIS');
    expect(sys).not.toContain('NENHUM logo foi fornecido'); // existe logo: não é para omitir
  });

  it('sem variantes e sem logo: nada de lista, e a regra antiga continua', async () => {
    const { sys, user } = await promptsDe(base({ designerBrain: 'CÉREBRO' }));
    expect(user).not.toContain('Logos oficiais');
    expect(sys).toContain('NENHUM logo foi fornecido');
    expect(sys).toContain('LOGO SOBRE FUNDO ESCURO');
  });
});
