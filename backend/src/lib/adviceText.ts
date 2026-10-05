// Texto que as orientações do usuário injetam nos prompts. Módulo PURO (sem import)
// de propósito: o htmlDesign.ts e os testes de prompt o usam sem arrastar
// WebSocket/Redis, que é exatamente o acoplamento que o callback getPendingAdvice evita.

const MAX_ADVICE_IN_PROMPT = 1000;

/** Uma linha de orientação por item, com corte de segurança para não inflar o prompt. */
export function adviceLines(texts: string[]): string[] {
  return texts
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((t) => `- ${t.length > MAX_ADVICE_IN_PROMPT ? `${t.slice(0, MAX_ADVICE_IN_PROMPT)}…` : t}`);
}

/** Bloco para o systemInstruction do cérebro. Vazio quando não há orientação. */
export function brainAdviceBlock(texts: string[]): string {
  const lines = adviceLines(texts);
  if (lines.length === 0) return '';
  return [
    '## Orientações do usuário durante esta resposta',
    'O usuário acrescentou o que segue ENQUANTO você trabalhava. São instruções dele, dadas em tempo real: leve-as em conta agora, mesmo que mudem o rumo da resposta.',
    ...lines,
  ].join('\n');
}

/** Bloco para o prompt de um lote de slides (ou do revisor). Vazio sem orientação. */
export function pipelineAdviceBlock(texts: string[]): string {
  const lines = adviceLines(texts);
  if (lines.length === 0) return '';
  return [
    'ORIENTAÇÕES DO USUÁRIO DADAS COM O DECK JÁ EM ANDAMENTO (valem para ESTE lote e os seguintes; quando conflitarem com o briefing ou com a direção de arte acima, o que o usuário pediu aqui PREVALECE; não refaça slides anteriores por causa delas):',
    ...lines,
  ].join('\n');
}
