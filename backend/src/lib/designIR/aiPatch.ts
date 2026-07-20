// ═══════════════════════════════════════════════════════════════════════════════
// Design IR — motor de edição por IA (linguagem natural → IRPatch)
// ═══════════════════════════════════════════════════════════════════════════════
// Motor ÚNICO, usado por dois chamadores com contratos deliberadamente diferentes:
//
// - `POST /posts/:id/ai-patch` (editor): gera o patch e DEVOLVE. Não persiste — o
//   editor aplica no canvas, o patch entra no undo, e o save normal grava. Persistir
//   aqui sobrescreveria o trabalho não salvo do usuário.
// - `[EDIT]` do brain (chat da Fábrica): não há canvas do outro lado, então lá o patch
//   é aplicado e persistido NO SERVIDOR (ver `applyPatchToSlide` no patcher).
//
// Antes disto, o chat da Fábrica tentava editar pelo caminho `html-design`
// (`editHtmlSlide`), um formato que o pipeline não produz mais — a edição falhava em
// silêncio. O motor que funciona no `ir-design` é este, e agora é um só.

import { GoogleGenAI } from '@google/genai';
import { config } from '../../config.js';
import { generateWithRetry } from '../geminiRetry.js';
import { extractJsonObject } from '../jsonHelper.js';
import type { SlideNode, IRPatch } from './types.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

/**
 * Ops seguras para a IA editar UM slide. As estruturais (add/remove-slide,
 * update-tokens) ficam de fora DE PROPÓSITO: uma instrução ambígua não pode custar um
 * slide inteiro. Enquanto não houver um "aceitar/rejeitar" na tela, isto fica fechado.
 */
const AI_PATCH_OPS = new Set([
  'update-style', 'update-content', 'update-bounds', 'update-element',
  'update-background', 'reorder-element', 'remove-element',
]);

/** Teto de ops por patch: uma resposta delirante não reescreve o slide inteiro. */
const MAX_OPS = 40;

/**
 * Valida a resposta do modelo: mantém só ops permitidas, FORÇA o slideId real (o
 * modelo não escolhe em que slide mexe) e exige elementId existente. É esta função que
 * impede um LLM de corromper o design.
 */
export function sanitizeIRPatch(
  raw: unknown,
  slideId: string,
  elementIds: Set<string>,
): { ops: Array<Record<string, unknown>> } {
  const rawOps = raw && typeof raw === 'object' && Array.isArray((raw as { ops?: unknown }).ops)
    ? (raw as { ops: unknown[] }).ops
    : [];
  const ops: Array<Record<string, unknown>> = [];

  for (const item of rawOps) {
    if (!item || typeof item !== 'object') continue;
    const op = item as Record<string, unknown>;
    const kind = op.op;
    if (typeof kind !== 'string' || !AI_PATCH_OPS.has(kind)) continue;

    const base: Record<string, unknown> = { ...op, slideId };

    if (kind !== 'update-background') {
      if (typeof base.elementId !== 'string' || !elementIds.has(base.elementId)) continue;
    }
    if (kind === 'update-style' && (typeof base.style !== 'object' || base.style === null)) continue;
    if (kind === 'update-content' && typeof base.content !== 'string') continue;
    if (kind === 'update-bounds' && (typeof base.bounds !== 'object' || base.bounds === null)) continue;
    if (kind === 'update-element' && (typeof base.changes !== 'object' || base.changes === null)) continue;
    if (kind === 'update-background' && (typeof base.background !== 'object' || base.background === null)) continue;
    if (kind === 'reorder-element' && typeof base.newZIndex !== 'number') continue;

    ops.push(base);
    if (ops.length >= MAX_OPS) break;
  }

  return { ops };
}

export interface GenerateIRPatchInput {
  slide: SlideNode;
  instruction: string;
  /** Cores da marca, para a IA não inventar paleta. */
  brandColors?: string[];
  /** Elementos que o usuário selecionou no canvas (o chat da Fábrica não manda nenhum). */
  selectedElementIds?: string[];
}

/**
 * Traduz uma instrução em linguagem natural num IRPatch já sanitizado.
 *
 * Devolve `{ ops: [] }` quando não conseguiu traduzir. Quem chama DECIDE o que fazer
 * com isso — e a regra do produto é: dizer a verdade. Nunca fingir que editou.
 */
export async function generateIRPatchForSlide(input: GenerateIRPatchInput): Promise<IRPatch> {
  const { slide, instruction, brandColors = [], selectedElementIds = [] } = input;

  const elementIds = new Set((slide.elements ?? []).map((e) => e.id));
  const selected = selectedElementIds.filter((eid) => elementIds.has(eid));

  // Só o essencial vai pro modelo (id/tipo/papel/conteúdo/bounds/estilo) — o
  // suficiente pra decidir a edição sem inflar o prompt com o slide inteiro.
  const slideForModel = {
    id: slide.id,
    background: slide.background,
    elements: (slide.elements ?? []).map((e) => ({
      id: e.id, type: e.type, role: e.role, content: e.content, src: e.src, bounds: e.bounds, style: e.style,
    })),
  };

  const model = config.models.artist;

  const systemInstruction = [
    'Você edita UM slide de um design representado como DesignIR (JSON). A partir de uma instrução em linguagem natural, devolva um PATCH mínimo — apenas as mudanças necessárias.',
    'Responda SOMENTE com JSON puro (sem markdown) no formato: { "ops": [ ... ] }.',
    'Operações permitidas (use exatamente estes formatos):',
    '- { "op": "update-style", "slideId": string, "elementId": string, "style": { ...campos CSS parciais } }',
    '- { "op": "update-content", "slideId": string, "elementId": string, "content": string }',
    '- { "op": "update-bounds", "slideId": string, "elementId": string, "bounds": { "x"?, "y"?, "width"?, "height"?, "rotation"? } }',
    '- { "op": "update-element", "slideId": string, "elementId": string, "changes": { ...campos parciais do elemento } }',
    '- { "op": "update-background", "slideId": string, "background": { "type": "solid"|"gradient"|"image", "color"?, "gradient"?, "src"? } }',
    '- { "op": "reorder-element", "slideId": string, "elementId": string, "newZIndex": number }',
    '- { "op": "remove-element", "slideId": string, "elementId": string }',
    `SEMPRE use "slideId": "${slide.id}". Só referencie "elementId" que existam no slide fornecido.`,
    selected.length > 0
      ? `O usuário selecionou estes elementos — priorize editá-los: ${selected.join(', ')}.`
      : 'Nenhum elemento selecionado — infira o alvo pela instrução.',
    brandColors.length ? `Paleta da marca (prefira estas cores em hex): ${brandColors.join(', ')}.` : '',
    'Tamanhos em px (fontSize, bounds). Não invente elementos novos a menos que a instrução peça explicitamente.',
  ].filter(Boolean).join('\n');

  const userPrompt = `Slide atual (DesignIR):\n${JSON.stringify(slideForModel)}\n\nInstrução do usuário:\n${instruction.trim()}\n\nDevolva só o JSON { "ops": [...] }.`;

  const raw = (await generateWithRetry(ai, {
    model,
    contents: userPrompt,
    config: { systemInstruction, responseMimeType: 'application/json', maxOutputTokens: 8192 },
  }, model)).text ?? '{}';

  return sanitizeIRPatch(extractJsonObject(raw), slide.id, elementIds) as IRPatch;
}
