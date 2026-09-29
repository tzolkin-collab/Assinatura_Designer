import type { GenerateContentParameters, UploadFileParameters, DeleteFileParameters, Part } from '@google/genai';
import { config } from '../config.js';
import { logger } from './logger.js';

/**
 * Extração de brandbook via Gemini — FUNÇÃO PURA (sem Prisma, sem R2, sem upload de
 * asset). `processBrandbookIngest` (brandbookIngestion.ts) é quem persiste; este
 * módulo só lê o material da marca e devolve o que conseguiu extrair, com honestidade
 * sobre o que falhou.
 *
 * Histórico do bug que isto substitui: o prompt antigo estava fixo para a marca
 * "Assinatura" (citava o monograma "A✦ ASSINATURA", a estrela de 4 pontas e a
 * "bisnaga de creme" da iconografia dela) — em qualquer outra marca o modelo era
 * induzido a INVENTAR esses elementos. Aqui o prompt é genérico e parametrizado pelo
 * nome da marca, com a regra "só o que está visível, nunca invente" repetida.
 */

export type SVGClassification = 'LOGOTYPE' | 'GRAPHIC_ELEMENT' | 'ILLUSTRATION';

export interface BrandbookExtractionColor {
  hex: string;
  /** Só preenchido quando o próprio material declarar (nunca calculado). */
  rgb?: string;
  cmyk?: string;
  pantone?: string;
}

export interface BrandbookExtractionFont {
  family: string;
  /** Papel da fonte (título/texto/logo/destaque…) — só quando o documento o declarar. */
  role?: string;
}

export interface BrandbookExtractionSvg {
  name: string;
  classification: SVGClassification;
  svgCode: string;
}

export type BrandbookExtractionStatus = 'ok' | 'partial' | 'failed';

export interface BrandbookExtractionResult {
  guidelines: string;
  colors: BrandbookExtractionColor[];
  primaryFonts: BrandbookExtractionFont[];
  svgs: BrandbookExtractionSvg[];
  warnings: string[];
  status: BrandbookExtractionStatus;
  /** Motivo legível (pt-BR) quando status é 'partial' ou 'failed'. */
  reason?: string;
}

export interface BrandbookExtractionImagePart {
  kind: 'image';
  mimeType: string;
  /** Base64, sem prefixo data URL. */
  data: string;
  fileName?: string;
}

export interface BrandbookExtractionPdfPart {
  kind: 'pdf';
  buffer: Buffer;
  fileName: string;
}

export type BrandbookExtractionInputPart = BrandbookExtractionImagePart | BrandbookExtractionPdfPart;

export interface BrandbookExtractionContext {
  guidelines?: string;
  colors?: string[];
  primaryFonts?: string[];
}

/**
 * Subconjunto do cliente `GoogleGenAI` que este módulo precisa — injetável para os
 * testes (um objeto qualquer com este formato serve; a instância real de
 * `GoogleGenAI` satisfaz a interface estruturalmente, sem cast).
 */
export interface GeminiExtractionClient {
  models: {
    generateContent: (params: GenerateContentParameters) => Promise<{ text?: string }>;
  };
  files: {
    upload: (params: UploadFileParameters) => Promise<{ uri?: string; mimeType?: string; name?: string }>;
    delete: (params: DeleteFileParameters) => Promise<unknown>;
  };
}

export interface BrandbookExtractionInput {
  client: GeminiExtractionClient;
  brandName: string;
  parts: BrandbookExtractionInputPart[];
  /** Texto já extraído localmente (HTML/CSS/SVG inline) — vira contexto extra em toda chamada. */
  sharedText?: string;
  existingContext?: BrandbookExtractionContext;
  /** Override de modelo (testes/operação); default = config.models.fast. */
  model?: string;
}

// ── Limite acima do qual o PDF vai por referência (Files API), não inline ──────────
// Medido: um PDF de 23 MB vira ~31 MB em base64 numa única requisição — bem acima do
// limite de payload inline do Gemini. 15 MB de bytes crus é uma margem segura.
export const PDF_INLINE_MAX_BYTES = 15 * 1024 * 1024;

// Gemini 2.5 Flash aceita até 65536 tokens de saída (documentação pública do Google).
// O valor antigo (8192) truncava a extração de um brandbook inteiro — daí o "resgate
// de emergência" de JSON cortado, que aqui vira só uma rede de segurança, não a regra.
export const EXTRACTION_MAX_OUTPUT_TOKENS = 65536;

// ── Deduplicação de cor por distância (não só por string exata) ───────────────────
// Ex. real visto em produção: #3e101f e #3c111c são a MESMA cor com erro de
// arredondamento — Set() não pega isso porque as strings são diferentes.
export const COLOR_DEDUPE_DISTANCE = 20;
export const MAX_BRAND_COLORS = 24;

export function normalizeHex(raw: string): string | null {
  const s = raw.trim();
  const m = /^#?([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$/.exec(s);
  if (!m) return null;
  let hex = m[1]!;
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  return `#${hex.toUpperCase()}`;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const int = parseInt(normalized.slice(1), 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

/** Distância euclidiana simples em RGB. Suficiente para pegar quase-duplicatas sem trazer uma lib de cor inteira. */
export function colorDistance(a: string, b: string): number {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return Infinity;
  const [r1, g1, b1] = ca;
  const [r2, g2, b2] = cb;
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/**
 * União com deduplicação por distância de cor, em ordem de PRIORIDADE (o primeiro
 * grupo da lista vence quando duas cores colidem). Usado tanto para combinar os
 * resultados de várias chamadas ao Gemini (map-reduce, sem teto) quanto pela
 * ingestão para o merge final com cores já cadastradas + regex (com teto de 24).
 */
function dedupeByDistance<T>(
  priorityLists: T[][],
  getHex: (item: T) => string,
  threshold: number,
  cap: number,
): { kept: T[]; dropped: T[] } {
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const list of priorityLists) {
    for (const item of list) {
      const hex = normalizeHex(getHex(item));
      if (!hex) continue;
      const isDuplicate = kept.some((k) => colorDistance(normalizeHex(getHex(k)) ?? '', hex) < threshold);
      if (isDuplicate) continue;
      if (kept.length >= cap) {
        dropped.push(item);
        continue;
      }
      kept.push(item);
    }
  }
  return { kept, dropped };
}

export function mergeColorObjects(
  lists: BrandbookExtractionColor[][],
  opts?: { distanceThreshold?: number; cap?: number },
): { colors: BrandbookExtractionColor[]; droppedForCap: BrandbookExtractionColor[] } {
  const { kept, dropped } = dedupeByDistance(
    lists,
    (c) => c.hex,
    opts?.distanceThreshold ?? COLOR_DEDUPE_DISTANCE,
    opts?.cap ?? Infinity,
  );
  return { colors: kept, droppedForCap: dropped };
}

/** Versão para hex puro (string[]) — usada pela ingestão no merge final com o teto de verdade. */
export function mergeHexColorLists(
  lists: string[][],
  opts?: { distanceThreshold?: number; cap?: number },
): { colors: string[]; droppedForCap: string[] } {
  const { kept, dropped } = dedupeByDistance(
    lists,
    (s) => s,
    opts?.distanceThreshold ?? COLOR_DEDUPE_DISTANCE,
    opts?.cap ?? MAX_BRAND_COLORS,
  );
  return { colors: kept, droppedForCap: dropped };
}

/** União de fontes por nome de família (case-insensitive); completa o "role" que faltava se outra ocorrência trouxer. */
export function mergeFonts(lists: BrandbookExtractionFont[][]): BrandbookExtractionFont[] {
  const seen = new Map<string, BrandbookExtractionFont>();
  for (const list of lists) {
    for (const f of list) {
      const family = f.family.trim();
      if (!family) continue;
      const key = family.toLowerCase();
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, f.role ? { family, role: f.role } : { family });
      } else if (f.role && !existing.role) {
        existing.role = f.role;
      }
    }
  }
  return Array.from(seen.values());
}

/** Junta textos de guidelines de várias chamadas sem duplicar bloco repetido. */
export function mergeGuidelinesTexts(texts: Array<string | undefined | null>): string {
  const partes = texts.map((t) => (t ?? '').trim()).filter(Boolean);
  return Array.from(new Set(partes)).join('\n\n');
}

// ── Parsing defensivo da resposta do Gemini ────────────────────────────────────────

interface ParsedExtractionJSON {
  guidelines?: unknown;
  colors?: unknown;
  primaryFonts?: unknown;
  svgs?: unknown;
}

/**
 * Resgate de JSON truncado (o modelo estourou o orçamento de tokens no meio da
 * resposta). Continua existindo como REDE DE SEGURANÇA — com o teto de saída maior
 * (EXTRACTION_MAX_OUTPUT_TOKENS) deve acontecer bem menos que antes — mas quando
 * acontece, marcamos `truncated: true` para o chamador avisar em `warnings`.
 */
function parseExtractionJSON(rawText: string): { parsed: ParsedExtractionJSON; truncated: boolean } {
  let cleanText = rawText.trim();
  cleanText = cleanText.replace(/^```(json)?/i, '').replace(/```$/i, '').trim();

  try {
    return { parsed: JSON.parse(cleanText), truncated: false };
  } catch {
    // segue para o resgate
  }

  try {
    const parsed = JSON.parse(cleanText + ']}');
    return { parsed, truncated: true };
  } catch {
    // segue para o resgate por regex (última rede: recupera só os SVGs)
  }

  const svgRegex = /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"classification"\s*:\s*"([^"]+)"\s*,\s*"svgCode"\s*:\s*"([\s\S]*?)"\s*\}/gi;
  const svgs: Array<{ name: string; classification: string; svgCode: string }> = [];
  let match;
  while ((match = svgRegex.exec(cleanText)) !== null) {
    const svgCode = match[3].replace(/\\"/g, '"').replace(/\\n/g, '\n');
    if (svgCode.includes('<svg')) {
      svgs.push({ name: match[1]!, classification: match[2]!, svgCode });
    }
  }

  return { parsed: { svgs }, truncated: true };
}

function sanitizeColorsFromResponse(raw: unknown): BrandbookExtractionColor[] {
  if (!Array.isArray(raw)) return [];
  const out: BrandbookExtractionColor[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const hex = normalizeHex(item);
      if (hex) out.push({ hex });
      continue;
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const hex = typeof obj.hex === 'string' ? normalizeHex(obj.hex) : null;
      if (!hex) continue;
      const color: BrandbookExtractionColor = { hex };
      if (typeof obj.rgb === 'string' && obj.rgb.trim()) color.rgb = obj.rgb.trim();
      if (typeof obj.cmyk === 'string' && obj.cmyk.trim()) color.cmyk = obj.cmyk.trim();
      if (typeof obj.pantone === 'string' && obj.pantone.trim()) color.pantone = obj.pantone.trim();
      out.push(color);
    }
  }
  return out;
}

function sanitizeFontsFromResponse(raw: unknown): BrandbookExtractionFont[] {
  if (!Array.isArray(raw)) return [];
  const out: BrandbookExtractionFont[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      if (item.trim()) out.push({ family: item.trim() });
      continue;
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      if (typeof obj.family === 'string' && obj.family.trim()) {
        const font: BrandbookExtractionFont = { family: obj.family.trim() };
        if (typeof obj.role === 'string' && obj.role.trim()) font.role = obj.role.trim();
        out.push(font);
      }
    }
  }
  return out;
}

function sanitizeSvgsFromResponse(raw: unknown): BrandbookExtractionSvg[] {
  if (!Array.isArray(raw)) return [];
  const out: BrandbookExtractionSvg[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.svgCode !== 'string' || !obj.svgCode.includes('<svg')) continue;
    const classification: SVGClassification =
      obj.classification === 'LOGOTYPE' || obj.classification === 'ILLUSTRATION' || obj.classification === 'GRAPHIC_ELEMENT'
        ? obj.classification
        : 'GRAPHIC_ELEMENT';
    out.push({
      name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : `vetor-ia-${Date.now()}.svg`,
      classification,
      svgCode: obj.svgCode,
    });
  }
  return out;
}

// ── Prompt genérico, parametrizado pela marca ──────────────────────────────────────

function buildPrompt(brandName: string, existingContext: BrandbookExtractionContext | undefined, sharedText: string | undefined): string {
  const contextoPartes: string[] = [];
  if (existingContext?.guidelines?.trim()) contextoPartes.push(`Diretrizes já registradas: ${existingContext.guidelines.trim()}`);
  if (existingContext?.colors?.length) contextoPartes.push(`Cores já cadastradas: ${existingContext.colors.join(', ')}`);
  if (existingContext?.primaryFonts?.length) contextoPartes.push(`Fontes já cadastradas: ${existingContext.primaryFonts.join(', ')}`);

  const contexto = contextoPartes.length > 0
    ? `\n\nContexto já cadastrado desta marca (NÃO é o material a analisar; use somente para não contradizer o que já existe — nunca copie estes valores como se fossem achado novo do documento):\n${contextoPartes.join('\n')}`
    : '';

  const textoExtraido = sharedText?.trim()
    ? `\n\nConteúdo textual já extraído dos arquivos (HTML/CSS/texto simples, quando houver):\n${sharedText.trim()}`
    : '';

  return `Você é um especialista em direção de arte e extração de identidade visual e verbal de marcas.
Examine atentamente o material da marca "${brandName}" fornecido NESTA chamada (documento, imagens e/ou texto abaixo).

REGRA MAIS IMPORTANTE: extraia SOMENTE o que está VISÍVEL ou EXPLICITAMENTE ESCRITO neste material.
Se uma informação não aparece aqui, devolva o campo vazio. É TERMINANTEMENTE PROIBIDO inventar, supor
ou completar com conhecimento genérico de branding qualquer cor, fonte, ícone, texto ou regra que você
não tenha visto de fato neste material — mesmo que pareça óbvio para este tipo de marca.

Devolva um JSON com exatamente esta forma:
{
  "guidelines": "...",
  "colors": [{ "hex": "#RRGGBB", "rgb": "R, G, B", "cmyk": "C, M, Y, K", "pantone": "..." }],
  "primaryFonts": [{ "family": "Nome da Fonte", "role": "título" }],
  "svgs": [{ "name": "...", "classification": "LOGOTYPE", "svgCode": "<svg ...>...</svg>" }]
}

Regras de cada campo:
1. "guidelines": tom de voz, personalidade, promessa, valores e regras de uso ESCRITOS no material (markdown, só o que está de fato no texto). Use "" se não houver texto de marca nesta chamada.
2. "colors": cada cor oficial da paleta visível. "rgb", "cmyk" e "pantone" são OPCIONAIS — inclua cada um SOMENTE quando estiver escrito no material; nunca calcule ou estime a partir do hex.
3. "primaryFonts": cada família tipográfica usada. "role" é OPCIONAL — inclua somente quando o material declarar para que serve aquela fonte (ex.: título, texto corrido, logo, destaque).
4. "svgs": vetorize em SVG limpo (viewBox, paths, stroke, fill) APENAS elementos gráficos que você seja capaz de identificar com segurança nas imagens desta chamada (ex.: o logotipo oficial, um ícone característico e recorrente da marca, um grafismo estrutural). NÃO invente ícones genéricos de brandbook que não estejam de fato nas imagens fornecidas aqui. Classifique cada um como "LOGOTYPE", "GRAPHIC_ELEMENT" ou "ILLUSTRATION". Se não houver nada para vetorizar com segurança, devolva uma lista vazia.
${contexto}${textoExtraido}`;
}

interface GroupResult {
  ok: boolean;
  guidelines: string;
  colors: BrandbookExtractionColor[];
  primaryFonts: BrandbookExtractionFont[];
  svgs: BrandbookExtractionSvg[];
  warnings: string[];
  reason?: string;
}

async function extractFromGroup(
  client: GeminiExtractionClient,
  model: string,
  label: string,
  contentParts: Part[],
  promptSuffix: string,
): Promise<GroupResult> {
  try {
    const response = await client.models.generateContent({
      model,
      contents: [...contentParts, { text: promptSuffix }],
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
      },
    });

    if (!response.text) {
      const reason = `Resposta vazia da IA para ${label}`;
      return { ok: false, guidelines: '', colors: [], primaryFonts: [], svgs: [], warnings: [reason], reason };
    }

    const { parsed, truncated } = parseExtractionJSON(response.text);
    const warnings: string[] = [];
    if (truncated) {
      warnings.push(`A resposta da IA para ${label} veio truncada; foi aplicado um resgate parcial (pode ter perdido dados)`);
      logger.warn('Resposta truncada na extração de brandbook', { label });
    }

    return {
      ok: true,
      guidelines: typeof parsed.guidelines === 'string' ? parsed.guidelines : '',
      colors: sanitizeColorsFromResponse(parsed.colors),
      primaryFonts: sanitizeFontsFromResponse(parsed.primaryFonts),
      svgs: sanitizeSvgsFromResponse(parsed.svgs),
      warnings,
    };
  } catch (err) {
    const reason = `Falha ao consultar a IA para ${label}: ${err instanceof Error ? err.message : String(err)}`;
    logger.warn('Falha numa chamada de extração de brandbook', { label, error: reason });
    return { ok: false, guidelines: '', colors: [], primaryFonts: [], svgs: [], warnings: [reason], reason };
  }
}

/**
 * Prepara o PDF para ir ao Gemini: inline em base64 se for pequeno, ou via Files API
 * quando passar do limite (evita estourar o limite de payload inline do provedor com
 * um PDF de dezenas de MB virando base64). O cleanup apaga o arquivo remoto — nunca
 * deixamos lixo na conta do Gemini.
 */
async function buildPdfPart(
  client: GeminiExtractionClient,
  pdf: BrandbookExtractionPdfPart,
): Promise<{ part: Part; cleanup: () => Promise<string | undefined> }> {
  if (pdf.buffer.length <= PDF_INLINE_MAX_BYTES) {
    return {
      part: { inlineData: { mimeType: 'application/pdf', data: pdf.buffer.toString('base64') } },
      cleanup: async () => undefined,
    };
  }

  // `Buffer` é um `Uint8Array<ArrayBufferLike>` — o `ArrayBufferLike` inclui
  // `SharedArrayBuffer`, que o tipo `BlobPart` do DOM não aceita. `Uint8Array.from`
  // copia para um `Uint8Array<ArrayBuffer>` de verdade, sem custo relevante (PDF já
  // está inteiro em memória de qualquer forma).
  const uploaded = await client.files.upload({
    file: new Blob([Uint8Array.from(pdf.buffer)], { type: 'application/pdf' }),
    config: { mimeType: 'application/pdf', displayName: pdf.fileName },
  });

  if (!uploaded.uri) {
    throw new Error(`Upload via Files API não retornou URI para ${pdf.fileName}`);
  }

  const remoteName = uploaded.name;
  return {
    part: { fileData: { fileUri: uploaded.uri, mimeType: uploaded.mimeType ?? 'application/pdf' } },
    cleanup: async () => {
      if (!remoteName) return undefined;
      try {
        await client.files.delete({ name: remoteName });
        return undefined;
      } catch (err) {
        const warning = `Falha ao apagar arquivo temporário da Files API (${pdf.fileName}): ${err instanceof Error ? err.message : String(err)}`;
        logger.warn('Falha ao limpar arquivo da Files API', { fileName: pdf.fileName, error: warning });
        return warning;
      }
    },
  };
}

/**
 * Extrai diretrizes, cores, fontes e SVGs do material de uma marca via Gemini.
 *
 * MAP-REDUCE, um arquivo por chamada: cada PDF vai sozinho (o teto global de 6 partes
 * que existia antes some — não há mais); todas as imagens soltas vão juntas numa
 * chamada. Os resultados de cada chamada são unidos (cores por distância de cor,
 * fontes por união, guidelines concatenado sem duplicar, SVGs concatenados).
 *
 * SEM efeito colateral: não grava no Prisma nem no R2. Quem chama decide o que fazer
 * com o resultado — inclusive não persistir nada quando `status === 'failed'`.
 */
export async function extractBrandInsights(input: BrandbookExtractionInput): Promise<BrandbookExtractionResult> {
  const { client, brandName, parts, sharedText, existingContext } = input;
  const model = input.model ?? config.models.fast;
  const promptSuffix = buildPrompt(brandName, existingContext, sharedText);

  const images = parts.filter((p): p is BrandbookExtractionImagePart => p.kind === 'image');
  const pdfs = parts.filter((p): p is BrandbookExtractionPdfPart => p.kind === 'pdf');

  const outcomes: Array<GroupResult & { label: string }> = [];
  const extraWarnings: string[] = [];

  if (images.length > 0) {
    const label = `imagens (${images.length} arquivo${images.length > 1 ? 's' : ''})`;
    const imageParts: Part[] = images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } }));
    outcomes.push({ label, ...(await extractFromGroup(client, model, label, imageParts, promptSuffix)) });
  }

  for (const pdf of pdfs) {
    const label = pdf.fileName;
    let cleanup: (() => Promise<string | undefined>) | undefined;
    try {
      const built = await buildPdfPart(client, pdf);
      cleanup = built.cleanup;
      outcomes.push({ label, ...(await extractFromGroup(client, model, label, [built.part], promptSuffix)) });
    } catch (err) {
      const reason = `Falha ao preparar ${label} para a IA: ${err instanceof Error ? err.message : String(err)}`;
      outcomes.push({ label, ok: false, guidelines: '', colors: [], primaryFonts: [], svgs: [], warnings: [reason], reason });
    } finally {
      if (cleanup) {
        const warning = await cleanup();
        if (warning) extraWarnings.push(warning);
      }
    }
  }

  if (outcomes.length === 0) {
    if (!sharedText || !sharedText.trim()) {
      // Nada para a IA analisar (ex.: só SVGs crus foram enviados) — não é falha.
      return { guidelines: '', colors: [], primaryFonts: [], svgs: [], warnings: [], status: 'ok' };
    }
    const label = 'texto extraído do material';
    outcomes.push({ label, ...(await extractFromGroup(client, model, label, [], promptSuffix)) });
  }

  const successful = outcomes.filter((o) => o.ok);
  const warnings = [...extraWarnings, ...outcomes.flatMap((o) => o.warnings)];

  if (successful.length === 0) {
    const reason = outcomes.map((o) => o.reason).filter(Boolean).join(' | ') || 'Falha desconhecida na extração via IA';
    return { guidelines: '', colors: [], primaryFonts: [], svgs: [], warnings, status: 'failed', reason };
  }

  const guidelines = mergeGuidelinesTexts(successful.map((o) => o.guidelines));
  const { colors } = mergeColorObjects(successful.map((o) => o.colors), { cap: Infinity });
  const primaryFonts = mergeFonts(successful.map((o) => o.primaryFonts));
  const svgs = successful.flatMap((o) => o.svgs);

  const status: BrandbookExtractionStatus = successful.length === outcomes.length ? 'ok' : 'partial';
  const reason = status === 'partial'
    ? outcomes.filter((o) => !o.ok).map((o) => o.reason).filter(Boolean).join(' | ')
    : undefined;

  return { guidelines, colors, primaryFonts, svgs, warnings, status, reason };
}
