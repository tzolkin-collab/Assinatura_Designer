import type { Part } from '@google/genai';
import { config } from '../config.js';
import { logger } from './logger.js';
import { brandProfileSchema, type BrandProfileData } from './brandProfile.js';
import {
  buildPdfPart,
  EXTRACTION_MAX_OUTPUT_TOKENS,
  normalizeHex,
  type BrandbookExtractionImagePart,
  type BrandbookExtractionInputPart,
  type BrandbookExtractionPdfPart,
  type GeminiExtractionClient,
} from './brandbookExtraction.js';

// Importar a ficha do projeto de um manual de marca (PDF, imagens ou texto).
//
// A IA PROPÕE, a pessoa decide: nada daqui grava. O resultado é um rascunho da ficha, e cada item
// vem com o trecho do manual que o sustenta, para quem revisa poder conferir. Três travas, todas
// em código e não só no prompt:
//   1. item sem trecho é descartado: sem origem, não entra;
//   2. quando temos o texto do material (md, txt, html), o trecho tem de existir nele, senão o
//      item é descartado: é o que pega um trecho inventado;
//   3. logo, manual visual e arquivos nunca vêm daqui: vêm da biblioteca do projeto.

export interface ProfileEvidence {
  /** Qual item, quando a seção é uma lista (ex.: "#410C1C", "Queens", "Tom"). */
  label?: string;
  quote: string;
  page?: number;
}

export type ProfileImportStatus = 'ok' | 'partial' | 'failed';

export interface ProfileImportResult {
  draft: BrandProfileData;
  /** Por seção da ficha (mesmas chaves de `PROFILE_SECTIONS`). */
  evidence: Record<string, ProfileEvidence[]>;
  /** O que o manual não traz: continua pendente na ficha. */
  notFound: string[];
  warnings: string[];
  status: ProfileImportStatus;
  reason?: string;
  /** `true` quando os trechos foram conferidos contra o texto do material; `false` quando só a pessoa pode conferir. */
  quotesChecked: boolean;
}

export interface ProfileExtractionInput {
  client: GeminiExtractionClient;
  brandName: string;
  parts: BrandbookExtractionInputPart[];
  /** Texto do material (md, txt, html). Habilita a conferência dos trechos em código. */
  sourceText?: string;
  model?: string;
}

const SOURCE_TEXT_MAX = 60_000;

/** As seções da ficha que um manual pode preencher (as chaves de `PROFILE_SECTIONS`). */
export const IMPORTABLE_SECTIONS = [
  'essence', 'writingDirection', 'palette', 'typography', 'artDirection', 'realPhoto', 'graphicElements',
  'neverDo', 'approvalCriterion', 'brandCodes', 'variation', 'collabRules',
] as const;
const QUOTE_MAX = 400;

// ── Prompt ───────────────────────────────────────────────────────────────────────

export function buildProfilePrompt(brandName: string, sourceText?: string): string {
  const text = sourceText?.trim()
    ? `\n\nTEXTO DO MATERIAL (use junto com os arquivos anexados):\n"""\n${sourceText.trim().slice(0, SOURCE_TEXT_MAX)}\n"""`
    : '';
  return `Você está lendo o manual de marca (ou material equivalente) do projeto "${brandName}" para preencher a FICHA DO PROJETO.

REGRAS ABSOLUTAS
1. Extraia SOMENTE o que está escrito ou visível no material. Nunca invente, complete, resuma em excesso nem "melhore" o texto.
2. Cada item precisa do campo "quote": o TRECHO LITERAL do material que o sustenta, copiado como está (até ${QUOTE_MAX} caracteres), e "page" (número da página) quando souber.
3. Se o material NÃO traz um campo, NÃO o inclua e liste o nome dele em "notFound". Não preencha por dedução.
4. Cores: só as que o material mostra. Use o hex escrito; se só houver RGB, converta com exatidão. "role" (função da cor) e "name" só se o material disser; caso contrário, omita.
5. Fontes: "role" só se o material disser para que a fonte serve.
6. NÃO preencha logo, manual visual nem arquivos: isso vem da biblioteca do projeto.
7. Escreva em português do Brasil, mantendo os termos do material.
8. O material pode DEFINIR o que é uma plataforma de marca ou um manual visual (explicação genérica). Isso NÃO é o conteúdo da marca: não use definições assim para preencher "essence" nem nenhum outro campo. Só preencha "essence" se o material disser quem é ESTA marca (posicionamento, propósito, promessa, personalidade dela).
9. Índice ou sumário ("orienta cores, fontes, ícones, grafismos...") não é regra. Só preencha "graphicElements" se o material descrever linhas, formas, ícones, grafismos, monograma ou texturas gráficas COMO elementos da marca.
10. Não repita o mesmo trecho em dois campos. Imagem e fotografia vão em "realPhoto", não em "graphicElements".
11. "text" é o próprio trecho do material: cópia literal ou um recorte dele, nunca uma paráfrase. Não una trechos de páginas diferentes.
12. Em listas, um item por entrada: não junte vários itens numa frase com ponto e vírgula.

CAMPOS
- essence: quem é a marca, o que pensa, fala e defende, personalidade, posicionamento (texto corrido, fiel ao material).
- writingDirection: tom de voz, vocabulário, nível de formalidade.
- palette: lista de {hex, name?, role?, quote, page?}.
- typography: lista de {family, role?, quote, page?}.
- artDirection: composição, grid, respiro, escala, intensidade, estilo de imagem.
- realPhoto: tipo de foto aprovada, tratamento, recortes.
- graphicElements: linhas, formas, ícones, monograma, texturas.
- neverDo: lista de {text, quote, page?}, o que o material proíbe ou manda evitar.
- approvalCriterion: como saber se a peça pertence à marca (perguntas de checklist, regra de validação).
- brandCodes: lista de {category, items[], quote, page?}: o que "não pode sumir", por categoria (ex.: personalidade, tom, conteúdo, acabamento).
- mayVary: lista de {text, quote, page?}: o que pode variar de uma peça para outra.
- mustKeep: lista de {text, quote, page?}: o que precisa ficar em toda peça.
- collabRules: regras da marca quando faz collab ou parceria.
- logoRules: regras de uso do logo (só o texto das regras, nunca o arquivo).

Os campos de texto (essence, writingDirection, artDirection, realPhoto, graphicElements, approvalCriterion, collabRules, logoRules) são objetos {text, quote, page?}.

Responda APENAS com JSON neste formato (omita os campos que o material não traz):
{
  "essence": {"text": "", "quote": "", "page": 1},
  "palette": [{"hex": "#000000", "name": "", "role": "", "quote": "", "page": 1}],
  "typography": [{"family": "", "role": "", "quote": "", "page": 1}],
  "neverDo": [{"text": "", "quote": "", "page": 1}],
  "brandCodes": [{"category": "", "items": [""], "quote": "", "page": 1}],
  "notFound": ["nome dos campos que o material não traz"]
}${text}`;
}

// ── Leitura tolerante da resposta ────────────────────────────────────────────────

export function parseProfileResponse(raw: string): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    const a = cleaned.indexOf('{');
    const b = cleaned.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(cleaned.slice(a, b + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
};
const page = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined);

/** Minúsculas, sem acento, sem pontuação e com espaço único: o que importa para achar um trecho. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#%]+/gu, ' ')
    .trim();
}

export function quoteInSource(quote: string, sourceText: string): boolean {
  const q = normalizeForMatch(quote);
  return q.length > 0 && normalizeForMatch(sourceText).includes(q);
}

/**
 * Trecho que explica O QUE É um documento da marca ("a plataforma de marca define o que a marca
 * pensa...", "o manual orienta...") em vez de dizer quem a marca é. Visto na importação real: o
 * modelo usou a definição de "plataforma de marca" como se fosse a essência da Assinatura.
 */
export function describesTheDocument(quote: string): boolean {
  const q = normalizeForMatch(quote);
  return (
    /^(define|orienta|serve|explica|apresenta)\b/.test(q) ||
    /^(?:(?:a|o) )?(?:plataforma(?: de marca)?|manual(?: visual| de marca)?|guia|brandbook)\b.{0,40}?\b(define|orienta|serve|explica|apresenta)\b/.test(q)
  );
}

/** Um trecho contém o outro (e é longo o bastante para isso significar algo). */
function overlaps(a: string, b: string): boolean {
  const short = a.length <= b.length ? a : b;
  return short.length >= 12 && (a.includes(b) || b.includes(a));
}

const longWords = (s: string): string[] => normalizeForMatch(s).split(' ').filter((w) => w.length > 3);

/**
 * O texto que vai para a ficha é do manual, nunca uma paráfrase do modelo. Se o `text` usa palavras
 * que o trecho não tem, ele foi reescrito: o trecho literal entra no lugar.
 */
function literalText(text: string | undefined, quote: string, label: string, warnings: string[]): string {
  if (!text) return quote;
  const inQuote = new Set(longWords(quote));
  if (longWords(text).every((w) => inQuote.has(w))) return text;
  warnings.push(`Texto trocado pelo trecho literal do manual (o modelo tinha parafraseado): ${label}`);
  return quote;
}

/** "A; B; C" numa entrada só vira três entradas. */
function splitListText(text: string): string[] {
  return text.split(/[;\n]/).map((t) => t.trim().replace(/\.$/, '')).filter(Boolean);
}

interface Item {
  text?: string;
  quote?: string;
  page?: number;
  raw: Record<string, unknown>;
}

function itemsOf(v: unknown): Item[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).map((raw) => ({ text: str(raw.text, 600), quote: str(raw.quote, QUOTE_MAX), page: page(raw.page), raw }));
}

function textField(v: unknown): Item | null {
  if (!isObj(v)) return null;
  return { text: str(v.text, 4000), quote: str(v.quote, QUOTE_MAX), page: page(v.page), raw: v };
}

/**
 * Transforma a resposta do modelo em rascunho + evidências, aplicando as travas. Função pura:
 * é o que o teste exercita sem chamar IA.
 */
export function sanitizeProfileExtraction(parsed: unknown, sourceText?: string): ProfileImportResult {
  const warnings: string[] = [];
  const evidence: Record<string, ProfileEvidence[]> = {};
  const draft: Record<string, unknown> = {};
  const root = isObj(parsed) ? parsed : {};
  const checking = Boolean(sourceText?.trim());

  /** Aprovado = tem trecho e, quando dá para conferir, o trecho existe no material. */
  const accepted = (it: Item, what: string): boolean => {
    if (!it.quote) {
      warnings.push(`Descartado sem trecho de origem: ${what}`);
      return false;
    }
    if (checking && !quoteInSource(it.quote, sourceText!)) {
      warnings.push(`Descartado porque o trecho não está no material: ${what}`);
      return false;
    }
    return true;
  };
  const note = (section: string, it: Item, label?: string) => {
    (evidence[section] ??= []).push({ ...(label ? { label } : {}), quote: it.quote!, ...(it.page ? { page: it.page } : {}) });
  };

  // Campos de texto corrido. A ordem é a prioridade: quando o mesmo trecho sustenta dois campos,
  // fica com o primeiro (ex.: a frase sobre imagens é de "realPhoto", não de "graphicElements").
  const textKeys = ['essence', 'writingDirection', 'approvalCriterion', 'collabRules', 'realPhoto', 'artDirection', 'graphicElements'] as const;
  const claimed: string[] = [];
  for (const key of textKeys) {
    const it = textField(root[key]);
    if (!it?.quote || !accepted(it, key)) continue;
    if (key === 'essence' && describesTheDocument(it.quote)) {
      warnings.push('Descartado porque o trecho define o que é o documento, não diz quem é a marca: essence');
      continue;
    }
    const q = normalizeForMatch(it.quote);
    if (claimed.some((c) => overlaps(c, q))) {
      warnings.push(`Descartado porque o mesmo trecho já sustenta outro campo: ${key}`);
      continue;
    }
    claimed.push(q);
    draft[key] = literalText(it.text, it.quote, key, warnings);
    note(key, it);
  }
  const logoRules = textField(root.logoRules);
  if (logoRules?.quote && accepted(logoRules, 'logoRules')) {
    draft.logo = { rules: literalText(logoRules.text, logoRules.quote, 'logoRules', warnings) };
    note('logo', logoRules);
  }

  // Paleta: hex válido, sem repetir
  const seenHex = new Set<string>();
  const palette: Array<{ hex: string; name?: string; role?: string }> = [];
  for (const it of itemsOf(root.palette)) {
    const hex = normalizeHex(String(it.raw.hex ?? ''));
    if (!hex) {
      warnings.push(`Cor descartada: hex inválido (${String(it.raw.hex ?? '')})`);
      continue;
    }
    const upper = hex.toUpperCase();
    if (seenHex.has(upper) || !accepted(it, `cor ${upper}`)) continue;
    seenHex.add(upper);
    palette.push({ hex: upper, ...(str(it.raw.name, 80) ? { name: str(it.raw.name, 80) } : {}), ...(str(it.raw.role, 200) ? { role: str(it.raw.role, 200) } : {}) });
    note('palette', it, upper);
  }
  if (palette.length) draft.palette = palette;

  // Tipografia: sem repetir família; a origem da fonte não é deduzida
  const seenFont = new Set<string>();
  const typography: Array<{ family: string; role?: string }> = [];
  for (const it of itemsOf(root.typography)) {
    const family = str(it.raw.family, 80);
    if (!family || seenFont.has(family.toLowerCase()) || !accepted(it, `fonte ${family}`)) continue;
    seenFont.add(family.toLowerCase());
    typography.push({ family, ...(str(it.raw.role, 200) ? { role: str(it.raw.role, 200) } : {}) });
    note('typography', it, family);
  }
  if (typography.length) draft.typography = typography;

  // Listas de frases
  const lists: Array<[string, string, string]> = [
    ['neverDo', 'neverDo', 'neverDo'],
    ['mayVary', 'mayVary', 'variation'],
    ['mustKeep', 'mustKeep', 'variation'],
  ];
  for (const [key, field, section] of lists) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const it of itemsOf(root[key])) {
      if (!it.text || !accepted(it, `${key}: ${it.text}`)) continue;
      for (const piece of splitListText(it.text)) {
        if (seen.has(normalizeForMatch(piece))) continue;
        seen.add(normalizeForMatch(piece));
        out.push(piece.slice(0, key === 'neverDo' ? 300 : 200));
        note(section, it, piece.slice(0, 60));
      }
    }
    if (out.length) draft[field] = out;
  }

  // Códigos que não podem sumir
  const codes: Array<{ category: string; items: string[] }> = [];
  for (const it of itemsOf(root.brandCodes)) {
    const category = str(it.raw.category, 80);
    const items = Array.isArray(it.raw.items) ? it.raw.items.map((x) => str(x, 120)).filter((x): x is string => Boolean(x)) : [];
    if (!category || items.length === 0 || !accepted(it, `código ${category}`)) continue;
    codes.push({ category, items: items.slice(0, 20) });
    note('brandCodes', it, category);
  }
  if (codes.length) draft.brandCodes = codes;

  // Regra de logo que é só um item de "precisa ficar" ou "pode variar" não é regra de logo.
  const logoText = (draft.logo as { rules?: string } | undefined)?.rules;
  if (logoText) {
    const listed = new Set(['mayVary', 'mustKeep', 'neverDo'].flatMap((k) => ((draft[k] as string[] | undefined) ?? []).map(normalizeForMatch)));
    if (listed.has(normalizeForMatch(logoText))) {
      delete draft.logo;
      delete evidence.logo;
      warnings.push('Descartado porque já é um item de outra lista: logoRules');
    }
  }

  // A ficha final passa pelo esquema de verdade: o que não valida sai, o resto fica.
  const checked = brandProfileSchema.safeParse(draft);
  let finalDraft: BrandProfileData = {};
  if (checked.success) {
    finalDraft = checked.data;
  } else {
    for (const [k, v] of Object.entries(draft)) {
      const one = brandProfileSchema.safeParse({ [k]: v });
      if (one.success) Object.assign(finalDraft, one.data);
      else warnings.push(`Campo descartado por não passar na validação: ${k}`);
    }
  }

  // "Não encontrado" é o que a ficha continua sem, e não só o que o modelo lembrou de avisar. Logo e
  // manual visual ficam de fora: nunca vêm de um manual, vêm da biblioteca do projeto.
  const filled = (k: string): boolean => {
    const v = (finalDraft as Record<string, unknown>)[k];
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  };
  const notFound = IMPORTABLE_SECTIONS.filter((sec) => !(sec === 'variation' ? filled('mayVary') || filled('mustKeep') : filled(sec)));
  return { draft: finalDraft, evidence, notFound, warnings, status: 'ok', quotesChecked: checking };
}

// ── Junção de várias chamadas (um PDF por chamada) ───────────────────────────────

export function mergeProfileResults(results: ProfileImportResult[]): ProfileImportResult {
  const draft: Record<string, unknown> = {};
  const evidence: Record<string, ProfileEvidence[]> = {};
  const warnings: string[] = [];
  const notFound = new Set<string>();
  const found = new Set<string>();

  const texts = ['essence', 'writingDirection', 'artDirection', 'realPhoto', 'graphicElements', 'approvalCriterion', 'collabRules'] as const;
  for (const r of results) {
    warnings.push(...r.warnings);
    const d = r.draft;
    for (const k of texts) {
      const v = d[k];
      if (!v) continue;
      const cur = draft[k] as string | undefined;
      // Mesmo campo em dois arquivos: junta, sem repetir.
      draft[k] = !cur ? v : normalizeForMatch(cur).includes(normalizeForMatch(v)) ? cur : `${cur}\n\n${v}`;
    }
    if (d.logo?.rules) {
      const cur = (draft.logo as { rules?: string } | undefined)?.rules;
      draft.logo = { rules: !cur ? d.logo.rules : cur.includes(d.logo.rules) ? cur : `${cur}\n${d.logo.rules}` };
    }
    for (const [k, list] of Object.entries({ palette: d.palette, typography: d.typography, brandCodes: d.brandCodes })) {
      if (!list?.length) continue;
      const cur = ((draft[k] as unknown[]) ?? []) as Array<Record<string, string>>;
      const keyOf = (x: Record<string, string>) => (x.hex ?? x.family ?? x.category).toLowerCase();
      const have = new Set(cur.map(keyOf));
      for (const x of list as unknown as Array<Record<string, string>>) if (!have.has(keyOf(x))) cur.push(x);
      draft[k] = cur;
    }
    for (const k of ['neverDo', 'mayVary', 'mustKeep'] as const) {
      const list = d[k];
      if (!list?.length) continue;
      const cur = ((draft[k] as string[]) ?? []);
      const have = new Set(cur.map(normalizeForMatch));
      for (const x of list) if (!have.has(normalizeForMatch(x))) cur.push(x);
      draft[k] = cur;
    }
    for (const [section, list] of Object.entries(r.evidence)) (evidence[section] ??= []).push(...list);
    for (const k of Object.keys(d)) found.add(k);
    for (const n of r.notFound) notFound.add(n);
  }

  // "Não encontrado" em um arquivo mas achado em outro não é "não encontrado".
  const stillMissing = [...notFound].filter((n) => !found.has(n));
  return {
    draft: draft as BrandProfileData,
    evidence,
    notFound: stillMissing,
    warnings,
    status: 'ok',
    quotesChecked: results.length > 0 && results.every((r) => r.quotesChecked),
  };
}

// ── Orquestração: um arquivo por chamada ─────────────────────────────────────────

async function callModel(
  client: GeminiExtractionClient,
  model: string,
  label: string,
  contentParts: Part[],
  prompt: string,
  sourceText?: string,
): Promise<{ ok: true; result: ProfileImportResult } | { ok: false; reason: string }> {
  // Três tentativas: resposta vazia, JSON malformado ou erro do provedor (503) são intermitentes.
  // Diagnosticado na importação real: com temperatura 0 o modelo às vezes fecha mal um array do JSON
  // (finishReason STOP, não é truncamento) e repete o mesmo erro; por isso só a 1ª tentativa usa
  // temperatura 0 e as seguintes usam a padrão, que muda a amostragem.
  const MAX_ATTEMPTS = 3;
  let reason = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await client.models.generateContent({
        model,
        contents: [...contentParts, { text: prompt }],
        // Extração, não criação: temperatura 0 para o mesmo manual dar a mesma ficha.
        config: {
          responseMimeType: 'application/json',
          maxOutputTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
          ...(attempt === 1 ? { temperature: 0 } : {}),
        },
      });
      if (!response.text) {
        reason = `Resposta vazia da IA para ${label}`;
      } else {
        const parsed = parseProfileResponse(response.text);
        if (parsed !== null) return { ok: true, result: sanitizeProfileExtraction(parsed, sourceText) };
        reason = `A IA devolveu algo que não é JSON para ${label}`;
      }
    } catch (err) {
      reason = `Falha ao consultar a IA para ${label}: ${err instanceof Error ? err.message : String(err)}`;
    }
    logger.warn('Tentativa de importação da ficha falhou', { label, attempt, reason });
  }
  return { ok: false, reason };
}

export async function extractProfileFromManual(input: ProfileExtractionInput): Promise<ProfileImportResult> {
  const { client, brandName, parts, sourceText } = input;
  const model = input.model ?? config.models.fast;
  const prompt = buildProfilePrompt(brandName, sourceText);

  const images = parts.filter((p): p is BrandbookExtractionImagePart => p.kind === 'image');
  const pdfs = parts.filter((p): p is BrandbookExtractionPdfPart => p.kind === 'pdf');

  const ok: ProfileImportResult[] = [];
  const reasons: string[] = [];
  const extraWarnings: string[] = [];

  if (images.length > 0) {
    const label = `imagens (${images.length} arquivo${images.length > 1 ? 's' : ''})`;
    const imageParts: Part[] = images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } }));
    const out = await callModel(client, model, label, imageParts, prompt, sourceText);
    if (out.ok) ok.push(out.result);
    else reasons.push(out.reason);
  }

  for (const pdf of pdfs) {
    let cleanup: (() => Promise<string | undefined>) | undefined;
    try {
      const built = await buildPdfPart(client, pdf);
      cleanup = built.cleanup;
      const out = await callModel(client, model, pdf.fileName, [built.part], prompt, sourceText);
      if (out.ok) ok.push(out.result);
      else reasons.push(out.reason);
    } catch (err) {
      reasons.push(`Falha ao preparar ${pdf.fileName} para a IA: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (cleanup) {
        const w = await cleanup();
        if (w) extraWarnings.push(w);
      }
    }
  }

  // Só texto (md, txt, html), sem PDF nem imagem: uma chamada com o texto no prompt.
  if (images.length === 0 && pdfs.length === 0 && sourceText?.trim()) {
    const out = await callModel(client, model, 'texto do material', [], prompt, sourceText);
    if (out.ok) ok.push(out.result);
    else reasons.push(out.reason);
  }

  if (ok.length === 0) {
    return {
      draft: {}, evidence: {}, notFound: [], warnings: extraWarnings,
      status: 'failed', quotesChecked: false,
      reason: reasons.join(' | ') || 'Nenhum material para a IA analisar.',
    };
  }

  const merged = mergeProfileResults(ok);
  const attempted = ok.length + reasons.length;
  return {
    ...merged,
    warnings: [...extraWarnings, ...merged.warnings],
    status: ok.length === attempted ? 'ok' : 'partial',
    ...(reasons.length ? { reason: reasons.join(' | ') } : {}),
  };
}

// ── Texto de HTML e limite de uso ────────────────────────────────────────────────

/** Texto visível de um HTML (um manual exportado, por exemplo), sem script nem estilo. */
export function plainTextFromHtml(html: string): string {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cada importação gasta IA de verdade (um PDF por chamada). 6 por hora por usuário cobre o uso
 * legítimo (importar, revisar, importar de novo com outro arquivo) e segura um laço por engano.
 */
export const PROFILE_IMPORT_RATE_LIMIT = {
  windowSec: 3600,
  max: 6,
  keyPrefix: 'profile-import',
  keyBy: 'user',
} as const;
