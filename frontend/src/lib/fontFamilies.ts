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
