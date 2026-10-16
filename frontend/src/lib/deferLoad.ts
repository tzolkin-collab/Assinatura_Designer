/**
 * Adia uma leitura de dados para fora do corpo do efeito (evita setState síncrono em cascata)
 * sem depender de `requestAnimationFrame`.
 *
 * rAF não dispara enquanto a aba não é pintada (segundo plano, janela minimizada): a requisição
 * nem sai e a tela fica em "Carregando…" até a aba voltar ao foco. `setTimeout(…, 0)` roda sempre.
 * Devolve o cancelamento, para usar direto como retorno do `useEffect`.
 */
export function deferLoad(fn: () => void): () => void {
  const id = setTimeout(fn, 0);
  return () => clearTimeout(id);
}
