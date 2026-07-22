// Detecta quais assets (oferecidos à marca ou resolvidos pelo imageResolver)
// entraram de fato no deck final — alimenta o card "Assets da marca usados" na
// Galeria (ver pipeline.ts). Função pura, extraída pra ser testável isolada do
// resto da orquestração do pipeline.

export interface HtmlDesignSlideLike {
  html?: string;
  css?: string;
}

/** Concatena html+css de todos os slides num único blob pra checagem de substring. */
export function buildSlidesHtmlBlob(slides: HtmlDesignSlideLike[]): string {
  return slides.map((s) => `${s.html ?? ''}${s.css ?? ''}`).join('\n');
}

/**
 * URLs (dos assets oferecidos ao artista) que aparecem de fato no HTML/CSS final.
 * Detecção por substring simples: o artista sempre embute a URL literal em
 * <img src="...">, então não precisa parsear o DOM pra achar isto.
 */
export function detectAssetUrlsInHtml(htmlBlob: string, offeredUrls: string[]): string[] {
  return offeredUrls.filter((url) => url.length > 0 && htmlBlob.includes(url));
}

/**
 * União das URLs detectadas no HTML final com as que o imageResolver já resolveu
 * por slide (essas não precisam de detecção — sabemos que foram usadas porque
 * foi o próprio pipeline que injetou no skeleton antes do artista rodar).
 */
export function mergeUsedAssetUrls(detectedUrls: string[], resolvedUrls: Array<string | undefined>): string[] {
  const resolved = resolvedUrls.filter((u): u is string => !!u);
  return Array.from(new Set([...detectedUrls, ...resolved]));
}
