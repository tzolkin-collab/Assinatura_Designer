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
import type { DesignIR, SlideNode, ElementNode } from '../../lib/designIR/types.js';
import { compileSlideToDocument } from '../../lib/designIR/compiler.js';
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

// ═══════════════════════════════════════════════════════════════════════════════
// Reviewer do caminho IR (DesignIR)
//
// A crítica VISUAL do IR depende de um compilador IR→HTML que ainda não existe no
// backend (só há renderização React no frontend). Até ele existir, o reviewer do
// IR é DETERMINÍSTICO (checagem estrutural sobre o JSON, sem alucinação, sem
// custo) + uma passada semântica barata (flash) opcional. Quando o compilador
// existir, dá pra plugar `critiqueRenderedSlides` aqui. Ver a nota em
// postHelper.ts e a memória designer-generation-principles.
// ═══════════════════════════════════════════════════════════════════════════════

/** Achata os elementos de um slide, descendo em grupos. */
function flattenElements(elements: ElementNode[] = []): ElementNode[] {
  const out: ElementNode[] = [];
  for (const el of elements) {
    out.push(el);
    if (el.type === 'group' && el.children) out.push(...flattenElements(el.children));
  }
  return out;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const int = parseInt(h, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function relLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const chan = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

/** Razão de contraste WCAG entre duas cores hex. null se alguma não for hex. */
function contrastRatio(fg: string, bg: string): number | null {
  const a = hexToRgb(fg);
  const b = hexToRgb(bg);
  if (!a || !b) return null;
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Área de interseção entre dois retângulos (bounds). */
function intersectionArea(a: ElementNode['bounds'], b: ElementNode['bounds']): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

const PLACEHOLDER_TEXT = /lorem ipsum|placeholder|texto aqui|seu texto|sample text|título aqui|insira/i;

/** Checagem estrutural determinística de um DesignIR. Sem custo, sem alucinação. */
export function checkIRStructural(ir: DesignIR): ReviewDeviation[] {
  const deviations: ReviewDeviation[] = [];
  const W = ir.width;
  const H = ir.height;
  const tolX = Math.round(W * 0.02);
  const tolY = Math.round(H * 0.02);
  const declaredFonts = new Set((ir.fonts ?? []).map((f) => f.toLowerCase()));

  ir.slides.forEach((slide: SlideNode, i: number) => {
    const els = flattenElements(slide.elements);
    const bgSolid = slide.background?.type === 'solid' ? slide.background.color : undefined;

    // Textos visíveis para checagem de sobreposição.
    const textEls = els.filter((e) => e.type === 'text' && (e.content ?? '').trim().length > 0);

    for (const el of els) {
      const b = el.bounds;
      if (!b) continue;

      // 1. Dimensões inválidas
      if (b.width <= 0 || b.height <= 0) {
        deviations.push({ type: 'visual', severity: 'major', slideIndex: i, description: `Elemento "${el.id}" com dimensão inválida (${Math.round(b.width)}x${Math.round(b.height)})`, fix: 'Definir width/height positivos' });
      }

      // 2. Fora do canvas
      const overLeft = b.x < -tolX;
      const overTop = b.y < -tolY;
      const overRight = b.x + b.width > W + tolX;
      const overBottom = b.y + b.height > H + tolY;
      if (overLeft || overTop || overRight || overBottom) {
        const far = b.x + b.width > W * 1.1 || b.y + b.height > H * 1.1 || b.x < -W * 0.1 || b.y < -H * 0.1;
        deviations.push({ type: 'overflow', severity: far ? 'major' : 'minor', slideIndex: i, description: `Elemento "${el.id}" (${el.type}) ultrapassa o canvas ${W}x${H} (x=${Math.round(b.x)} y=${Math.round(b.y)} w=${Math.round(b.width)} h=${Math.round(b.height)})`, fix: 'Reposicionar/redimensionar para caber no canvas' });
      }

      if (el.type === 'text') {
        const content = (el.content ?? '').trim();
        // 3. Texto vazio
        if (content.length === 0) {
          deviations.push({ type: 'content', severity: 'minor', slideIndex: i, description: `Texto "${el.id}" vazio`, fix: 'Preencher com copy real' });
        } else if (PLACEHOLDER_TEXT.test(content)) {
          // 4. Placeholder textual
          deviations.push({ type: 'content', severity: 'major', slideIndex: i, description: `Texto "${el.id}" parece placeholder: "${content.slice(0, 40)}"`, fix: 'Substituir por copy final em português' });
        }

        // 5. Contraste WCAG (só quando fundo é cor sólida hex e texto é hex)
        const fg = el.style?.color;
        const bg = el.style?.backgroundColor ?? bgSolid;
        if (fg && bg) {
          const ratio = contrastRatio(fg, bg);
          if (ratio !== null) {
            const fontSize = el.style?.fontSize ?? 24;
            const isLarge = fontSize >= 24 && (el.style?.fontWeight === 'bold' || Number(el.style?.fontWeight) >= 700) || fontSize >= 32;
            const min = isLarge ? 3 : 4.5;
            if (ratio < min) {
              deviations.push({ type: 'visual', severity: ratio < min * 0.6 ? 'critical' : 'major', slideIndex: i, description: `Contraste insuficiente no texto "${el.id}": ${ratio.toFixed(2)}:1 (mín ${min}:1) — ${fg} sobre ${bg}`, fix: 'Ajustar cor do texto ou do fundo para contraste WCAG AA' });
            }
          }
        }

        // 6. Fonte fora das declaradas
        const fam = el.style?.fontFamily;
        if (fam && declaredFonts.size > 0 && !declaredFonts.has(fam.toLowerCase())) {
          deviations.push({ type: 'brand', severity: 'minor', slideIndex: i, description: `Texto "${el.id}" usa fonte "${fam}" fora das declaradas (${ir.fonts.join(', ')})`, fix: 'Usar uma das fontes do design' });
        }
      }

      // 7. Imagem sem src
      if (el.type === 'image' && !(el.src ?? '').trim()) {
        deviations.push({ type: 'missing-zone', severity: 'major', slideIndex: i, description: `Imagem "${el.id}" sem src`, fix: 'Definir uma URL/asset válido' });
      }
    }

    // 8. Sobreposição forte entre dois textos (>40% do menor)
    for (let a = 0; a < textEls.length; a++) {
      for (let c = a + 1; c < textEls.length; c++) {
        const ta = textEls[a]!;
        const tb = textEls[c]!;
        const inter = intersectionArea(ta.bounds, tb.bounds);
        if (inter <= 0) continue;
        const minArea = Math.min(ta.bounds.width * ta.bounds.height, tb.bounds.width * tb.bounds.height);
        if (minArea > 0 && inter / minArea > 0.4) {
          deviations.push({ type: 'visual', severity: 'major', slideIndex: i, description: `Textos "${ta.id}" e "${tb.id}" se sobrepõem (${Math.round((inter / minArea) * 100)}%)`, fix: 'Separar os blocos de texto para não colidirem' });
        }
      }
    }
  });

  // Limita para não inundar o chat.
  return deviations.slice(0, 40);
}

/** Rasteriza os slides do IR (via compilador) para PNGs base64 — para o crítico visual. */
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

async function renderIRSlides(ir: DesignIR, indexes: number[]): Promise<string[]> {
  return Promise.all(
    indexes.map((i) =>
      renderHtmlToBase64(compileSlideToDocument(ir.slides[i]!, ir.fonts, ir.width, ir.height), {
        width: ir.width,
        height: ir.height,
        maxDim: 768,
      }),
    ),
  );
}

/**
 * Reviewer do caminho IR: estrutural determinístico (sempre) + crítica VISUAL
 * (rasteriza no chromium e o modelo multimodal vê a arte). Se o visual estiver
 * desligado (config.reviewerVisual=false) ou falhar, cai para a passada
 * semântica barata (flash). A crítica visual usa o compilador IR→HTML.
 */
export async function runIRReviewer(params: {
  ir: DesignIR;
  brandContext: string;
  objective: string;
}): Promise<ReviewResult> {
  const { ir, brandContext, objective } = params;

  const structural = checkIRStructural(ir);
  const criticalCount = structural.filter((d) => d.severity === 'critical').length;
  const majorCount = structural.filter((d) => d.severity === 'major').length;
  const minorCount = structural.filter((d) => d.severity === 'minor').length;
  const structuralScore = Math.max(0, 100 - (criticalCount * 30 + majorCount * 12 + minorCount * 4));

  // Camada de julgamento subjetivo: preferimos o crítico VISUAL (vê a arte);
  // se desligado ou falho, caímos na passada semântica textual (flash).
  let llm: ReviewResult | null = null;
  if (config.reviewerVisual) {
    try {
      const amostra = sampleSlideIndexes(ir.slides.length, config.reviewerSampleSize);
      const images = await renderIRSlides(ir, amostra);
      if (images.length > 0) {
        logger.info('Crítica visual do deck', {
          slides: ir.slides.length,
          amostrados: amostra.length,
          indices: amostra,
        });
        llm = await critiqueRenderedSlides(images, brandContext, objective, amostra);

        // O modelo numera os slides pela ORDEM DAS IMAGENS que recebeu. Com amostra
        // salteada isso não é o índice real: sem remapear, o feedback culparia o
        // slide errado (e a correção iria para o slide errado).
        llm = {
          ...llm,
          deviations: (llm.deviations ?? []).map((d) => ({
            ...d,
            slideIndex: amostra[d.slideIndex] ?? d.slideIndex,
          })),
        };
      }
    } catch (err) {
      logger.error('Crítica visual do IR falhou; tentando a semântica', { error: (err as Error).message });
    }
  }
  if (!llm) {
    try {
      llm = await runIRSemanticPass(ir, brandContext, objective, structural);
    } catch (err) {
      logger.error('Passada semântica do IR falhou; usando só a estrutural', { error: (err as Error).message });
    }
  }

  const deviations = [...structural, ...(llm?.deviations ?? [])];
  const score = llm ? Math.round((structuralScore + (typeof llm.score === 'number' ? llm.score : structuralScore)) / 2) : structuralScore;
  // Aprova se não há crítico estrutural E (se o llm rodou) ele aprovou.
  const approved = criticalCount === 0 && (llm ? llm.approved !== false : structuralScore >= 70);

  const feedback = approved
    ? (llm?.feedback ?? 'Revisão automática: sem problemas estruturais bloqueantes.')
    : `Revisão encontrou ${structural.length} problema(s) estrutural(is)${llm ? ' + análise de conteúdo' : ''}.`;

  return {
    reasoning: llm?.reasoning,
    approved,
    score,
    deviations,
    feedback,
    correctionInstructions: llm?.correctionInstructions,
  };
}

async function runIRSemanticPass(ir: DesignIR, brandContext: string, objective: string, structural: ReviewDeviation[]): Promise<ReviewResult> {
  const slideSummary = ir.slides.map((slide, i) => {
    const els = flattenElements(slide.elements);
    const texts = els.filter((e) => e.type === 'text').map((e) => `"${String(e.content ?? '').slice(0, 60)}"`);
    const images = els.filter((e) => e.type === 'image').length;
    return `Slide ${i}: bg=${slide.background?.type ?? '?'} | ${texts.length} textos: ${texts.slice(0, 4).join(' | ')} | ${images} imagens`;
  }).join('\n');

  const prompt = `Você é o Agente Revisor de conteúdo de um sistema de design com IA.
Você NÃO vê a arte renderizada — avalie apenas CONTEÚDO, TOM e CONSISTÊNCIA textual contra a marca e o objetivo.

## Contexto da marca
${brandContext}

## Objetivo da peça
${objective}

## Design gerado (${ir.slides.length} slides)
${slideSummary}

## Desvios estruturais já detectados (não repita)
${structural.length ? structural.map((d) => `- [${d.severity}] Slide ${d.slideIndex}: ${d.description}`).join('\n') : 'Nenhum'}

Responda APENAS com JSON:
{
  "reasoning": "...",
  "approved": boolean,
  "score": number (0-100),
  "deviations": [ { "type": "content|brand", "severity": "minor|major|critical", "slideIndex": number, "description": "...", "fix": "..." } ],
  "feedback": "mensagem curta ao usuário",
  "correctionInstructions": "só se não aprovado"
}`;

  const response = await generateWithRetry(ai, {
    model: config.models.fast,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json', temperature: 0.1 },
  }, config.models.fast);

  const result = extractJsonObject(response.text ?? '{}') as ReviewResult;
  return {
    reasoning: result.reasoning,
    approved: result.approved ?? true,
    score: typeof result.score === 'number' ? result.score : 70,
    deviations: Array.isArray(result.deviations) ? result.deviations : [],
    feedback: result.feedback ?? 'Revisão de conteúdo concluída',
    correctionInstructions: result.correctionInstructions,
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
