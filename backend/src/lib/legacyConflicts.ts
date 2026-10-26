// Notas antigas (`legacyNotes`) contra a ficha e as regras globais.
//
// Na migração para a ficha, as "Diretrizes" e as "Instruções do agente" antigas foram copiadas, sem
// reinterpretar, para `legacyNotes`. O cérebro as recebia como se fossem regras. Visto na marca tzolkin
// (25/10/2026): as instruções antigas mandavam usar fotos do Unsplash, a fonte Space Grotesk e cores
// fora da paleta, enquanto a regra de foto real proíbe banco de imagem e a ficha define outra tipografia
// e outra paleta. O agente recebia ordens opostas e decidia no escuro.
//
// Regra: a ficha e as regras globais prevalecem. Aqui só se DETECTA o que as notas antigas contradizem, por
// linha. Quem usa o resultado (o texto do cérebro, o brief do MCP, as telas) decide o que mostrar; nada é
// apagado do cadastro.

export type LegacyConflictKind = 'stock-image' | 'ai-person' | 'font' | 'color';

export interface LegacyConflict {
  kind: LegacyConflictKind;
  /** A regra que a nota contradiz, em uma frase. */
  rule: string;
  /** A linha da nota (cortada), para a pessoa achar e corrigir. */
  excerpt: string;
}

export interface LegacyContext {
  /** Cores da ficha (#RRGGBB). Vazio = não dá para julgar cor. */
  paletteHex: string[];
  /** Famílias de fonte da ficha. Vazio = não dá para julgar fonte. */
  fontFamilies: string[];
}

const STOCK_IMAGE = /\b(unsplash|pexels|pixabay|shutterstock|istock|getty\s*images|freepik|adobe\s*stock)\b|banco\s+de\s+imagens?|stock\s+(?:photos?|images?)|fotos?\s+de\s+banco/i;
// Instrução de GERAR pessoa/rosto por IA. Linha que já proíbe ("nunca", "não"...) concorda com a regra.
const AI_PERSON = /\b(?:gere|gerar|crie|criar|use|usar)\b[^\n.]{0,40}\b(?:pessoas?|rostos?|modelos?)\b[^\n.]{0,40}\b(?:ia|artificial|fict[ií]ci[ao]s?|sint[eé]tic[ao]s?)\b/i;
const NEGATION = /\b(?:nunca|jamais|n[aã]o|evite|proibid[oa]s?|sem)\b/i;
const HEX = /#[0-9a-fA-F]{6}\b/g;
const FONT_LINE = /\b(?:tipografia|fontes?|fonts?)\s*[:\-–]\s*([^\n]+)/i;
// "Space Grotesk para títulos", "Inter para corpo": nome (palavras capitalizadas) seguido de "para", vírgula ou fim.
const FONT_NAME = /([A-ZÀ-Ý][\p{L}0-9]+(?:\s+[A-ZÀ-Ý][\p{L}0-9]+)*)(?=\s+(?:para|como|em)\b|\s*[,;]|\s*$)/gu;

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const cut = (s: string, n = 160): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function lineConflicts(line: string, ctx: LegacyContext, palette: Set<string>, fonts: Set<string>): LegacyConflict[] {
  const out: LegacyConflict[] = [];
  const excerpt = cut(line.trim());

  if (STOCK_IMAGE.test(line)) {
    out.push({ kind: 'stock-image', rule: 'Foto real é regra absoluta: só arquivos fornecidos; banco de imagem é proibido.', excerpt });
  }
  if (AI_PERSON.test(line) && !NEGATION.test(line)) {
    out.push({ kind: 'ai-person', rule: 'Nunca gerar pessoa, rosto ou foto sintética.', excerpt });
  }
  if (palette.size > 0) {
    const foreign = [...new Set((line.match(HEX) ?? []).map((h) => h.toUpperCase()))].filter((h) => !palette.has(h));
    if (foreign.length > 0) {
      out.push({
        kind: 'color',
        rule: `A paleta da ficha é ${ctx.paletteHex.join(', ')}; ${foreign.slice(0, 4).join(', ')} está fora dela.`,
        excerpt,
      });
    }
  }
  if (fonts.size > 0) {
    const m = FONT_LINE.exec(line);
    if (m) {
      // Só o primeiro período: o resto da linha costuma ser outra instrução ("Contraste WCAG sempre").
      const scope = (m[1] ?? '').split(/\.\s/)[0] ?? '';
      const foreign = [...scope.matchAll(FONT_NAME)].map((x) => x[1] ?? '').filter((name) => name && !fonts.has(norm(name)));
      if (foreign.length > 0) {
        out.push({
          kind: 'font',
          rule: `A tipografia da ficha é ${ctx.fontFamilies.join(', ')}; ${[...new Set(foreign)].join(', ')} está fora dela.`,
          excerpt,
        });
      }
    }
  }
  return out;
}

export interface LegacyReview {
  /** As notas sem as linhas que contradizem a ficha. */
  kept: string;
  conflicts: LegacyConflict[];
}

/** Separa, linha a linha, o que as notas antigas ainda podem dizer e o que contradiz a ficha. */
export function reviewLegacyNotes(notes: string | undefined | null, ctx: LegacyContext): LegacyReview {
  const text = (notes ?? '').trim();
  if (!text) return { kept: '', conflicts: [] };
  const palette = new Set(ctx.paletteHex.map((h) => h.toUpperCase()));
  const fonts = new Set(ctx.fontFamilies.map(norm).filter(Boolean));

  const kept: string[] = [];
  const conflicts: LegacyConflict[] = [];
  for (const line of text.split(/\r?\n/)) {
    const found = line.trim() ? lineConflicts(line, ctx, palette, fonts) : [];
    if (found.length > 0) conflicts.push(...found);
    else kept.push(line);
  }
  return { kept: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(), conflicts };
}

/** Contexto a partir da ficha (aceita o formato parcial que o cérebro e as telas usam). */
export function legacyContextOf(profile: {
  palette?: Array<{ hex: string }>;
  typography?: Array<{ family: string }>;
}): LegacyContext {
  return {
    paletteHex: (profile.palette ?? []).map((c) => c.hex),
    fontFamilies: (profile.typography ?? []).map((t) => t.family),
  };
}

/** Frase única por conflito, para `warnings` do brief e das telas. */
export function describeLegacyConflict(c: LegacyConflict): string {
  return `Nota antiga ignorada: "${c.excerpt}" — ${c.rule}`;
}
