import { describe, it, expect } from 'vitest';
import {
  fontFaceCss,
  matchCustomFontFiles,
  parseFontRefs,
  pickFaces,
  readFontMeta,
  resolveFontRefs,
  toDataUriFaces,
  MAX_FACES_PER_FAMILY,
  type FontFaceRef,
} from '../lib/customFonts';

/** sfnt mínimo (só o diretório de tabelas e as tabelas OS/2 e fvar): o que readFontMeta lê. */
function sfnt(opts: { weight: number; italic?: boolean; wght?: [number, number]; otto?: boolean }): Buffer {
  const tables: Array<{ tag: string; data: Buffer }> = [];
  const os2 = Buffer.alloc(78);
  os2.writeUInt16BE(opts.weight, 4);
  os2.writeUInt16BE(opts.italic ? 1 : 0x40, 62);
  tables.push({ tag: 'OS/2', data: os2 });
  if (opts.wght) {
    const fvar = Buffer.alloc(16 + 20);
    fvar.writeUInt16BE(16, 4); // offset dos eixos
    fvar.writeUInt16BE(1, 8); // quantidade
    fvar.writeUInt16BE(20, 10); // tamanho do eixo
    fvar.write('wght', 16, 'latin1');
    fvar.writeInt32BE(opts.wght[0] * 65536, 20);
    fvar.writeInt32BE(opts.wght[0] * 65536, 24);
    fvar.writeInt32BE(opts.wght[1] * 65536, 28);
    tables.push({ tag: 'fvar', data: fvar });
  }
  const head = Buffer.alloc(12);
  head.write(opts.otto ? 'OTTO' : '\u0000\u0001\u0000\u0000', 0, 'latin1');
  head.writeUInt16BE(tables.length, 4);
  let offset = 12 + tables.length * 16;
  const dir = Buffer.alloc(tables.length * 16);
  tables.forEach((t, i) => {
    dir.write(t.tag, i * 16, 'latin1');
    dir.writeUInt32BE(offset, i * 16 + 8);
    dir.writeUInt32BE(t.data.length, i * 16 + 12);
    offset += t.data.length;
  });
  return Buffer.concat([head, dir, ...tables.map((t) => t.data)]);
}

describe('readFontMeta (peso e estilo vêm do arquivo, não do nome)', () => {
  it('estático: usWeightClass e itálico', () => {
    expect(readFontMeta(sfnt({ weight: 400 }))).toEqual({ weight: '400', style: 'normal', variable: false });
    expect(readFontMeta(sfnt({ weight: 700, italic: true, otto: true }))).toEqual({ weight: '700', style: 'italic', variable: false });
  });

  it('peso fora da grade de 100 em 100 é mantido (Aeonik Light tem 250)', () => {
    expect(readFontMeta(sfnt({ weight: 250 }))?.weight).toBe('250');
  });

  it('variável: a faixa do eixo wght', () => {
    expect(readFontMeta(sfnt({ weight: 300, wght: [300, 800] }))).toEqual({ weight: '300 800', style: 'normal', variable: true });
  });

  it('lixo ou arquivo curto devolve null, sem lançar', () => {
    expect(readFontMeta(Buffer.from('nao e fonte'))).toBeNull();
    expect(readFontMeta(Buffer.alloc(4))).toBeNull();
  });
});

describe('matchCustomFontFiles', () => {
  const lib = [
    { id: 'a1', name: 'Aeonik-Regular.otf', url: 'https://r2/a-reg', fileType: 'font/otf' },
    { id: 'a2', name: 'Aeonik-Bold.otf', url: 'https://r2/a-bold', fileType: 'font/otf' },
    { id: 'q1', name: 'Queens-Regular.ttf', url: 'https://r2/q-reg', fileType: 'font/ttf' },
    { id: 'p1', name: 'Manual Aeonik.png', url: 'https://r2/manual', fileType: 'image/png' },
  ];

  it('devolve todos os arquivos da família, e só os que são fonte', () => {
    const out = matchCustomFontFiles([{ family: 'Aeonik', source: 'custom' }], lib);
    expect(out).toHaveLength(1);
    expect(out[0]!.assets.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('o arquivo apontado em fileUrl vem primeiro', () => {
    const out = matchCustomFontFiles([{ family: 'Aeonik', source: 'custom', fileUrl: 'https://r2/a-bold' }], lib);
    expect(out[0]!.assets.map((a) => a.id)).toEqual(['a2', 'a1']);
  });

  it('família que não é custom ou sem arquivo fica de fora', () => {
    expect(matchCustomFontFiles([{ family: 'Aeonik', source: 'google' }], lib)).toEqual([]);
    expect(matchCustomFontFiles([{ family: 'Cooper', source: 'custom' }], lib)).toEqual([]);
  });
});

describe('pickFaces', () => {
  const f = (weight: string, extra: Partial<FontFaceRef & { variable: boolean }> = {}) => ({
    family: 'Aeonik', assetId: `id-${weight}-${extra.style ?? 'n'}`, format: 'opentype' as const, weight, style: 'normal' as const, variable: false, ...extra,
  });

  it('um arquivo por peso e estilo, respeitando o teto', () => {
    const many = ['100', '200', '250', '400', '500', '700', '900'].map((w) => f(w));
    const out = pickFaces([...many, f('400', { assetId: 'dup' })]);
    expect(out).toHaveLength(MAX_FACES_PER_FAMILY);
    expect(MAX_FACES_PER_FAMILY).toBe(4);
    expect(out.filter((r) => r.weight === '400')).toHaveLength(1);
    // pesos de texto antes dos extremos
    const weights = out.map((r) => r.weight);
    expect(weights).toContain('400');
    expect(weights).toContain('700');
    expect(weights).toContain('500');
    expect(weights).toContain('250');
  });

  it('estático dentro da faixa da variável é descartado; fora dela, ou itálico, fica', () => {
    const v = f('300 800', { variable: true, assetId: 'var-1' });
    expect(pickFaces([f('400'), v]).map((r) => r.weight)).toEqual(['300 800']);
    expect(pickFaces([f('900'), v]).map((r) => r.weight)).toEqual(['300 800', '900']);
    expect(pickFaces([f('400', { style: 'italic' }), v]).map((r) => `${r.weight}/${r.style}`)).toEqual(['300 800/normal', '400/italic']);
  });

  it('peso fora da grade conta como o alvo mais próximo (Light 250 entra antes de Thin 200)', () => {
    const out = pickFaces(['100', '200', '250', '400', '700', '900'].map((w) => f(w)), 4);
    expect(out.map((r) => r.weight)).toEqual(['200', '250', '400', '700']);
    expect(out.map((r) => r.weight)).toContain('250');
    expect(out.map((r) => r.weight)).not.toContain('100');
  });

  it('não vaza a marca interna `variable` para a referência guardada no deck', () => {
    const out = pickFaces([f('400')]);
    expect(out[0]).not.toHaveProperty('variable');
  });
});

describe('fontFaceCss com peso e estilo', () => {
  it('cada arquivo vira um @font-face com seu peso', () => {
    const css = fontFaceCss([
      { family: 'Aeonik', src: 'url(x) format("opentype")', weight: '400', style: 'normal' },
      { family: 'Aeonik', src: 'url(y) format("opentype")', weight: '700', style: 'italic' },
    ]);
    expect(css).toContain('font-weight:400;font-style:normal');
    expect(css).toContain('font-weight:700;font-style:italic');
  });

  it('sem peso declarado mantém o comportamento antigo (100 900)', () => {
    expect(fontFaceCss([{ family: 'Queens', src: 'url(x)' }])).toContain('font-weight:100 900;font-style:normal');
  });

  it('peso malformado não entra no CSS', () => {
    expect(fontFaceCss([{ family: 'Queens', src: 'url(x)', weight: 'bold;}body{' }])).toContain('font-weight:100 900');
  });
});

describe('parseFontRefs e toDataUriFaces carregam peso e estilo', () => {
  it('mantém peso válido e descarta o malformado', () => {
    const base = { family: 'Aeonik', assetId: 'asset-12345', format: 'opentype' };
    const out = parseFontRefs([{ ...base, weight: '700', style: 'italic' }, { ...base, weight: 'x', style: 'oblique' }]);
    expect(out[0]).toMatchObject({ weight: '700', style: 'italic' });
    expect(out[1]).toEqual(base);
  });

  it('toDataUriFaces repassa peso e estilo', async () => {
    const faces = await toDataUriFaces(
      [{ family: 'Aeonik', assetId: 'asset-12345', format: 'opentype', weight: '700', style: 'italic' }],
      async () => ({ buf: Buffer.from('abc'), format: 'opentype' }),
    );
    expect(faces[0]).toMatchObject({ family: 'Aeonik', weight: '700', style: 'italic' });
  });
});

describe('resolveFontRefs com vários arquivos por família', () => {
  it('lê o peso de cada arquivo e entrega referências por peso', async () => {
    const files: Record<string, Buffer> = {
      a1: sfnt({ weight: 400, otto: true }),
      a2: sfnt({ weight: 700, otto: true }),
      q1: sfnt({ weight: 400 }),
      q2: sfnt({ weight: 300, wght: [300, 800] }),
    };
    const refs = await resolveFontRefs(
      [{ family: 'Aeonik', source: 'custom' }, { family: 'Queens', source: 'custom' }],
      ['b1'],
      {
        library: async () => [
          { id: 'a1', name: 'Aeonik-Regular.otf', url: 'u1', fileType: 'font/otf' },
          { id: 'a2', name: 'Aeonik-Bold.otf', url: 'u2', fileType: 'font/otf' },
          { id: 'q1', name: 'Queens-Regular.ttf', url: 'u3', fileType: 'font/ttf' },
          { id: 'q2', name: 'QueensVar.ttf', url: 'u4', fileType: 'font/ttf' },
        ],
        load: async (id) => (files[id] ? { buf: files[id]!, format: id.startsWith('a') ? 'opentype' : 'truetype' } : null),
      },
    );
    const aeonik = refs.filter((r) => r.family === 'Aeonik');
    expect(aeonik.map((r) => r.weight)).toEqual(['400', '700']);
    const queens = refs.filter((r) => r.family === 'Queens');
    expect(queens.map((r) => r.weight)).toEqual(['300 800']);
  });
});
