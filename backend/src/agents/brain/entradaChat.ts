// Funções puras da porta de entrada da Fábrica (detecção da copy colada e limpeza da resposta).
// Ficam fora do index do brain para serem testadas sem subir Redis, banco nem IA.

/** Mensagem avulsa só vira "copy" se for claramente um texto colado, não um pedido. */
export const LONG_MESSAGE_CHARS = 1200;
/** Total mínimo para ativar o fluxo copy-first (roteiro + pausa de aprovação). */
export const COPY_MIN_CHARS = 500;

/**
 * Uma mensagem é "copy colada" quando é longa, ou quando é estruturada (3+ blocos separados por
 * linha em branco, algo como título + texto por slide) e passa do mínimo da copy. Só o limite de
 * 1200 caracteres deixava de fora um briefing de 5 slides com ~1.000 caracteres: o assistente o
 * chamava de "texto aprovado" e o pipeline recusava gerar por não achar copy (visto em teste real).
 */
export function isPastedCopy(content: string): boolean {
  if (content.length >= LONG_MESSAGE_CHARS) return true;
  if (content.length < COPY_MIN_CHARS) return false;
  const blocos = content.split(/\r?\n\s*\r?\n/).filter((b) => b.trim().length > 0);
  return blocos.length >= 3;
}

/**
 * Sobra de tag mal formada: depois de remover QUESTION/EDIT/DISPATCH, uma linha só com `}]`, `}}`
 * ou `]` ficava no chat (visto em teste real: "Já estou gerando." seguido de `}]`). Linha só de
 * pontuação de fechamento nunca é texto para a pessoa.
 */
export function dropStrayTagFragments(content: string): string {
  return content
    .split('\n')
    .filter((linha) => !/^\s*[\]}[{]+\s*$/.test(linha))
    .join('\n')
    .trimEnd();
}
