import type { TextBlock, TextStatus } from './types.js';

// §4.1 — o que cada status permite. Fica em código (não só no prompt) para que texto
// proibido NUNCA chegue ao modelo: o que não é enviado não pode vazar para a arte.

/** Status cujo texto orienta o raciocínio, mas jamais vira texto visível. */
const GUIDANCE_ONLY: ReadonlySet<TextStatus> = new Set(['support', 'speech', 'context']);

/** Status cujo texto não é enviado ao modelo de jeito nenhum. */
const WITHHELD: ReadonlySet<TextStatus> = new Set(['internal', 'do-not-show']);

export function isWithheld(status: TextStatus): boolean {
  return WITHHELD.has(status);
}

/**
 * Uma peça só pode ser chamada de final se não houver texto "em revisão" (§4.1).
 * Quem chama decide o que fazer; esta função só responde.
 */
export function canBeFinal(blocks: TextBlock[]): boolean {
  return !blocks.some((b) => b.status === 'in-review');
}

function line(block: TextBlock): string {
  return block.label ? `[${block.label}]\n${block.text}` : block.text;
}

/**
 * Monta a parte do briefing com o texto, separada por status.
 * - aprovado: literal;
 * - em revisão: diagramar como rascunho, sem chamar de final;
 * - apoio/fala/contexto: orientação, nunca texto visível;
 * - interno/não exibir: omitido por completo.
 */
export function renderTextBlocks(blocks: TextBlock[]): string {
  const approved = blocks.filter((b) => b.status === 'approved');
  const review = blocks.filter((b) => b.status === 'in-review');
  const guidance = blocks.filter((b) => GUIDANCE_ONLY.has(b.status));

  const parts: string[] = [];

  if (approved.length > 0) {
    parts.push(
      `TEXTO APROVADO — reproduzir literalmente; pode aparecer:\n${approved.map(line).join('\n\n')}`,
    );
  }
  if (review.length > 0) {
    parts.push(
      `TEXTO EM REVISÃO — pode ser diagramado como rascunho, mas a peça não pode ser chamada de final:\n${review.map(line).join('\n\n')}`,
    );
  }
  if (guidance.length > 0) {
    parts.push(
      `ORIENTAÇÃO (apoio, fala e contexto) — serve para organizar e raciocinar; NÃO é texto da peça e não pode aparecer na arte:\n${guidance.map(line).join('\n\n')}`,
    );
  }
  return parts.join('\n\n');
}
