import { checkApprovedText, type TextIssue } from './textCheck.js';

// Laço de correção do texto aprovado.
//
// A checagem de texto (textCheck) só apontava o erro: o deck seguia para a pessoa com o
// slide errado e uma lista do que consertar. Aqui o erro volta ao artista, com a
// instrução exata do que remover e do que restaurar, no máximo MAX_ATTEMPTS vezes por slide.
// Os desvios que sobrarem continuam sendo reportados — o laço não esconde nada.

export const MAX_ATTEMPTS = 2;

export interface CorrectableSlide {
  html: string;
  css?: string;
}

export type EditSlideFn = (slide: CorrectableSlide, instruction: string, slideIndex: number) => Promise<CorrectableSlide>;

export interface CorrectionResult {
  slides: CorrectableSlide[];
  /** Desvios que restaram depois das tentativas (vazio = texto confere). */
  remaining: TextIssue[];
  /** Posições (0-based, em `slides`) que tiveram o HTML trocado por uma versão melhor. */
  corrected: number[];
  /** Quantas rodadas de correção rodaram. */
  attempts: number;
}

const list = (words: string[]): string => words.map((w) => `"${w}"`).join(', ');
const weight = (i: TextIssue): number => i.missing.length + i.extra.length;

/** Instrução cirúrgica para um slide: o texto aprovado literal + o que sobra e o que falta. */
export function buildCorrectionInstruction(approvedText: string, issue: TextIssue): string {
  const parts = [
    'Corrija SOMENTE o texto deste slide, para que ele mostre exatamente o texto aprovado abaixo e nada além dele.',
    approvedText.trim()
      ? `Texto aprovado (literal, não troque, não resuma, não omita):\n"""${approvedText.trim()}"""`
      : 'Este slide não tem texto aprovado: ele não pode ter texto algum (só elementos gráficos e espaços de foto).',
  ];
  if (issue.extra.length > 0) {
    parts.push(
      `Remova do slide: ${list(issue.extra)}. Isso inclui nome da marca digitado como logo, numeração, legendas, rótulos, botões e frases de apoio que não estão no texto aprovado.`,
    );
  }
  if (issue.missing.length > 0) {
    parts.push(`Restaure no slide as palavras que faltam: ${list(issue.missing)}.`);
  }
  parts.push('Não mude cores, composição, fotos nem o restante. Se a remoção deixar um vazio, ajuste só o espaçamento para a composição continuar equilibrada.');
  return parts.join('\n');
}

/**
 * Confere o texto de cada slide contra o aprovado e devolve ao artista os que divergem.
 * Uma edição só é mantida se deixar o slide mais perto do texto aprovado: se piorar ou
 * falhar, o slide anterior fica.
 *
 * `approved[i]` corresponde a `slides[i]`; `indexOffset` só desloca o índice reportado
 * nos desvios (retomada depois da amostra de estilo).
 */
export async function correctTextDivergences(input: {
  approved: Array<string | undefined>;
  slides: CorrectableSlide[];
  editSlide: EditSlideFn;
  indexOffset?: number;
  maxAttempts?: number;
}): Promise<CorrectionResult> {
  const offset = input.indexOffset ?? 0;
  const max = input.maxAttempts ?? MAX_ATTEMPTS;
  const slides = input.slides.map((s) => ({ ...s }));
  const corrected = new Set<number>();
  let attempts = 0;

  const run = (): TextIssue[] => checkApprovedText(input.approved, slides.map((s) => s.html), offset);
  let issues = run();

  while (issues.length > 0 && attempts < max) {
    attempts += 1;
    for (const issue of issues) {
      const i = issue.slideIndex - offset;
      const atual = slides[i];
      if (!atual) continue;
      try {
        const novo = await input.editSlide(atual, buildCorrectionInstruction(input.approved[i] ?? '', issue), issue.slideIndex);
        if (!novo.html.trim()) continue;
        const depois = checkApprovedText([input.approved[i]], [novo.html], issue.slideIndex)[0];
        // Mantém só se melhorou (sem desvio, ou com menos palavras fora do lugar).
        if (!depois || weight(depois) < weight(issue)) {
          slides[i] = novo;
          corrected.add(i);
        }
      } catch {
        // Edição falhou: o slide anterior fica e o desvio segue sendo reportado.
      }
    }
    issues = run();
  }

  return { slides, remaining: issues, corrected: [...corrected].sort((a, b) => a - b), attempts };
}
