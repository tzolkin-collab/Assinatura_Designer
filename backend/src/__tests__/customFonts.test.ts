import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearFontCache, fontFaceCss, loadFontAsset, looksLikeFontAsset, matchCustomFonts, parseFontRefs, resolveFontRefs, sniffFontFormat, toDataUriFaces,
  type FontFetchDeps, type LibraryFont,
} from '../lib/customFonts.js';
import { buildSlideDocument, ownFontsLine } from '../lib/htmlDesign.js';
import { fontSubstitutionNotice } from '../lib/designerBrain/fontNotice.js';

const header = (tag: 'ttf' | 'otf' | 'woff' | 'woff2' | 'true' | 'png'): Buffer => {
  const b = Buffer.alloc(64);
  if (tag === 'ttf') b.writeUInt32BE(0x00010000, 0);
  else if (tag === 'otf') b.write('OTTO', 0, 'latin1');
  else if (tag === 'woff') b.write('wOFF', 0, 'latin1');
  else if (tag === 'woff2') b.write('wOF2', 0, 'latin1');
  else if (tag === 'true') b.write('true', 0, 'latin1');
  else b.write('\x89PNG', 0, 'latin1');
  return b;
};

const lib = (over: Partial<LibraryFont> & { name: string }): LibraryFont => ({ id: 'a-' + over.name, url: `https://r2.example/${over.name}`, fileType: 'font/ttf', ...over });

describe('sniffFontFormat: o conteúdo manda, não o nome', () => {
  it('reconhece TTF, OTF, WOFF e WOFF2', () => {
    expect(sniffFontFormat(header('ttf'))).toBe('truetype');
    expect(sniffFontFormat(header('true'))).toBe('truetype');
    expect(sniffFontFormat(header('otf'))).toBe('opentype');
    expect(sniffFontFormat(header('woff'))).toBe('woff');
    expect(sniffFontFormat(header('woff2'))).toBe('woff2');
  });
  it('recusa o que não é fonte, mesmo com extensão de fonte', () => {
    expect(sniffFontFormat(header('png'))).toBeNull();
    expect(sniffFontFormat(Buffer.from('<svg></svg>'))).toBeNull();
  });
});

describe('looksLikeFontAsset', () => {
  it('pelo nome ou pelo tipo', () => {
    expect(looksLikeFontAsset({ name: 'Queens-Regular.OTF', fileType: 'application/octet-stream' })).toBe(true);
    expect(looksLikeFontAsset({ name: 'x.bin', fileType: 'font/woff2' })).toBe(true);
    expect(looksLikeFontAsset({ name: 'foto.jpg', fileType: 'image/jpeg' })).toBe(false);
  });
});

describe('matchCustomFonts', () => {
  const lq = lib({ name: 'Queens-Regular.ttf' });
  const la = lib({ name: 'AeonikTRIAL.otf' });
  const foto = lib({ name: 'queens.png', fileType: 'image/png' });

  it('o fileUrl da ficha manda; sem ele, o nome do arquivo com a família', () => {
    const r = matchCustomFonts([
      { family: 'Queens', source: 'custom', fileUrl: lq.url },
      { family: 'Aeonik', source: 'custom' },
    ], [foto, lq, la]);
    expect(r.map((x) => [x.family, x.asset.id])).toEqual([['Queens', lq.id], ['Aeonik', la.id]]);
  });
  it('só source custom entra; Google e referência ficam de fora; imagem com o nome da família não vira fonte', () => {
    expect(matchCustomFonts([{ family: 'Queens', source: 'reference' }, { family: 'Inter', source: 'google' }], [lq])).toEqual([]);
    expect(matchCustomFonts([{ family: 'Queens', source: 'custom' }], [foto])).toEqual([]);
  });
});

describe('loadFontAsset / resolveFontRefs', () => {
  beforeEach(() => clearFontCache());
  const deps = (buf: Buffer, asset: { name: string; fileType: string | null } | null = { name: 'f.ttf', fileType: 'font/ttf' }): FontFetchDeps => ({
    findAsset: async () => (asset ? { url: 'https://r2.example/f', ...asset } : null),
    fetchBytes: async () => buf,
  });

  it('carrega e guarda em cache; extensão mentirosa não passa', async () => {
    const ok = await loadFontAsset('asset-0001', deps(header('ttf')));
    expect(ok?.format).toBe('truetype');
    expect(await loadFontAsset('asset-0002', deps(header('png')))).toBeNull();
    expect(await loadFontAsset('asset-0003', deps(header('ttf'), null))).toBeNull();
    expect(await loadFontAsset('asset-0004', deps(header('ttf'), { name: 'foto.jpg', fileType: 'image/jpeg' }))).toBeNull();
  });
  it('falha de rede vira null, sem derrubar a geração', async () => {
    const quebrado: FontFetchDeps = { findAsset: async () => ({ url: 'u', name: 'f.ttf', fileType: null }), fetchBytes: async () => { throw new Error('rede'); } };
    expect(await loadFontAsset('asset-0005', quebrado)).toBeNull();
  });
  it('resolveFontRefs devolve só o que carregou de verdade', async () => {
    const q = lib({ name: 'Queens.ttf', id: 'asset-queens' });
    const refs = await resolveFontRefs(
      [{ family: 'Queens', source: 'custom' }, { family: 'Aeonik', source: 'custom' }],
      ['b1'],
      { library: async () => [q], load: async (id) => (id === 'asset-queens' ? { buf: header('otf'), format: 'opentype' as const } : null) },
    );
    expect(refs).toEqual([{ family: 'Queens', assetId: 'asset-queens', format: 'opentype' }]);
  });
  it('sem família custom nem consulta a biblioteca', async () => {
    let chamou = false;
    const r = await resolveFontRefs([{ family: 'Inter', source: 'google' }], ['b1'], { library: async () => { chamou = true; return []; } });
    expect(r).toEqual([]);
    expect(chamou).toBe(false);
  });
});

describe('CSS e documento', () => {
  const face = { family: 'Queens', src: 'url(data:font/ttf;base64,AAAA) format("truetype")' };

  it('@font-face da família própria, e ela some do link do Google', () => {
    const doc = buildSlideDocument({ html: '<h1>Oi</h1>' }, ['Queens', 'Inter'], 1080, 1080, [face]);
    expect(doc).toContain('@font-face{font-family:"Queens";src:url(data:font/ttf;base64,AAAA)');
    expect(doc).toContain('family=Inter');
    expect(doc).not.toContain('family=Queens');
  });
  it('só fontes próprias: nenhum link do Google (nada de Inter extra)', () => {
    const doc = buildSlideDocument({ html: '<p>x</p>' }, ['Queens'], 1080, 1080, [face]);
    expect(doc).not.toContain('fonts.googleapis.com/css2');
  });
  it('sem fontes próprias o documento é o de sempre', () => {
    const doc = buildSlideDocument({ html: '<p>x</p>' }, ['Playfair Display'], 1080, 1080);
    expect(doc).toContain('family=Playfair+Display');
    expect(doc).not.toContain('@font-face');
  });
  it('nome de família com caractere perigoso não escapa do CSS', () => {
    expect(fontFaceCss([{ family: 'A";}body{x:y', src: 'url(x)' }])).toContain('font-family:"Abodyxy"');
  });
  it('toDataUriFaces embute o arquivo em base64', async () => {
    const f = await toDataUriFaces([{ family: 'Queens', assetId: 'asset-queens', format: 'truetype' }], async () => ({ buf: Buffer.from('ABC'), format: 'truetype' as const }));
    expect(f[0]!.src).toBe(`url(data:font/ttf;base64,${Buffer.from('ABC').toString('base64')}) format("truetype")`);
  });
});

describe('parseFontRefs (o conteúdo vem do banco e do modelo)', () => {
  it('descarta lixo e limita a 4', () => {
    const ok = { family: 'Queens', assetId: 'asset-queens', format: 'woff2' };
    expect(parseFontRefs([ok, { family: 1 }, null, { ...ok, format: 'exe' }, { ...ok, assetId: '../x' }])).toEqual([ok]);
    expect(parseFontRefs('x')).toEqual([]);
    expect(parseFontRefs(Array(9).fill(ok))).toHaveLength(4);
  });
});

describe('integração com o aviso e o prompt', () => {
  it('a fonte instalada tira o aviso de substituição; a que falta continua avisando', () => {
    expect(fontSubstitutionNotice({ official: ['Queens'], used: ['Queens'], installed: ['Queens'] })).toBeNull();
    expect(fontSubstitutionNotice({ official: ['Queens', 'Aeonik'], used: ['Queens', 'Inter'], installed: ['Queens'] })).toContain('Aeonik');
  });
  it('o artista recebe os nomes exatos das fontes próprias', () => {
    expect(ownFontsLine(['Queens'])).toContain('Queens');
    expect(ownFontsLine([])).toBe('');
    expect(ownFontsLine(undefined)).toBe('');
  });
});
