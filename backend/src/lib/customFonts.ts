// Fonte própria da marca (arquivo .ttf/.otf/.woff/.woff2 enviado à biblioteca).
//
// O sistema só carregava Google Fonts por link. Aqui a fonte enviada vira @font-face:
//  - no render do servidor (revisor, exportação, enquadramento) entra como data URI, porque o R2 não
//    manda CORS e o Chromium recusa fonte de outra origem sem ele;
//  - no navegador entra por uma rota pública de proxy (/api/public/fonts/:assetId) que manda CORS.
// O deck guarda só a referência (`content.fontFaces`: família, assetId, formato), nunca os bytes.
import prisma from './prisma.js';

export type FontFormat = 'truetype' | 'opentype' | 'woff' | 'woff2';

export type FontStyleName = 'normal' | 'italic';

export interface FontFaceRef {
  family: string;
  assetId: string;
  format: FontFormat;
  /** Peso do arquivo (`"400"`) ou faixa de uma variável (`"300 800"`). Sem ele vale 100 900, como antes. */
  weight?: string;
  style?: FontStyleName;
}

export interface FontFaceCss {
  family: string;
  /** Valor do `src` (ex.: `url(data:font/ttf;base64,...) format("truetype")`). */
  src: string;
  weight?: string;
  style?: FontStyleName;
}

/** Quantos arquivos da mesma família entram no deck (cada um vira um @font-face embutido). */
export const MAX_FACES_PER_FAMILY = 4;
/** Teto de referências guardadas no deck. */
export const MAX_FONT_REFS = 16;

const WEIGHT_RE = /^\d{1,4}( \d{1,4})?$/;

/**
 * Peso e estilo lidos do PRÓPRIO arquivo (tabelas OS/2 e fvar), nunca do nome: "Aeonik-Light" tem
 * usWeightClass 250 e "Aeonik-Air" 100, e só o arquivo diz isso. Variável: a faixa do eixo `wght`.
 * Devolve `null` quando não é um sfnt legível; o chamador então cai no comportamento antigo (100 900).
 */
export function readFontMeta(buf: Buffer): { weight: string; style: FontStyleName; variable: boolean } | null {
  try {
    if (buf.length < 12) return null;
    const count = buf.readUInt16BE(4);
    if (count < 1 || count > 64 || 12 + count * 16 > buf.length) return null;
    const tables = new Map<string, { off: number; len: number }>();
    for (let i = 0; i < count; i++) {
      const o = 12 + i * 16;
      tables.set(buf.toString('latin1', o, o + 4), { off: buf.readUInt32BE(o + 8), len: buf.readUInt32BE(o + 12) });
    }
    let weight = 400;
    let italic = false;
    const os2 = tables.get('OS/2');
    if (os2 && os2.off + 64 <= buf.length) {
      weight = buf.readUInt16BE(os2.off + 4);
      italic = (buf.readUInt16BE(os2.off + 62) & 1) === 1;
    }
    const fvar = tables.get('fvar');
    if (fvar && fvar.off + 16 <= buf.length) {
      const axesOffset = buf.readUInt16BE(fvar.off + 4);
      const axisCount = buf.readUInt16BE(fvar.off + 8);
      const axisSize = buf.readUInt16BE(fvar.off + 10);
      for (let i = 0; i < Math.min(axisCount, 16); i++) {
        const a = fvar.off + axesOffset + i * axisSize;
        if (a + 16 > buf.length) break;
        if (buf.toString('latin1', a, a + 4) === 'wght') {
          const min = Math.round(buf.readInt32BE(a + 4) / 65536);
          const max = Math.round(buf.readInt32BE(a + 12) / 65536);
          if (min >= 1 && max >= min && max <= 1000) return { weight: min === max ? String(min) : `${min} ${max}`, style: italic ? 'italic' : 'normal', variable: true };
        }
      }
    }
    const w = Math.min(1000, Math.max(1, Math.round(weight)));
    return { weight: String(w), style: italic ? 'italic' : 'normal', variable: false };
  } catch {
    return null;
  }
}

export const MAX_FONT_BYTES = 8 * 1024 * 1024;
const FONT_EXT = /\.(ttf|otf|woff2?)$/i;
const FONT_MIME = new Set(['font/ttf', 'font/otf', 'font/woff', 'font/woff2', 'application/font-woff', 'application/font-woff2', 'application/x-font-ttf', 'application/x-font-otf', 'application/vnd.ms-opentype']);

/** Formato pelo conteúdo (os 4 primeiros bytes), nunca pelo nome: o que o cliente declara não manda. */
export function sniffFontFormat(buf: Buffer): FontFormat | null {
  if (buf.length < 12) return null;
  const tag = buf.subarray(0, 4).toString('latin1');
  if (tag === 'wOFF') return 'woff';
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'OTTO') return 'opentype';
  if (buf.readUInt32BE(0) === 0x00010000 || tag === 'true') return 'truetype';
  return null;
}

/** O asset parece um arquivo de fonte? (pelo nome ou tipo; o conteúdo é conferido ao carregar). */
export function looksLikeFontAsset(a: { name: string; fileType?: string | null }): boolean {
  return FONT_EXT.test(a.name) || FONT_MIME.has((a.fileType ?? '').toLowerCase());
}

const MIME_OF: Record<FontFormat, string> = { truetype: 'font/ttf', opentype: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };
export const fontMime = (f: FontFormat): string => MIME_OF[f];

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

// ── Carregamento dos bytes (com cache: a mesma fonte aparece em todo slide e em todo render) ──────
const bytesCache = new Map<string, { buf: Buffer; format: FontFormat }>();
export const clearFontCache = (): void => bytesCache.clear();

export interface FontFetchDeps {
  findAsset: (id: string) => Promise<{ url: string; name: string; fileType: string | null } | null>;
  fetchBytes: (url: string) => Promise<Buffer>;
}

const defaultDeps: FontFetchDeps = {
  findAsset: (id) => prisma.asset.findUnique({ where: { id }, select: { url: true, name: true, fileType: true } }),
  fetchBytes: async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`fonte HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  },
};

/** Bytes e formato de um asset de fonte. `null` quando não é fonte de verdade (extensão enganosa, grande demais, ilegível). */
export async function loadFontAsset(assetId: string, deps: FontFetchDeps = defaultDeps): Promise<{ buf: Buffer; format: FontFormat } | null> {
  const hit = bytesCache.get(assetId);
  if (hit) return hit;
  try {
    const asset = await deps.findAsset(assetId);
    if (!asset || !looksLikeFontAsset(asset)) return null;
    const buf = await deps.fetchBytes(asset.url);
    if (buf.length > MAX_FONT_BYTES) return null;
    const format = sniffFontFormat(buf);
    if (!format) return null;
    const out = { buf, format };
    bytesCache.set(assetId, out);
    return out;
  } catch {
    return null;
  }
}

// ── Escolha das fontes do projeto ────────────────────────────────────────────────────────────────
export interface LibraryFont {
  id: string;
  name: string;
  url: string;
  fileType: string | null;
}

interface TypographyRow {
  family: string;
  source?: 'google' | 'custom' | 'reference';
  fileUrl?: string;
}

/**
 * Para cada família da ficha com `source:'custom'`, o arquivo de fonte da biblioteca que lhe corresponde:
 * o apontado em `fileUrl` (a escolha explícita) ou, na falta dele, um arquivo cujo nome contém a família.
 * Família sem arquivo fica de fora (o aviso de substituição continua valendo para ela).
 */
export function matchCustomFonts(typography: TypographyRow[], library: LibraryFont[]): Array<{ family: string; asset: LibraryFont }> {
  const fonts = library.filter(looksLikeFontAsset);
  const out: Array<{ family: string; asset: LibraryFont }> = [];
  const seen = new Set<string>();
  for (const t of typography) {
    if (t.source !== 'custom' || !t.family.trim() || seen.has(slug(t.family))) continue;
    const byUrl = t.fileUrl ? fonts.find((f) => f.url === t.fileUrl) : undefined;
    const byName = fonts.find((f) => slug(f.name).includes(slug(t.family)));
    const asset = byUrl ?? byName;
    if (!asset) continue;
    seen.add(slug(t.family));
    out.push({ family: t.family.trim(), asset });
  }
  return out;
}

/**
 * Todos os arquivos de fonte da biblioteca que pertencem a uma família com `source:'custom'`: o apontado em
 * `fileUrl` primeiro e depois os de nome que contém a família (Aeonik-Light, Aeonik-Bold, QueensVar...).
 */
export function matchCustomFontFiles(typography: TypographyRow[], library: LibraryFont[]): Array<{ family: string; assets: LibraryFont[] }> {
  const fonts = library.filter(looksLikeFontAsset);
  const out: Array<{ family: string; assets: LibraryFont[] }> = [];
  const seen = new Set<string>();
  for (const t of typography) {
    if (t.source !== 'custom' || !t.family.trim() || seen.has(slug(t.family))) continue;
    const explicit = t.fileUrl ? fonts.filter((f) => f.url === t.fileUrl) : [];
    const byName = fonts.filter((f) => slug(f.name).includes(slug(t.family)));
    const assets = [...explicit, ...byName.filter((f) => !explicit.some((e) => e.id === f.id))];
    if (assets.length === 0) continue;
    seen.add(slug(t.family));
    out.push({ family: t.family.trim(), assets });
  }
  return out;
}

const WEIGHT_PREFERENCE = [400, 700, 500, 300, 600, 800, 200, 900, 100];

interface FaceCandidate extends FontFaceRef {
  variable: boolean;
}

/** Faixa [min, max] de um peso declarado ("400" ou "300 800"). */
function weightRange(weight: string | undefined): [number, number] {
  const [a, b] = (weight ?? '400').split(' ').map(Number);
  return [a ?? 400, b ?? a ?? 400];
}

/**
 * Escolhe até MAX_FACES_PER_FAMILY arquivos por família, um por (peso, estilo):
 *  - estático cujo peso cai dentro da faixa de uma variável do mesmo estilo é descartado (a variável
 *    já o cobre, e cada arquivo embutido pesa centenas de KB em todo slide renderizado);
 *  - pesos de texto primeiro (400, 700, 500, 300...) e itálico depois; um peso fora da grade (Light 250)
 *    conta como o alvo mais próximo;
 *  - a variável vai PRIMEIRO no CSS, os estáticos depois, por peso.
 */
export function pickFaces(candidates: FaceCandidate[], max = MAX_FACES_PER_FAMILY): FontFaceRef[] {
  const vars = candidates.filter((c) => c.variable);
  const covered = (c: FaceCandidate): boolean =>
    vars.some((v) => (v.style ?? 'normal') === (c.style ?? 'normal') && Number(c.weight) >= weightRange(v.weight)[0] && Number(c.weight) <= weightRange(v.weight)[1]);
  const rank = (c: FaceCandidate): number => {
    if (c.variable) return -1;
    const w = Number(c.weight ?? '400');
    let best = 0;
    let bestDist = Infinity;
    WEIGHT_PREFERENCE.forEach((target, i) => {
      const d = Math.abs(w - target);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return (c.style === 'italic' ? 100 : 0) + best;
  };
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    if (!c.variable && covered(c)) return false;
    const key = `${c.weight}|${c.style}|${c.variable}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const chosen = [...unique].sort((a, b) => rank(a) - rank(b)).slice(0, max);
  const chosenVars = chosen.filter((c) => c.variable);
  const statics = chosen.filter((c) => !c.variable).sort((a, b) => Number(a.weight) - Number(b.weight));
  return [...chosenVars, ...statics].map(({ variable: _variable, ...ref }) => ref);
}

/** Referências (família + assetId + formato + peso/estilo) já conferidas pelo conteúdo dos arquivos. */
export async function resolveFontRefs(
  typography: TypographyRow[],
  brandIds: string[],
  deps: { library?: (ids: string[]) => Promise<LibraryFont[]>; load?: typeof loadFontAsset } = {},
): Promise<FontFaceRef[]> {
  if (!typography.some((t) => t.source === 'custom')) return [];
  const library = await (deps.library ?? ((ids) => prisma.asset.findMany({ where: { brandId: { in: ids } }, select: { id: true, name: true, url: true, fileType: true } })))(brandIds);
  const load = deps.load ?? loadFontAsset;
  const refs: FontFaceRef[] = [];
  for (const m of matchCustomFontFiles(typography, library)) {
    const candidates: FaceCandidate[] = [];
    for (const asset of m.assets) {
      const f = await load(asset.id);
      if (!f) continue;
      const meta = readFontMeta(f.buf);
      candidates.push({
        family: m.family,
        assetId: asset.id,
        format: f.format,
        ...(meta ? { weight: meta.weight, style: meta.style } : {}),
        variable: meta?.variable ?? false,
      });
    }
    refs.push(...pickFaces(candidates));
  }
  return refs.slice(0, MAX_FONT_REFS);
}

// ── CSS ──────────────────────────────────────────────────────────────────────────────────────────
/** Nome seguro dentro de aspas no CSS: só letras, números e espaço (a normalização de famílias já exige isso). */
const cssFamily = (f: string): string => f.replace(/[^\w ]/g, '');

export function fontFaceCss(faces: FontFaceCss[]): string {
  return faces
    .filter((f) => cssFamily(f.family).trim())
    .map((f) => {
      const weight = f.weight && WEIGHT_RE.test(f.weight) ? f.weight : '100 900';
      const style = f.style === 'italic' ? 'italic' : 'normal';
      return `@font-face{font-family:"${cssFamily(f.family)}";src:${f.src};font-weight:${weight};font-style:${style};font-display:block;}`;
    })
    .join('\n');
}

/** Data URI para render do servidor. Famílias cujo arquivo não carrega saem da lista (o slide cai na substituta). */
export async function toDataUriFaces(refs: FontFaceRef[] | undefined, load: typeof loadFontAsset = loadFontAsset): Promise<FontFaceCss[]> {
  const out: FontFaceCss[] = [];
  for (const r of refs ?? []) {
    const f = await load(r.assetId);
    if (f) {
      out.push({
        family: r.family,
        src: `url(data:${fontMime(f.format)};base64,${f.buf.toString('base64')}) format("${f.format}")`,
        ...(r.weight ? { weight: r.weight } : {}),
        ...(r.style ? { style: r.style } : {}),
      });
    }
  }
  return out;
}

/** `fontFaces` do envelope do deck, tolerando lixo (conteúdo vem do banco e do modelo). */
export function parseFontRefs(raw: unknown): FontFaceRef[] {
  if (!Array.isArray(raw)) return [];
  const out: FontFaceRef[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue;
    const { family, assetId, format, weight, style } = r as Record<string, unknown>;
    if (typeof family !== 'string' || typeof assetId !== 'string' || !/^[\w-]{8,64}$/.test(assetId)) continue;
    if (format !== 'truetype' && format !== 'opentype' && format !== 'woff' && format !== 'woff2') continue;
    out.push({
      family,
      assetId,
      format,
      ...(typeof weight === 'string' && WEIGHT_RE.test(weight) ? { weight } : {}),
      ...(style === 'italic' || style === 'normal' ? { style } : {}),
    });
  }
  return out.slice(0, MAX_FONT_REFS);
}
