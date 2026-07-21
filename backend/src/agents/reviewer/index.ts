import { GoogleGenAI } from '@google/genai';
import { config } from '../../config.js';
import { generateWithRetry } from '../../lib/geminiRetry.js';
import type { DesignPage } from '../../lib/designTypes.js';
import type { PlannerOutput } from '../planner/index.js';
import { extractJsonObject } from '../../lib/jsonHelper.js';
import { renderHtmlToBase64 } from '../../lib/htmlRaster.js';
import { buildSlideDocument, type HtmlDesignContent } from '../../lib/htmlDesign.js';
import { logger } from '../../lib/logger.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

// Modelo do crítico visual: por padrão o mesmo cérebro de design (multimodal).
const VISION_MODEL = config.models.artist;

export interface ReviewDeviation {
  type: 'content' | 'visual' | 'brand' | 'overflow' | 'missing-zone';
  severity: 'minor' | 'major' | 'critical';
  slideIndex: number;
  description: string;
  fix: string;
}

export interface ReviewResult {
  reasoning?: string;
  approved: boolean;
  score: number;
  deviations: ReviewDeviation[];
  feedback: string;
  correctionInstructions?: string;
}

/** Layer de uma página no formato legado (nanoBanana). Campos opcionais porque a
 *  página vem do JSON do post, sem garantia de schema. */
interface ReviewLayer {
  type?: string;
  id?: string;
  zIndex?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  content?: string;
  url?: string;
}

interface ReviewPage {
  kind?: string;
  layers?: ReviewLayer[];
  [key: string]: unknown;
}

export async function runReviewer(params: {
  pages: ReviewPage[];
  plan: PlannerOutput;
  brandContext: string;
}): Promise<ReviewResult> {
  const { pages, plan, brandContext } = params;

  return runLegacyReviewer(pages as DesignPage[], plan, brandContext);
}

// ── Núcleo da crítica visual: recebe PNGs já renderizados e o modelo os avalia ──
// `realIndexes`: posição REAL de cada imagem no deck quando a amostra é espaçada
// (sem isto o slideIndex das deviations apontaria para a posição na amostra —
// "conserta o slide 3" quando o problema está no 47).
async function critiqueRenderedSlides(images: string[], brandContext: string, objective: string, realIndexes?: number[]): Promise<ReviewResult> {
  if (images.length === 0) {
    return { approved: true, score: 70, deviations: [], feedback: 'Sem slides para revisar', correctionInstructions: undefined };
  }

  const prompt = `Você é um Diretor de Arte sênior revisando uma peça de social media premium.
Você está VENDO os ${images.length} slides renderizados (imagens em anexo, na ordem).

## Contexto da marca
${brandContext}

## Objetivo da peça
${objective}

## Sua tarefa
Critique com olhar de diretor de arte premiado. Avalie CADA slide e o conjunto:
1. Contraste e legibilidade — algum texto some no fundo? Hierarquia clara entre título/subtítulo/corpo?
2. Composição — respiro, alinhamento, equilíbrio. Parece "desenhado" ou parece template genérico?
3. Tipografia — tamanhos contrastantes, consistência entre slides, no máximo 2 famílias.
4. Cor — coerente com a marca, ousada quando cabe, sem "lavar" a peça.
5. Imagens — bem usadas, sem texto embutido, com foco adequado.
6. Consistência entre slides — mesma linguagem visual, ritmo de variação.
7. Sinais de "AI slop" — gradientes roxos clichê, layout previsível, falta de caráter.

Seja exigente: a régua é "um designer humano postaria isso sem retrabalho?".

Responda APENAS com JSON:
{
  "reasoning": "sua análise visual, slide a slide e do conjunto",
  "approved": boolean,
  "score": number (0-100),
  "deviations": [
    { "type": "content|visual|brand|overflow|missing-zone", "severity": "minor|major|critical", "slideIndex": number (0-based — use o número do rótulo "Slide N" da imagem: slideIndex = N - 1), "description": "o que está errado VISUALMENTE", "fix": "instrução concreta de correção" }
  ],
  "feedback": "mensagem curta para o usuário",
  "correctionInstructions": "instrução consolidada para regenerar (só se não aprovado)"
}`;

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [{ text: prompt }];
  images.forEach((b64, i) => {
    const real = realIndexes?.[i] ?? i;
    parts.push({ text: `--- Slide ${real + 1} ---` });
    parts.push({ inlineData: { mimeType: 'image/png', data: b64 } });
  });

  try {
    const response = await generateWithRetry(
      ai,
      {
        model: VISION_MODEL,
        contents: [{ role: 'user', parts }],
        config: { responseMimeType: 'application/json' },
      },
      VISION_MODEL,
    );
    const raw = response.text ?? '{}';
    // Gemini 3.x às vezes anexa texto após o JSON; extractJsonObject é robusto a isso.
    const result = extractJsonObject(raw) as ReviewResult;
    return {
      reasoning: result.reasoning,
      approved: result.approved ?? true,
      score: typeof result.score === 'number' ? result.score : 70,
      deviations: Array.isArray(result.deviations) ? result.deviations : [],
      feedback: result.feedback ?? 'Revisão concluída',
      correctionInstructions: result.correctionInstructions,
    };
  } catch (err) {
    logger.error('Revisão visual falhou; aprovando por segurança', { error: (err as Error).message });
    return { approved: true, score: 70, deviations: [], feedback: 'Revisão visual parcial', correctionInstructions: undefined };
  }
}

// ── Crítico do caminho HTML: render fiel (chromium) -> visão ────────────────────
export async function runHtmlReviewer(content: HtmlDesignContent, brandContext: string, objective: string): Promise<ReviewResult> {
  let images: string[] = [];
  // Amostra ESPALHADA pelo deck (capa, encerramento e o meio distribuído) —
  // antes era slice(0, 8): num deck de 200, 96% dos slides nunca eram vistos
  // e o slide 150 quebrado passava reto pelo QA.
  const indexes = sampleSlideIndexes(content.slides.length, config.reviewerSampleSize);
  try {
    images = await Promise.all(
      indexes.map((i) =>
        renderHtmlToBase64(buildSlideDocument(content.slides[i]!, content.fonts, content.width, content.height), {
          width: content.width,
          height: content.height,
          maxDim: 768,
        }),
      ),
    );
  } catch (err) {
    logger.error('Render HTML da revisão falhou; aprovando por segurança', { error: (err as Error).message });
    return { approved: true, score: 70, deviations: [], feedback: 'Revisão visual indisponível', correctionInstructions: undefined };
  }
  return critiqueRenderedSlides(images, brandContext, objective, indexes);
}

// ── Caminho legado (Layer model): estrutural + texto, sem visão ─────────────────
async function runLegacyReviewer(
  pages: DesignPage[],
  plan: PlannerOutput,
  brandContext: string,
): Promise<ReviewResult> {
  const structuralDeviations = checkStructural(pages, plan);
  const slideSummary = pages.map((page, i) => {
    const slide = plan.slides[i];
    const textLayers = page.layers?.filter((l) => l.type === 'text') ?? [];
    const imageLayers = page.layers?.filter((l) => l.type === 'image') ?? [];
    const sortedLayers = [...(page.layers ?? [])].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    const compositionSignals = sortedLayers.slice(0, 8).map((layer) => {
      const base = `${layer.type}#${layer.id} z=${layer.zIndex ?? 0} x=${Math.round(layer.x ?? 0)} y=${Math.round(layer.y ?? 0)} w=${Math.round(layer.width ?? 0)} h=${Math.round(layer.height ?? 0)}`;
      if (layer.type === 'text') return `${base} text="${String(layer.content ?? '').slice(0, 60)}"`;
      if (layer.type === 'image') return `${base} image=${layer.url ? 'ok' : 'missing'}`;
      return base;
    }).join(' | ');
    return `Slide ${i} [${slide?.templateId ?? 'unknown'}]:
    - Image Hint Planejado: ${slide?.imageHint ?? 'Nenhum'}
    - ${textLayers.length} layers de texto
    - ${imageLayers.length} layers de imagem
    - Conteúdo dos textos: ${textLayers.slice(0, 3).map((l) => `"${String(l.content ?? '').slice(0, 60)}"`).join(' | ')}
    - Composição: ${compositionSignals}`;
  }).join('\n');

  const prompt = `Você é o Agente Revisor de um sistema de design com IA.

## Contexto da marca
${brandContext}

## Plano original
Objetivo: ${plan.objective}
Arco: ${plan.narrativeArc}
Tom: ${plan.toneAndVoice}
Critérios de qualidade: ${plan.qualityCriteria.join(', ')}

## Design gerado (${pages.length} slides)
${slideSummary}

## Desvios estruturais já detectados
${structuralDeviations.length > 0 ? structuralDeviations.map(d => `- [${d.severity}] Slide ${d.slideIndex}: ${d.description}`).join('\n') : 'Nenhum'}

## Sua tarefa
Avalie o design contra o plano e a marca (conteúdo, tom, hierarquia, consistência).

Responda APENAS com JSON:
{
  "reasoning": "...",
  "approved": boolean,
  "score": number,
  "deviations": [ { "type": "content|visual|brand|overflow|missing-zone", "severity": "minor|major|critical", "slideIndex": number, "description": "...", "fix": "..." } ],
  "feedback": "...",
  "correctionInstructions": "..."
}`;

  const response = await generateWithRetry(ai, {
    model: config.models.fast,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json', temperature: 0.1 },
  }, config.models.fast);

  const raw = response.text ?? '{}';
  const llmResult = JSON.parse(raw) as ReviewResult;

  return {
    ...llmResult,
    deviations: [...structuralDeviations, ...(llmResult.deviations ?? [])],
    approved: llmResult.approved && structuralDeviations.filter(d => d.severity === 'critical').length === 0,
  };
}

/**
 * Escolhe QUAIS slides o crítico visual vai ver.
 *
 * Antes era `slice(0, 8)`: num deck de 200 slides o revisor via só os 8 primeiros
 * — 4% da arte, e sempre o mesmo começo. Um erro do slide 90 nunca era visto, e a
 * amostra nem sequer representava o deck. Agora a amostra é espalhada: capa,
 * encerramento e o resto distribuído por igual. Continua barato (mesmo número de
 * renders e de imagens no prompt), mas passa a olhar o deck todo.
 */
export function sampleSlideIndexes(total: number, max: number): number[] {
  if (total <= 0 || max <= 0) return [];
  if (total <= max) return Array.from({ length: total }, (_, i) => i);

  const escolhidos = new Set<number>([0, total - 1]); // capa e encerramento sempre
  const restantes = max - escolhidos.size;

  for (let i = 1; i <= restantes; i++) {
    escolhidos.add(Math.round((i * (total - 1)) / (restantes + 1)));
  }

  // O arredondamento pode colidir com um índice já escolhido e devolver menos que
  // `max`; completa com os vizinhos ainda livres para não desperdiçar amostra.
  for (let i = 1; i < total - 1 && escolhidos.size < max; i++) escolhidos.add(i);

  return [...escolhidos].sort((a, b) => a - b).slice(0, max);
}

function checkStructural(pages: DesignPage[], plan: PlannerOutput): ReviewDeviation[] {
  const deviations: ReviewDeviation[] = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const slide = plan.slides[i];
    if (!slide) continue;

    const emptyImages = page.layers?.filter(l => l.type === 'image' && !l.url) ?? [];
    for (const layer of emptyImages) {
      deviations.push({
        type: 'missing-zone',
        severity: 'major',
        slideIndex: i,
        description: `Layer de imagem "${layer.id}" sem URL`,
        fix: 'Gerar ou buscar imagem para esta zona',
      });
    }

    const emptyTexts = page.layers?.filter(l => l.type === 'text' && !l.content?.trim()) ?? [];
    for (const layer of emptyTexts) {
      deviations.push({
        type: 'missing-zone',
        severity: 'minor',
        slideIndex: i,
        description: `Layer de texto "${layer.id}" vazio`,
        fix: 'Preencher conteúdo da zona',
      });
    }
  }

  return deviations;
}
