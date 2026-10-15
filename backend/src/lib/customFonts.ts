// Fonte própria da marca (arquivo .ttf/.otf/.woff/.woff2 enviado à biblioteca).
//
// O sistema só carregava Google Fonts por link. Aqui a fonte enviada vira @font-face:
//  - no render do servidor (revisor, exportação, enquadramento) entra como data URI, porque o R2 não
//    manda CORS e o Chromium recusa fonte de outra origem sem ele;
//  - no navegador entra por uma rota pública de proxy (/api/public/fonts/:assetId) que manda CORS.
// O deck guarda só a referência (`content.fontFaces`: família, assetId, formato), nunca os bytes.
import prisma from './prisma.js';

export type FontFormat = 'truetype' | 'opentype' | 'woff' | 'woff2';

export interface FontFaceRef {
  family: string;
  assetId: string;
  format: FontFormat;
}

export interface FontFaceCss {
  family: string;
  /** Valor do `src` (ex.: `url(data:font/ttf;base64,...) format("truetype")`). */
  src: string;
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

/** Referências (família + assetId + formato) já conferidas pelo conteúdo do arquivo. */
export async function resolveFontRefs(
  typography: TypographyRow[],
  brandIds: string[],
  deps: { library?: (ids: string[]) => Promise<LibraryFont[]>; load?: typeof loadFontAsset } = {},
): Promise<FontFaceRef[]> {
  if (!typography.some((t) => t.source === 'custom')) return [];
  const library = await (deps.library ?? ((ids) => prisma.asset.findMany({ where: { brandId: { in: ids } }, select: { id: true, name: true, url: true, fileType: true } })))(brandIds);
  const load = deps.load ?? loadFontAsset;
  const refs: FontFaceRef[] = [];
  for (const m of matchCustomFonts(typography, library)) {
    const f = await load(m.asset.id);
    if (f) refs.push({ family: m.family, assetId: m.asset.id, format: f.format });
  }
  return refs;
}

// ── CSS ──────────────────────────────────────────────────────────────────────────────────────────
/** Nome seguro dentro de aspas no CSS: só letras, números e espaço (a normalização de famílias já exige isso). */
const cssFamily = (f: string): string => f.replace(/[^\w ]/g, '');

export function fontFaceCss(faces: FontFaceCss[]): string {
  return faces
    .filter((f) => cssFamily(f.family).trim())
    .map((f) => `@font-face{font-family:"${cssFamily(f.family)}";src:${f.src};font-weight:100 900;font-style:normal;font-display:block;}`)
    .join('\n');
}

/** Data URI para render do servidor. Famílias cujo arquivo não carrega saem da lista (o slide cai na substituta). */
export async function toDataUriFaces(refs: FontFaceRef[] | undefined, load: typeof loadFontAsset = loadFontAsset): Promise<FontFaceCss[]> {
  const out: FontFaceCss[] = [];
  for (const r of refs ?? []) {
    const f = await load(r.assetId);
    if (f) out.push({ family: r.family, src: `url(data:${fontMime(f.format)};base64,${f.buf.toString('base64')}) format("${f.format}")` });
  }
  return out;
}

/** `fontFaces` do envelope do deck, tolerando lixo (conteúdo vem do banco e do modelo). */
export function parseFontRefs(raw: unknown): FontFaceRef[] {
  if (!Array.isArray(raw)) return [];
  const out: FontFaceRef[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue;
    const { family, assetId, format } = r as Record<string, unknown>;
    if (typeof family !== 'string' || typeof assetId !== 'string' || !/^[\w-]{8,64}$/.test(assetId)) continue;
    if (format !== 'truetype' && format !== 'opentype' && format !== 'woff' && format !== 'woff2') continue;
    out.push({ family, assetId, format });
  }
  return out.slice(0, 4);
}
