/**
 * O cliente da API (lib/api.ts) já devolve o conteúdo de `data`. Telas que liam `res.data` de novo
 * recebiam undefined: na Biblioteca de mídia a árvore de pastas chegava sempre vazia e a pasta criada
 * não aparecia. Aceita as duas formas, a desembrulhada e a com `{ data }`.
 */
export function desembrulhar<T>(res: T | { data: T } | null | undefined): T | undefined {
  if (res && typeof res === 'object' && !Array.isArray(res) && 'data' in res) return (res as { data: T }).data;
  return (res ?? undefined) as T | undefined;
}
