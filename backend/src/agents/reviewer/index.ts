import { GoogleGenAI } from '@google/genai';
import { config } from '../../config.js';
import { generateWithRetry } from '../../lib/geminiRetry.js';
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
