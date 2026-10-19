// Briefing da peça (Cérebro de IA §4 e §12): o status do texto é o CAMPO em que ele foi escrito, não uma
// marca digitada no meio dele. Os três campos viram o texto que o backend já sabe ler
// (`backend/src/lib/designerBrain/copyBlocks.ts`), então a pessoa nunca vê nem escreve `[FALA]` e afins.

export interface Briefing {
  /** TEXTO APROVADO POR SLIDE: vira texto da arte, palavra por palavra. */
  approved: string;
  /** FALA / CONTEXTO NÃO VISÍVEL: orienta a IA, nunca aparece na arte. */
  context: string;
  /** INFORMAÇÕES INTERNAS OU PROIBIDAS: nem é enviado à IA como orientação. */
  internal: string;
}

export const EMPTY_BRIEFING: Briefing = { approved: '', context: '', internal: '' };

export function isBriefingEmpty(b: Briefing): boolean {
  return !b.approved.trim() && !b.context.trim() && !b.internal.trim();
}

/** Conta os campos preenchidos, para o resumo do painel. */
export function filledFields(b: Briefing): number {
  return [b.approved, b.context, b.internal].filter((v) => v.trim()).length;
}

// Um texto digitado dentro de um campo não pode abrir uma marca por conta própria: senão "[INTERNO]" colado
// no campo de texto aprovado mudaria o status do bloco. A linha que abre com colchetes perde os colchetes.
function neutralize(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^(\s*)\[([^\]\n]{2,20})\]/, '$1($2)'))
    .join('\n')
    .trim();
}

/**
 * Junta a mensagem do chat e os campos do briefing no texto que o backend lê.
 * Sem briefing preenchido, devolve a mensagem intacta. Com briefing, a mensagem do chat vira APOIO
 * (instrução para a IA): sem marca ela valeria como texto aprovado e iria parar na arte.
 */
export function composeBriefing(message: string, b: Briefing): string {
  if (isBriefingEmpty(b)) return message;
  const parts: string[] = [];
  if (message.trim()) parts.push(`[APOIO]\n${neutralize(message)}`);
  if (b.approved.trim()) parts.push(`[APROVADO]\n${neutralize(b.approved)}`);
  if (b.context.trim()) parts.push(`[CONTEXTO]\n${neutralize(b.context)}`);
  if (b.internal.trim()) parts.push(`[INTERNO]\n${neutralize(b.internal)}`);
  return parts.join('\n\n');
}
