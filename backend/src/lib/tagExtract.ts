/**
 * Extrator de tags de controle do brain, no formato `[TAG:{...json...}]`.
 *
 * Por que isto existe: a detecção usava a regex `\[TAG:\s*(\{[\s\S]*?\})\s*\]`, que
 * nasceu quebrada — o quantificador lazy para no PRIMEIRO `}` seguido de `]`, então
 * qualquer JSON aninhado (as opções-objeto do [QUESTION], o payload documentado do
 * [EDIT]) era truncado e o JSON.parse sempre falhava. Aqui a varredura conta chaves
 * de verdade, respeitando strings entre aspas e escapes: `}` e `]` dentro de uma
 * string não interferem na contagem.
 */

export interface ExtractedTag {
  /** O JSON interno, sem os colchetes da tag (pronto para JSON.parse). */
  json: string;
  /** Índice do `[` que abre a tag no texto original. */
  start: number;
  /** Índice logo após o `]` que fecha a tag (span total = [start, end)). */
  end: number;
}

/**
 * Acha a PRIMEIRA ocorrência de `[TAG:{...}]` (case-insensitive) e devolve o JSON
 * balanceado dela. Retorna null se a tag não existir, se o conteúdo não começar com
 * `{`, se as chaves nunca fecharem ou se faltar o `]` final — tag malformada não é
 * "meio casamento", é não-casamento.
 */
export function extractBracketedJson(text: string, tag: string): ExtractedTag | null {
  const needle = `[${tag.toLowerCase()}:`;
  const start = text.toLowerCase().indexOf(needle);
  if (start === -1) return null;

  let i = start + needle.length;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  if (text[i] !== '{') return null;

  const jsonStart = i;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        const jsonEnd = i + 1;
        // Entre o `}` final e o `]` só whitespace é aceito — qualquer outra coisa
        // significa que isto não era uma tag de controle, era texto com chaves.
        let j = jsonEnd;
        while (j < text.length && /\s/.test(text[j]!)) j++;
        if (text[j] !== ']') return null;
        return { json: text.slice(jsonStart, jsonEnd), start, end: j + 1 };
      }
    }
  }

  return null; // as chaves nunca balancearam até o fim do texto
}

/**
 * Remove TODAS as ocorrências de `[TAG:{...}]` (case-insensitive) e, SOMENTE se ao
 * menos uma tag foi removida, colapsa o whitespace sobrante (espaços duplos deixados
 * pela remoção, 3+ quebras de linha), com trim no final. Se nenhuma tag foi
 * encontrada, o texto original é devolvido intacto — normalizar whitespace de texto
 * que não continha tag alteraria conteúdo do usuário sem necessidade. Tags
 * malformadas (sem fechamento) são preservadas: remover texto que não conseguimos
 * interpretar seria esconder conteúdo do usuário.
 */
export function stripBracketedJson(text: string, tag: string): string {
  let result = text;
  let removed = false;
  // Um extrator de cada vez: cada remoção encurta o texto, então o loop sempre
  // termina — e cobre múltiplas tags na mesma resposta.
  for (;;) {
    const found = extractBracketedJson(result, tag);
    if (!found) break;
    result = result.slice(0, found.start) + result.slice(found.end);
    removed = true;
  }
  if (!removed) return text;
  return result
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Deviations do reviewer → edits do [EDIT] ──────────────────────────────────

/**
 * Espelho estrutural do `ReviewDeviation` do reviewer: este módulo é lib pura e
 * não pode importar dos agents (senão o extrator deixava de ser testável isolado).
 */
export interface DeviationLike {
  slideIndex: number;
  fix?: string;
  description?: string;
  severity?: string;
}

export interface ReviewEdit {
  index: number;
  instruction: string;
}

const SEVERITY_RANK: Record<string, number> = { critical: 3, major: 2, minor: 1 };

function severityRank(severity: string | undefined): number {
  return SEVERITY_RANK[(severity ?? '').toLowerCase()] ?? 0;
}

/** Teto de edits por decline: edição cirúrgica de mais slides que isto já é regeneração disfarçada. */
const MAX_REVIEW_EDITS = 8;

/**
 * Converte as deviations do último review no payload de um [EDIT] cirúrgico:
 *
 * - descarta índices fora de [0, totalSlides) (o reviewer alucina índice às vezes);
 * - dedupe por slideIndex: vence a ocorrência de MAIOR severidade (critical > major
 *   > minor > ausente) — é a que carrega o melhor diagnóstico daquele slide;
 * - instruction = fix ?? description, com o motivo do usuário anexado como
 *   ` (Contexto do usuário: ...)` quando presente — a recusa manual costuma dizer
 *   O QUE incomodou e isso não pode se perder na tradução;
 * - ordena por severidade (maior primeiro, desempate por índice) e corta no teto
 *   de 8: se passou disso, os piores slides vão primeiro.
 */
export function mapDeviationsToEdits(
  deviations: DeviationLike[],
  reason: string | undefined,
  totalSlides: number,
): ReviewEdit[] {
  const contexto = reason?.trim() ? ` (Contexto do usuário: ${reason.trim()})` : '';

  const porSlide = new Map<number, DeviationLike>();
  for (const d of deviations) {
    const idx = d?.slideIndex;
    if (typeof idx !== 'number' || !Number.isInteger(idx)) continue;
    if (idx < 0 || idx >= totalSlides) continue;
    const atual = porSlide.get(idx);
    if (!atual || severityRank(d.severity) > severityRank(atual.severity)) {
      porSlide.set(idx, d);
    }
  }

  return [...porSlide.values()]
    .map((d) => {
      const base = d.fix?.trim() || d.description?.trim() || '';
      return base ? { index: d.slideIndex, instruction: `${base}${contexto}`, rank: severityRank(d.severity) } : null;
    })
    .filter((e): e is ReviewEdit & { rank: number } => e !== null)
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .slice(0, MAX_REVIEW_EDITS)
    .map(({ index, instruction }) => ({ index, instruction }));
}
