/**
 * Caminho da lista de posts de uma marca. `view: 'gallery'` pede a lista leve (capa + contagem de
 * slides, sem chatHistory nem os demais slides); sem ele a lista é completa, como o Editor precisa.
 */
export type BrandPostsView = 'gallery';

export function brandPostsPath(slug: string, view?: BrandPostsView): string {
  return `/brands/${slug}/posts${view === 'gallery' ? '?view=gallery' : ''}`;
}
