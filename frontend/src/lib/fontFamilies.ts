// Espelho de backend/src/lib/htmlDesign.ts (normalizeFontFamilies / googleFontHrefs).
// O preview do editor monta o próprio documento, então precisa da mesma regra: se a família
// vier com a especificação de pesos ("Playfair Display:ital,wght@0,400"), só o nome vale, e
// cada família tem o seu link para uma desconhecida não derrubar as demais.

export function normalizeFontFamilies(fonts: unknown): string[] {
  if (!Array.isArray(fonts)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of fonts) {
    if (typeof f !== 'string') continue;
    const family = f.split(':')[0]!.replace(/['"]/g, '').replace(/\s+/g, ' ').trim();
    if (!family || !/^[\w ]+$/.test(family)) continue;
    const key = family.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(family);
    if (out.length === 4) break;
  }
  return out;
}

export function googleFontHrefs(fonts: unknown): string[] {
  const families = normalizeFontFamilies(fonts);
  if (families.length === 0) families.push('Inter');
  return families.map(
    (f) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@300;400;500;600;700;800;900&display=swap`,
  );
}

// ── Fonte própria da marca (arquivo enviado à biblioteca) ────────────────────────────────────────
// O deck guarda só a referência (família, assetId, formato). O arquivo vem de uma rota pública da API
// que manda CORS, porque o R2 não manda e o navegador recusa @font-face de outra origem sem ele.
export interface FontFaceRef {
  family: string;
  assetId: string;
  format: 'truetype' | 'opentype' | 'woff' | 'woff2';
}

const FORMATS = ['truetype', 'opentype', 'woff', 'woff2'];

export function parseFontRefs(raw: unknown): FontFaceRef[] {
  if (!Array.isArray(raw)) return [];
  const out: FontFaceRef[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue;
    const { family, assetId, format } = r as Record<string, unknown>;
    if (typeof family !== 'string' || typeof assetId !== 'string' || !/^[\w-]{8,64}$/.test(assetId)) continue;
    if (typeof format !== 'string' || !FORMATS.includes(format)) continue;
    out.push({ family, assetId, format: format as FontFaceRef['format'] });
  }
  return out.slice(0, 4);
}

export function fontFaceCss(refs: FontFaceRef[], apiBase: string): string {
  return refs
    .map((r) => ({ ...r, family: r.family.replace(/[^\w ]/g, '').trim() }))
    .filter((r) => r.family)
    .map((r) => `@font-face{font-family:"${r.family}";src:url("${apiBase}/public/fonts/${r.assetId}") format("${r.format}");font-weight:100 900;font-style:normal;font-display:block;}`)
    .join('\n');
}

/** Links do Google só para as famílias SEM arquivo próprio (mesmo nome de uma Google Font traria a errada). */
export function remoteFontHrefs(fonts: unknown, own: FontFaceRef[]): string[] {
  const mine = new Set(own.map((o) => o.family.trim().toLowerCase()));
  const remote = normalizeFontFamilies(fonts).filter((f) => !mine.has(f.toLowerCase()));
  if (remote.length === 0 && mine.size > 0) return [];
  return googleFontHrefs(remote.length > 0 ? remote : fonts);
}
