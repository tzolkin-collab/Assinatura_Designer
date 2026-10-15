import { isWithheld } from './textStatus.js';
import type { TextBlock, TextStatus } from './types.js';

// Status por bloco de texto (Cérebro de IA §4.1), a partir do texto que a pessoa envia.
//
// Quem envia o texto marca o bloco numa linha própria:
//   [APROVADO] [EM REVISÃO] [APOIO] [FALA] [CONTEXTO] [INTERNO] [NÃO EXIBIR]
// e o bloco vai até a próxima marca. Texto sem nenhuma marca continua valendo como aprovado, como
// sempre foi: quem não usa marcas não percebe mudança nenhuma (o texto passa byte a byte).
//
// O que não é aprovado não chega ao artista como texto da peça: fala, contexto e apoio viram
// orientação; interno e "não exibir" nem são enviados.

const MARKERS: Array<{ re: RegExp; status: TextStatus }> = [
  { re: /^aprovado$/i, status: 'approved' },
  { re: /^em revis[aã]o$/i, status: 'in-review' },
  { re: /^apoio$/i, status: 'support' },
  { re: /^fala$/i, status: 'speech' },
  { re: /^contexto$/i, status: 'context' },
  { re: /^interno$/i, status: 'internal' },
  { re: /^n[aã]o (?:exibir|mostrar)$/i, status: 'do-not-show' },
];

const MARKER_LINE = /^\s*\[([^\]\n]{2,20})\]\s*:?\s*(.*)$/;

function statusOf(tag: string): TextStatus | null {
  const t = tag.trim();
  return MARKERS.find((m) => m.re.test(t))?.status ?? null;
}

export interface ParsedCopy {
  /** Havia ao menos uma marca de status no texto. */
  hasMarkers: boolean;
  blocks: TextBlock[];
  /** O texto que vira slide: aprovado e em revisão (este como rascunho). Sem marcas, o original intacto. */
  copyForSlides: string;
  /** Há texto em revisão: a peça não pode ser chamada de final. */
  hasInReview: boolean;
  /** Quantos blocos de cada status foram deixados de fora da arte (orientação ou omitidos). */
  excluded: { guidance: number; withheld: number };
}

export function parseCopyBlocks(source: string | undefined): ParsedCopy {
  const original = source ?? '';
  const lines = original.split(/\r?\n/);
  const blocks: TextBlock[] = [];
  let current: { status: TextStatus; lines: string[] } | null = null;
  let hasMarkers = false;

  const flush = () => {
    if (!current) return;
    const text = current.lines.join('\n').trim();
    if (text) blocks.push({ status: current.status, text });
    current = null;
  };

  for (const raw of lines) {
    const m = MARKER_LINE.exec(raw);
    const status = m ? statusOf(m[1]!) : null;
    if (m && status) {
      hasMarkers = true;
      flush();
      current = { status, lines: m[2] ? [m[2]] : [] };
    } else {
      current ??= { status: 'approved', lines: [] };
      current.lines.push(raw);
    }
  }
  flush();

  if (!hasMarkers) {
    return {
      hasMarkers: false,
      blocks: original.trim() ? [{ status: 'approved', text: original.trim() }] : [],
      copyForSlides: original,
      hasInReview: false,
      excluded: { guidance: 0, withheld: 0 },
    };
  }

  const forSlides = blocks.filter((b) => b.status === 'approved' || b.status === 'in-review');
  return {
    hasMarkers: true,
    blocks,
    copyForSlides: forSlides.map((b) => b.text).join('\n\n'),
    hasInReview: blocks.some((b) => b.status === 'in-review'),
    excluded: {
      guidance: blocks.filter((b) => b.status === 'support' || b.status === 'speech' || b.status === 'context').length,
      withheld: blocks.filter((b) => isWithheld(b.status)).length,
    },
  };
}
