import { GoogleGenAI } from '@google/genai';
import { config } from '../../config.js';
import { generateWithRetry } from '../../lib/geminiRetry.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SlideSkeletonItem {
  title: string;
  goal: string;
  layout_type: string;
  order: number;
}

export interface SlidePlan {
  index: number;
  templateId: string;
  purpose: string;
  keyMessage: string;
  imageHint?: string;       // descrição visual para o Image Agent
  decorativeShapes?: any[]; // Array de shapes CSS/SVG gerados pela IA
}

export interface PlannerOutput {
  reasoning?: string;
  objective: string;
  narrativeArc: string;
  visualDirection: string;
  toneAndVoice: string;
  format: 'presentation' | 'carousel';
  dimensions: { width: number; height: number };
  colors: string[];
  fonts: string[];
  slides: SlidePlan[];
  qualityCriteria: string[];
}

// ── Planner (Manager) ──────────────────────────────────────────────────────────

// Teto de sanidade para o número de slides (evita abuso/custo descontrolado).
export const MAX_SLIDES = 300;
// Acima disso, planejamos em pedaços — um único call de flash trunca o JSON de
// dezenas/centenas de itens (maxOutputTokens). Cada chunk mantém a continuidade
// do arco recebendo os títulos já planejados.
const PLAN_CHUNK = 20;

function parseSkeletonArray(raw: string): SlideSkeletonItem[] {
  let clean = (raw ?? '[]').trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```json\s*/, '').replace(/```$/, '').trim();
  }
  const parsed = JSON.parse(clean);
  return Array.isArray(parsed) ? (parsed as SlideSkeletonItem[]) : [];
}

// Garante os "bookends" estruturais que os prompts prometem: primeiro slide é
// capa, último é encerramento — independente do que o modelo devolveu.
function enforceBookends(items: SlideSkeletonItem[]): SlideSkeletonItem[] {
  if (items.length === 0) return items;
  items[0] = { ...items[0]!, layout_type: 'title-hero' };
  const last = items.length - 1;
  if (last > 0) items[last] = { ...items[last]!, layout_type: 'closing' };
  return items;
}

function coerceItem(item: Partial<SlideSkeletonItem>, order: number, isFirst: boolean, isLast: boolean): SlideSkeletonItem {
  return {
    title: typeof item?.title === 'string' && item.title.trim() ? item.title : `Slide ${order}`,
    goal: typeof item?.goal === 'string' && item.goal.trim() ? item.goal : 'Apresentar conteúdo de marca',
    layout_type: typeof item?.layout_type === 'string' && item.layout_type.trim()
      ? item.layout_type
      : (isFirst ? 'title-hero' : isLast ? 'closing' : 'content-split'),
    order,
  };
}

export async function runPlanner(params: {
  brief: string;
  brandContext: string;
  format: 'presentation' | 'carousel';
  // Contagem alvo explícita (ex.: extraída do brief). Sem ela, o modelo escolhe
  // dentro da faixa heurística (comportamento antigo).
  targetSlideCount?: number;
}): Promise<SlideSkeletonItem[]> {
  const target = params.targetSlideCount
    ? Math.max(1, Math.min(MAX_SLIDES, Math.floor(params.targetSlideCount)))
    : undefined;

  // Decks grandes: planeja em chunks para não truncar o JSON.
  if (target && target > PLAN_CHUNK) {
    return runPlannerChunked(params, target);
  }

  const countRule = target
    ? `Gere EXATAMENTE ${target} slides (order de 1 a ${target}).`
    : `Para o formato carrossel, planeje de 4 a 6 slides. Para apresentações, de 6 a 10 slides.`;

  const prompt = `Você é o Agente Manager (Gerente Planejador) de um sistema de design de apresentações com IA.
Sua tarefa é planejar a estrutura lógica (esqueleto) de uma apresentação/carrossel do tipo "${params.format}" baseando-se no briefing e no contexto da marca fornecidos.

Retorne estritamente um array JSON de slides seguindo exatamente este schema:
Array<{
  title: string;       // título sugerido/tema do slide
  goal: string;        // objetivo de conteúdo do slide (o que o slide deve transmitir de forma textual)
  layout_type: string; // sugestão de layout (ex: title-hero, content-split, metrics, quote, closing)
  order: number;       // índice sequencial do slide, começando do 1
}>

Regras Importantes:
1. O primeiro slide (order = 1) deve ser sempre uma capa (ex: title-hero).
2. O último slide deve ser sempre um encerramento ou chamada de ação (ex: closing).
3. Distribua os tipos de slides (layout_type) para criar um ritmo visual dinâmico.
4. ${countRule}
5. Retorne APENAS o array JSON limpo, sem marcações de código markdown (como \`\`\`json).

## Briefing do usuário:
${params.brief}

## Contexto da marca:
${params.brandContext}

## Sua resposta (array JSON puro):`;

  const response = await generateWithRetry(ai, {
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 16384 },
  }, 'gemini-2.5-flash');

  const items = parseSkeletonArray(response.text ?? '[]');

  // Se pediram uma contagem exata, normaliza (o modelo às vezes erra por 1-2).
  if (target) return enforceBookends(normalizeToCount(items, target));
  return enforceBookends(items.map((it, i) => coerceItem(it, i + 1, i === 0, i === items.length - 1)));
}

// Garante exatamente `target` itens: apara excesso e completa faltantes.
function normalizeToCount(items: SlideSkeletonItem[], target: number): SlideSkeletonItem[] {
  const out: SlideSkeletonItem[] = [];
  for (let i = 0; i < target; i++) {
    out.push(coerceItem(items[i] ?? {}, i + 1, i === 0, i === target - 1));
  }
  return out;
}

// ── Planejamento em chunks (decks grandes) ──────────────────────────────────────
async function runPlannerChunked(
  params: { brief: string; brandContext: string; format: 'presentation' | 'carousel' },
  target: number,
): Promise<SlideSkeletonItem[]> {
  const items: SlideSkeletonItem[] = [];

  for (let start = 0; start < target; start += PLAN_CHUNK) {
    const end = Math.min(start + PLAN_CHUNK, target);
    // Janela de continuidade: últimos títulos já planejados.
    const priorTitles = items.slice(-24).map((it) => `${it.order}. ${it.title}`).join('\n');

    const prompt = `Você é o Agente Manager planejando uma apresentação GRANDE de ${target} slides no total (tipo "${params.format}").
Gere APENAS os slides de ${start + 1} a ${end} (${end - start} itens), continuando o arco narrativo de forma coesa e sem repetir o que já foi planejado.

Schema de cada item (array JSON puro, sem markdown):
{ "title": string, "goal": string, "layout_type": string, "order": number }

Regras:
1. order deve ir de ${start + 1} a ${end}, em sequência.
${start === 0 ? '2. O slide 1 é a capa (title-hero).' : '2. NÃO é o início — dê continuidade ao que já existe.'}
${end === target ? `3. O slide ${target} é o encerramento/CTA (closing).` : '3. NÃO é o final — deixe gancho para os próximos.'}
4. Varie os layout_type para ritmo visual.
5. Retorne SÓ o array JSON dos ${end - start} itens.

## Briefing do usuário:
${params.brief.slice(0, 4000)}

## Contexto da marca:
${params.brandContext.slice(0, 1500)}
${priorTitles ? `\n## Slides já planejados (continue a partir daqui):\n${priorTitles}` : ''}

## Sua resposta (array JSON dos slides ${start + 1} a ${end}):`;

    let chunk: SlideSkeletonItem[] = [];
    try {
      const response = await generateWithRetry(ai, {
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 8192 },
      }, 'gemini-2.5-flash');
      chunk = parseSkeletonArray(response.text ?? '[]');
    } catch (err) {
      console.error(`[Planner] chunk ${start + 1}-${end} falhou, preenchendo com fallback:`, err);
    }

    for (let k = 0; k < end - start; k++) {
      const order = start + k + 1;
      items.push(coerceItem(chunk[k] ?? {}, order, order === 1, order === target));
    }
  }

  return enforceBookends(items.slice(0, target));
}
