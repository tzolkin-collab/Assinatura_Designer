// Porta de "final" (Cérebro de IA §2, §4.1 e §13 passo 8).
//
// O manual pede duas coisas: (1) o que não está resolvido vira PENDÊNCIA OBJETIVA, dita à pessoa;
// (2) uma peça com texto em revisão não pode ser chamada de final. O Post não tem um estado "final"
// no banco, então o resultado fica em `content.finalGate`, gravado pelo servidor na geração.
// Publicar e exportar são os pontos em que a peça sai do Designer como entrega e conferem a porta.

export interface FinalGate {
  /** Motivos que impedem a peça de ser tratada como final. */
  blocking: string[];
  /** Pendências que a pessoa precisa saber, mas que não impedem a entrega. */
  notes: string[];
}

export interface FinalGateInput {
  /** Há bloco de texto marcado como "em revisão". */
  hasInReview: boolean;
  /** Quantidade fechada no briefing, quando houver. */
  requestedCount?: number;
  /** Quantos slides saíram. */
  generatedCount: number;
  /** Aviso de fonte oficial indisponível (texto já pronto), quando houver. */
  fontNotice?: string | null;
  /** Pendências do cérebro (§13): informação obrigatória que faltou no cadastro. */
  brainPending?: string[];
  /** Slides onde o texto não coube com folga (1-based). */
  overflowSlides?: number[];
  /** Aviso pronto de overflow/estouro de texto (alternativa a overflowSlides). */
  overflowNotice?: string | null;
}

/** Formata a nota de decisão editorial quando o texto não coube com folga (§3.1 item 6, §7.1). */
export function formatOverflowNotice(slideNumbers: number[]): string {
  const slides = [...new Set(slideNumbers)].sort((a, b) => a - b);
  if (slides.length === 0) return '';
  const onde = slides.length === 1 ? `no slide ${slides[0]}` : `nos slides ${slides.join(', ')}`;
  return `O texto não coube com folga ${onde}: decida se prefere cortar trechos, dividir em mais slides ou diminuir o texto.`;
}

/** Extrai os índices de slide (1-based) com estouro a partir dos desvios do revisor. */
export function extractOverflowSlides(
  deviations?: Array<{ type?: string; description?: string; slideIndex: number }>,
): number[] {
  if (!deviations || deviations.length === 0) return [];
  const matches = deviations.filter(
    (d) => d.type === 'overflow' || /overflow|estouro|comprimido|não coube|nao coube|cortad[oa]/i.test(d.description ?? ''),
  );
  return [...new Set(matches.map((d) => d.slideIndex + 1))].sort((a, b) => a - b);
}

export function computeFinalGate(input: FinalGateInput): FinalGate {
  const blocking: string[] = [];
  const notes: string[] = [];

  if (input.hasInReview) {
    blocking.push('Há texto marcado como "em revisão": a peça está como rascunho até o texto ser aprovado.');
  }
  if (input.requestedCount !== undefined && input.requestedCount !== input.generatedCount) {
    // Só nota: a contagem vem de uma leitura do briefing e pode errar; barrar a entrega por ela seria injusto.
    notes.push(`A quantidade pedida era ${input.requestedCount} e saíram ${input.generatedCount} slides: confira.`);
  }
  for (const p of input.brainPending ?? []) notes.push(`Falta definir: ${p}.`);
  if (input.fontNotice) notes.push(input.fontNotice.replace(/\*\*/g, ''));
  if (input.overflowSlides && input.overflowSlides.length > 0) {
    notes.push(formatOverflowNotice(input.overflowSlides));
  } else if (input.overflowNotice) {
    notes.push(input.overflowNotice);
  }

  return { blocking, notes };
}

/** Lê `content.finalGate` com tolerância: conteúdo antigo ou adulterado vira "sem porta". */
export function readFinalGate(content: unknown): FinalGate | null {
  if (typeof content !== 'object' || content === null || Array.isArray(content)) return null;
  const raw = (content as { finalGate?: unknown }).finalGate;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const gate = raw as { blocking?: unknown; notes?: unknown };
  const blocking = strings(gate.blocking);
  const notes = strings(gate.notes);
  return blocking.length === 0 && notes.length === 0 ? null : { blocking, notes };
}

/** A peça pode sair como entrega? Sem porta gravada (peça antiga, outra marca), pode. */
export function canBeDelivered(content: unknown): boolean {
  return (readFinalGate(content)?.blocking.length ?? 0) === 0;
}

/**
 * `content.finalGate` é do servidor, como `content.mcp`: o editor regrava o `content` inteiro em
 * `PUT /posts/:id`, e sem este filtro um cliente apagaria a trava só ao salvar.
 */
export function withServerOwnedFinalGate<T>(incoming: T, stored: unknown): T {
  if (typeof incoming !== 'object' || incoming === null || Array.isArray(incoming)) return incoming;
  const server =
    typeof stored === 'object' && stored !== null && !Array.isArray(stored)
      ? (stored as { finalGate?: unknown }).finalGate
      : undefined;
  const { finalGate: _client, ...rest } = incoming as Record<string, unknown>;
  return (server === undefined ? rest : { ...rest, finalGate: server }) as T;
}

/** Mensagem acionável para a recusa de publicar/exportar. */
export function draftRefusal(gate: FinalGate, action: string): string {
  return `Não dá para ${action} como final: ${gate.blocking.join(' ')} Resolva isso ou confirme que é um rascunho (confirmarRascunho).`;
}
