import { PROJECT_OFFICIAL_FONTS } from './seeds/index.js';

// Aviso de fonte oficial indisponível (achado S5).
//
// A tipografia oficial do projeto (ex.: Queens e Aeonik, da Amanda) é comercial: o sistema só
// carrega Google Fonts e ainda não tem upload de arquivo de fonte. Então o artista usa uma
// substituta, e isso acontecia em silêncio — a pessoa só descobria olhando a arte. Agora o
// resultado diz qual fonte oficial faltou e qual foi usada no lugar.

/**
 * Fontes oficiais que o sistema consegue carregar além das Google Fonts (arquivos enviados).
 * Vazio hoje: não existe upload de fonte. Quando existir, os nomes enviados entram aqui (ou
 * vêm do banco) e o aviso some sozinho para quem tem a fonte.
 */
export const INSTALLED_CUSTOM_FONTS: string[] = [];

const norm = (s: string): string => s.trim().toLowerCase().replace(/['"]/g, '');
const lista = (xs: string[]): string => xs.join(', ');

export function officialFontsFor(brandSlug: string): string[] {
  return PROJECT_OFFICIAL_FONTS[brandSlug] ?? [];
}

/**
 * Texto do aviso, ou `null` quando todas as fontes oficiais estão disponíveis (ou não há fonte
 * oficial cadastrada). `used` são as famílias que a arte de fato usou.
 */
export function fontSubstitutionNotice(input: {
  official: string[];
  used: string[];
  installed?: string[];
}): string | null {
  const instaladas = new Set((input.installed ?? INSTALLED_CUSTOM_FONTS).map(norm));
  const faltam = input.official.filter((f) => !instaladas.has(norm(f)));
  if (faltam.length === 0) return null;
  const oficiais = new Set(input.official.map(norm));
  const usadas = input.used.filter((f) => f.trim() && !oficiais.has(norm(f)));
  const no_lugar = usadas.length > 0 ? ` A arte usa ${lista(usadas)} no lugar.` : '';
  return `**Aviso de fonte:** a tipografia oficial do projeto (${lista(faltam)}) ainda não está instalada no sistema.${no_lugar} Para usar a oficial, é preciso enviar os arquivos da fonte.`;
}
