import { JSDOM } from 'jsdom';

// Checagem do texto aprovado contra o que o slide realmente mostra.
//
// A regra do documento é "preservar literalmente o texto aprovado; quebra de linha e
// hierarquia podem mudar, o conteúdo não". Até aqui isso dependia só de o modelo obedecer
// ao prompt — e quando não há texto aprovado ele inventa (visto em geração real). Esta
// checagem é código, não prompt: compara as palavras do texto aprovado com as do slide.
//
// Por que por palavras e não por trecho: o artista pode quebrar um título em três elementos
// e embaralhar a ordem visual (grande, pequeno, grande). Exigir o trecho contíguo daria falso
// alarme; exigir que TODAS as palavras apareçam, na quantidade certa, não.

export interface TextIssue {
  slideIndex: number;
  /** Palavras do texto aprovado que não aparecem no slide (na quantidade certa). */
  missing: string[];
  /** Palavras no slide que não estão no texto aprovado. */
  extra: string[];
}

// Letras, números, $ e %; mantém "1.500,00" inteiro como um só item.
const TOKEN = /[\p{L}\p{N}$%]+(?:[.,]\p{N}+)*/gu;

/** Texto visível do HTML do slide: sem <style>, <script> e <title> de SVG. */
export function visibleText(html: string): string {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  const body = dom.window.document.body;
  for (const el of Array.from(body.querySelectorAll('style, script, title, noscript'))) el.remove();
  // Cada nó de texto entra separado por espaço: `textContent` cola o texto de elementos
  // vizinhos ("Estratégia" + "para" → "Estratégiapara") e geraria falso alarme.
  const walker = dom.window.document.createTreeWalker(body, dom.window.NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.nodeValue ?? '');
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Itens comparáveis: minúsculas e normalizados (acentos contam; maiúscula/minúscula não). */
export function tokenize(text: string): string[] {
  return (text.normalize('NFC').toLowerCase().match(TOKEN) ?? []);
}

function counts(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/** O que sobra em `a` depois de descontar `b`, como lista (respeita repetição). */
function subtract(a: string[], b: string[]): string[] {
  const left = counts(b);
  const out: string[] = [];
  for (const t of a) {
    const n = left.get(t) ?? 0;
    if (n > 0) left.set(t, n - 1);
    else out.push(t);
  }
  return out;
}

const unique = (xs: string[]): string[] => [...new Set(xs)];

/**
 * Compara, slide a slide, o texto aprovado com o texto do slide.
 * `approved[i]` é o texto aprovado do slide i (vazio/undefined = esse slide não tem texto
 * aprovado, então qualquer texto nele é texto a mais). Devolve só os slides com problema.
 * `indexOffset` desloca o índice reportado (retomada depois da amostra de estilo).
 */
export function checkApprovedText(
  approved: Array<string | undefined>,
  slidesHtml: string[],
  indexOffset = 0,
): TextIssue[] {
  const issues: TextIssue[] = [];
  slidesHtml.forEach((html, i) => {
    const wanted = tokenize(approved[i] ?? '');
    const shown = tokenize(visibleText(html));
    const missing = unique(subtract(wanted, shown));
    const extra = unique(subtract(shown, wanted));
    if (missing.length > 0 || extra.length > 0) {
      issues.push({ slideIndex: i + indexOffset, missing: missing.slice(0, 12), extra: extra.slice(0, 12) });
    }
  });
  return issues;
}

/** Há texto aprovado para gerar? Sem ele, o cérebro não tem o que reproduzir literalmente. */
export function hasApprovedText(input: {
  sourceCopy?: string;
  approvedSkeleton?: Array<{ copy?: string }>;
}): boolean {
  if (input.sourceCopy?.trim()) return true;
  return (input.approvedSkeleton ?? []).some((item) => item.copy?.trim());
}

const list = (words: string[]): string => words.map((w) => `"${w}"`).join(', ');

/**
 * Os problemas viram desvios no mesmo formato do reviewer visual, então entram no fluxo que já
 * existe: aparecem na análise do chat, deixam o deck como "precisa de revisão" e alimentam o
 * ajuste cirúrgico quando a pessoa recusa.
 */
export function textIssuesToDeviations(issues: TextIssue[]): Array<{
  type: 'content';
  severity: 'critical' | 'major';
  slideIndex: number;
  description: string;
  fix: string;
}> {
  const out: ReturnType<typeof textIssuesToDeviations> = [];
  for (const issue of issues) {
    if (issue.missing.length > 0) {
      out.push({
        type: 'content',
        severity: 'critical',
        slideIndex: issue.slideIndex,
        description: `O texto aprovado não aparece por inteiro: faltam ${list(issue.missing)}.`,
        fix: 'Reescreva o texto do slide exatamente como o texto aprovado, sem trocar, resumir nem omitir palavra alguma.',
      });
    }
    if (issue.extra.length > 0) {
      out.push({
        type: 'content',
        severity: 'major',
        slideIndex: issue.slideIndex,
        description: `Há texto no slide que não está no texto aprovado: ${list(issue.extra)}.`,
        fix: 'Remova do slide todo texto que não faz parte do texto aprovado (nada de legendas, números de página, botões ou frases de apoio inventados).',
      });
    }
  }
  return out;
}
