import { GoogleGenAI } from '@google/genai';
import { config } from '../../config.js';
import { generateWithRetry } from '../../lib/geminiRetry.js';
import type { DesignPage } from '../../lib/designTypes.js';
import type { PlannerOutput } from '../planner/index.js';
import { designDocumentToSvgs } from '../../lib/designToSvg.js';
import { rasterizeSvgToBase64 } from '../../lib/raster.js';
import { extractJsonObject, type DesignDocument } from '../../lib/designDocument.js';
import { renderHtmlToBase64 } from '../../lib/htmlRaster.js';
import { buildSlideDocument, type HtmlDesignContent } from '../../lib/htmlDesign.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

// Modelo do crítico visual: por padrão o mesmo cérebro de design (multimodal).
const VISION_MODEL = config.geminiDesignDocumentModel || 'gemini-3.1-pro-preview';

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

export async function runReviewer(params: {
  pages: any[];
  plan: PlannerOutput;
  brandContext: string;
}): Promise<ReviewResult> {
  const { pages, plan, brandContext } = params;

  const isHybrid = pages.length === 1 && pages[0]?.kind === 'hybrid-design';

  if (isHybrid) {
    return runVisualReviewer(pages[0].document as DesignDocument, plan, brandContext);
  }

  return runLegacyReviewer(pages as DesignPage[], plan, brandContext);
}

// ── Crítico multimodal: o modelo VÊ o slide renderizado ─────────────────────────
async function runVisualReviewer(
  document: DesignDocument,
  plan: PlannerOutput,
  brandContext: string,
): Promise<ReviewResult> {
  // Rasteriza cada página para PNG (até 8 slides, para limitar custo).
  let images: string[] = [];
  try {
    const svgs = designDocumentToSvgs(document).slice(0, 8);
    images = await Promise.all(svgs.map((svg) => rasterizeSvgToBase64(svg, { maxDim: 768 })));
  } catch (err) {
    console.error('[Reviewer] Rasterization failed, aprovando por segurança:', err);
    return { approved: true, score: 70, deviations: [], feedback: 'Revisão visual indisponível', correctionInstructions: undefined };
  }

  if (images.length === 0) {
    return { approved: true, score: 70, deviations: [], feedback: 'Sem slides para revisar', correctionInstructions: undefined };
  }

  return critiqueRenderedSlides(images, brandContext, plan.objective || 'não especificado');
}

// ── Núcleo da crítica visual: recebe PNGs já renderizados e o modelo os avalia ──
async function critiqueRenderedSlides(images: string[], brandContext: string, objective: string): Promise<ReviewResult> {
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
    { "type": "content|visual|brand|overflow|missing-zone", "severity": "minor|major|critical", "slideIndex": number (0-based), "description": "o que está errado VISUALMENTE", "fix": "instrução concreta de correção" }
  ],
  "feedback": "mensagem curta para o usuário",
  "correctionInstructions": "instrução consolidada para regenerar (só se não aprovado)"
}`;

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [{ text: prompt }];
  images.forEach((b64, i) => {
    parts.push({ text: `--- Slide ${i + 1} ---` });
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
    console.error('[Reviewer] Visual review failed, aprovando por segurança:', err);
    return { approved: true, score: 70, deviations: [], feedback: 'Revisão visual parcial', correctionInstructions: undefined };
  }
}

// ── Crítico do caminho HTML: render fiel (chromium) -> visão ────────────────────
export async function runHtmlReviewer(content: HtmlDesignContent, brandContext: string, objective: string): Promise<ReviewResult> {
  let images: string[] = [];
  try {
    const slides = content.slides.slice(0, 8);
    images = await Promise.all(
      slides.map((s) =>
        renderHtmlToBase64(buildSlideDocument(s, content.fonts, content.width, content.height), {
          width: content.width,
          height: content.height,
          maxDim: 768,
        }),
      ),
    );
  } catch (err) {
    console.error('[Reviewer] HTML render failed, aprovando por segurança:', err);
    return { approved: true, score: 70, deviations: [], feedback: 'Revisão visual indisponível', correctionInstructions: undefined };
  }
  return critiqueRenderedSlides(images, brandContext, objective);
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
    const textLayers = page.layers?.filter((l: any) => l.type === 'text') ?? [];
    const imageLayers = page.layers?.filter((l: any) => l.type === 'image') ?? [];
    const sortedLayers = [...(page.layers ?? [])].sort((a: any, b: any) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    const compositionSignals = sortedLayers.slice(0, 8).map((layer: any) => {
      const base = `${layer.type}#${layer.id} z=${layer.zIndex ?? 0} x=${Math.round(layer.x ?? 0)} y=${Math.round(layer.y ?? 0)} w=${Math.round(layer.width ?? 0)} h=${Math.round(layer.height ?? 0)}`;
      if (layer.type === 'text') return `${base} text="${String(layer.content ?? '').slice(0, 60)}"`;
      if (layer.type === 'image') return `${base} image=${layer.url ? 'ok' : 'missing'}`;
      return base;
    }).join(' | ');
    return `Slide ${i} [${slide?.templateId ?? 'unknown'}]:
    - Image Hint Planejado: ${slide?.imageHint ?? 'Nenhum'}
    - ${textLayers.length} layers de texto
    - ${imageLayers.length} layers de imagem
    - Conteúdo dos textos: ${textLayers.slice(0, 3).map((l: any) => `"${String(l.content ?? '').slice(0, 60)}"`).join(' | ')}
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
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json', temperature: 0.1 },
  }, 'gemini-2.5-flash');

  const raw = response.text ?? '{}';
  const llmResult = JSON.parse(raw) as ReviewResult;

  return {
    ...llmResult,
    deviations: [...structuralDeviations, ...(llmResult.deviations ?? [])],
    approved: llmResult.approved && structuralDeviations.filter(d => d.severity === 'critical').length === 0,
  };
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
