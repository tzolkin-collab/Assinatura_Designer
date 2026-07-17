import { GoogleGenAI } from '@google/genai';
import { config } from '../../config.js';
import { getTemplate } from '../../lib/templates/index.js';
import { generateWithRetry } from '../../lib/geminiRetry.js';
import type { PlannerOutput, SlidePlan } from '../planner/index.js';
import type { SemanticZone } from '../../lib/templates/types.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

// zoneId → texto preenchido
export type SlideContent = Record<string, string>;
// slideIndex → SlideContent
export type ContentOutput = Record<number, SlideContent>;

export async function runContent(params: {
  plan: PlannerOutput;
  brandContext: string;
}): Promise<ContentOutput> {
  const { plan, brandContext } = params;

  // Constrói o prompt descrevendo todos os slides e suas zonas de texto
  const slidesSpec = plan.slides.map((slide: SlidePlan) => {
    const template = getTemplate(slide.templateId);
    if (!template) return null;

    const textZones = template.semanticZones.filter((z: SemanticZone) => z.type === 'text');
    const zonesDesc = textZones.map((z: SemanticZone) =>
      `    - ${z.id} (role: ${z.role ?? z.id}, maxChars: ${z.maxChars ?? '∞'}${z.optional ? ', opcional' : ''})`
    ).join('\n');

    return `Slide ${slide.index} [${slide.templateId}]
  Propósito: ${slide.purpose}
  Mensagem-chave: ${slide.keyMessage}
  Zonas de texto:
${zonesDesc}`;
  }).filter(Boolean).join('\n\n');

  const prompt = `Você é o Agente de Conteúdo de um sistema de design com IA.

## Contexto da marca
${brandContext}

## Direção criativa
- Objetivo: ${plan.objective}
- Arco narrativo: ${plan.narrativeArc}
- Tom e voz: ${plan.toneAndVoice}

## Slides a preencher
${slidesSpec}

## Sua tarefa
Gere o conteúdo textual para cada zona de cada slide. Respeite:
- maxChars de cada zona (conte com precisão)
- Tom e voz da marca
- O arco narrativo (cada slide constrói sobre o anterior)
- Zonas opcionais: só preencha se o conteúdo for relevante

Responda APENAS com JSON:
{
  "reasoning": "sua pausa de raciocínio avaliando o tom, a narrativa e o conteúdo de cada slide",
  "slides": [
    {
      "index": 0,
      "zones": {
        "zoneId": "texto da zona",
        "outroZoneId": "texto"
      }
    }
  ]
}`;

  const response = await generateWithRetry(ai, {
    model: config.models.fast,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json', temperature: 0.6 },
  }, config.models.fast);

  const raw = response.text ?? '{}';
  const parsed = JSON.parse(raw) as { slides: Array<{ index: number; zones: SlideContent }> };

  const output: ContentOutput = {};
  for (const slide of parsed.slides ?? []) {
    output[slide.index] = slide.zones;
  }
  return output;
}
