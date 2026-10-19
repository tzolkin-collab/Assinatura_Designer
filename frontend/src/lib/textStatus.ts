// Status por bloco de texto (Cérebro de IA §4.1) na tela. O contrato é o do backend
// (`backend/src/lib/designerBrain/copyBlocks.ts`): a pessoa marca o bloco numa linha própria, como
// `[FALA]`, e o bloco vai até a próxima marca. Texto sem marca vale como aprovado. Aqui só se ajuda a
// ESCREVER a marca e a mostrar o que ela faz; quem decide o que entra na arte é o backend.

export type TextStatusTag = 'APROVADO' | 'EM REVISÃO' | 'APOIO' | 'FALA' | 'CONTEXTO' | 'INTERNO' | 'NÃO EXIBIR';

export interface TextStatusOption {
  tag: TextStatusTag;
  label: string;
  /** O que acontece com o bloco, em palavras. */
  hint: string;
  /** Vira texto da peça? */
  visible: boolean;
}

export const TEXT_STATUS_OPTIONS: readonly TextStatusOption[] = [
  { tag: 'APROVADO', label: 'Aprovado', hint: 'Aparece na arte, palavra por palavra.', visible: true },
  { tag: 'EM REVISÃO', label: 'Em revisão', hint: 'Entra como rascunho; a peça não pode ser dada como final.', visible: true },
  { tag: 'APOIO', label: 'Apoio', hint: 'Orienta a IA, mas nunca aparece na arte.', visible: false },
  { tag: 'FALA', label: 'Fala', hint: 'Roteiro para gravar ou dizer; não vira texto da peça.', visible: false },
  { tag: 'CONTEXTO', label: 'Contexto', hint: 'Explica o cenário para a IA; não aparece na arte.', visible: false },
  { tag: 'INTERNO', label: 'Interno', hint: 'Nem é enviado à IA.', visible: false },
  { tag: 'NÃO EXIBIR', label: 'Não exibir', hint: 'Nem é enviado à IA.', visible: false },
];

const MARKERS: Array<{ re: RegExp; tag: TextStatusTag }> = [
  { re: /^aprovado$/i, tag: 'APROVADO' },
  { re: /^em revis[aã]o$/i, tag: 'EM REVISÃO' },
  { re: /^apoio$/i, tag: 'APOIO' },
  { re: /^fala$/i, tag: 'FALA' },
  { re: /^contexto$/i, tag: 'CONTEXTO' },
  { re: /^interno$/i, tag: 'INTERNO' },
  { re: /^n[aã]o (?:exibir|mostrar)$/i, tag: 'NÃO EXIBIR' },
];

// Igual à do backend: a marca é a linha inteira, com texto opcional depois dela.
const MARKER_LINE = /^\s*\[([^\]\n]{2,20})\]\s*:?\s*(.*)$/;

function tagOf(raw: string): TextStatusTag | null {
  const t = raw.trim();
  return MARKERS.find((m) => m.re.test(t))?.tag ?? null;
}

export interface StatusSummary {
  /** Há ao menos uma marca reconhecida. */
  hasMarkers: boolean;
  /** Blocos por status (só os que têm texto). */
  counts: Partial<Record<TextStatusTag, number>>;
  /** Blocos que ficam fora da arte (apoio, fala, contexto, interno, não exibir). */
  outOfArt: number;
  /** Há texto em revisão. */
  inReview: boolean;
}

/** Conta os blocos por status do mesmo jeito que o backend os separa. */
export function summarizeStatuses(source: string): StatusSummary {
  const counts: Partial<Record<TextStatusTag, number>> = {};
  let current: { tag: TextStatusTag; lines: string[] } | null = null;
  let hasMarkers = false;

  const flush = () => {
    if (current && current.lines.join('\n').trim()) counts[current.tag] = (counts[current.tag] ?? 0) + 1;
    current = null;
  };

  for (const raw of source.split(/\r?\n/)) {
    const m = MARKER_LINE.exec(raw);
    const tag = m ? tagOf(m[1]!) : null;
    if (m && tag) {
      hasMarkers = true;
      flush();
      current = { tag, lines: m[2] ? [m[2]] : [] };
    } else {
      current ??= { tag: 'APROVADO', lines: [] };
      current.lines.push(raw);
    }
  }
  flush();

  const outOfArt = (['APOIO', 'FALA', 'CONTEXTO', 'INTERNO', 'NÃO EXIBIR'] as const).reduce((n, t) => n + (counts[t] ?? 0), 0);
  return { hasMarkers, counts, outOfArt, inReview: (counts['EM REVISÃO'] ?? 0) > 0 };
}

export interface InsertResult {
  text: string;
  /** Posição do cursor depois da inserção. */
  caret: number;
}

/**
 * Põe a marca numa linha própria. Com texto selecionado, marca só a seleção: o que vem depois dela volta a
 * ser aprovado (senão herdaria o status, já que o bloco vai até a próxima marca).
 */
export function insertStatusMarker(text: string, start: number, end: number, tag: TextStatusTag): InsertResult {
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  const before = text.slice(0, s);
  const selected = text.slice(s, e);
  const after = text.slice(e);

  const lead = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
  const marker = `[${tag}]\n`;

  if (!selected) {
    const out = `${before}${lead}${marker}${after}`;
    return { text: out, caret: before.length + lead.length + marker.length };
  }

  // O que vem depois só precisa de "aprovado" se não abrir com outra marca (aí já tem o próprio status).
  const nextLine = after.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  const nextIsMarker = (() => {
    const m = MARKER_LINE.exec(nextLine);
    return Boolean(m && tagOf(m[1]!));
  })();
  const restoresApproved = tag !== 'APROVADO' && after.trim().length > 0 && !nextIsMarker;
  const tail = restoresApproved ? `${selected.endsWith('\n') ? '' : '\n'}[APROVADO]\n${after.replace(/^\n/, '')}` : after;
  const out = `${before}${lead}${marker}${selected}${tail}`;
  return { text: out, caret: before.length + lead.length + marker.length + selected.length };
}
