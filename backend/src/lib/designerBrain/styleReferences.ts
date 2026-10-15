import prisma from '../prisma.js';
import { logger } from '../logger.js';
import type { BrandProfileData } from '../brandProfile.js';

/**
 * Imagens de referência que o artista precisa VER (Cérebro de IA §4: "imagem do manual visual: referência
 * visual principal"): o manual visual da ficha, o moodboard do projeto e a referência das fontes. Antes só
 * os moodboards anexados no chat chegavam ao modelo como imagem; o manual da ficha era só um rótulo no texto.
 *
 * Só entram arquivos que estão na biblioteca do projeto (e da base, num desdobramento): a URL da ficha vem
 * de um cadastro, e o servidor vai baixá-la, então ela é conferida contra a biblioteca antes de virar fetch.
 */
export interface StyleReference {
  url: string;
  name: string;
  role: 'style-reference';
}

export async function profileStyleReferences(
  profile: BrandProfileData | null,
  libraryBrandIds: string[],
): Promise<StyleReference[]> {
  if (!profile || libraryBrandIds.length === 0) return [];
  const manualUrl = profile.visualManual?.imageUrl;
  const fontUrls = (profile.typography ?? []).map((t) => t.referenceImageUrl).filter((u): u is string => Boolean(u));
  const wanted = [...new Set([manualUrl, ...fontUrls].filter((u): u is string => Boolean(u)))];
  try {
    const [byUrl, moodboards] = await Promise.all([
      wanted.length
        ? prisma.asset.findMany({ where: { brandId: { in: libraryBrandIds }, url: { in: wanted } }, select: { url: true, name: true } })
        : Promise.resolve([] as Array<{ url: string; name: string }>),
      prisma.asset.findMany({
        where: { brandId: { in: libraryBrandIds }, tags: { has: 'moodboard' } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { url: true, name: true },
      }),
    ]);
    const nameOf = new Map(byUrl.map((a) => [a.url, a.name]));
    // Ordem de importância: manual visual, moodboard (a linguagem das peças), referência das fontes.
    const ordered = [
      manualUrl && nameOf.has(manualUrl) ? { url: manualUrl, name: nameOf.get(manualUrl)! } : null,
      ...moodboards,
      ...fontUrls.filter((u) => nameOf.has(u)).map((u) => ({ url: u, name: nameOf.get(u)! })),
    ].filter((r): r is { url: string; name: string } => r !== null);
    const seen = new Set<string>();
    return ordered
      .filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)))
      .map((r) => ({ ...r, role: 'style-reference' as const }));
  } catch (err) {
    logger.warn('Não foi possível carregar as referências visuais da ficha: a geração segue sem elas', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
