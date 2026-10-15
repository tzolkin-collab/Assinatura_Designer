/** Utilidades compartilhadas pelas ferramentas de peças (save_presentation, list_designs, get_design). */

/** Link do editor da peça no frontend (onde o usuário acompanha e edita). `null` sem origem configurada. */
export function editorUrl(origin: string | undefined, brandSlug: string, postId: string): string | null {
  if (!origin) return null;
  return `${origin.replace(/\/+$/, '')}/${encodeURIComponent(brandSlug)}/editor/${encodeURIComponent(postId)}`;
}

/** Lista curta das divergências, para o texto que o agente lê. */
export function summarizeIssues(issues: Array<{ slide: number; description: string }>): string {
  return issues
    .slice(0, 12)
    .map((i) => `- Slide ${i.slide}: ${i.description}`)
    .join('\n');
}
