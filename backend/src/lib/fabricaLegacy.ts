import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { generateWithRetry } from './geminiRetry.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

export interface VisualRef {
  id: string;
  title: string;
  style: string;
  palette: string[];
  relevance: string;
}

export async function researchBrand(
  brandName: string,
  brief: string,
  brandCtx: string,
): Promise<{ summary: string; refs: VisualRef[] }> {
  let researchSummary = '';

  try {
    const resp = await generateWithRetry(ai, {
      model: config.models.utility,
      contents: `Pesquise agora a identidade visual da marca "${brandName}" e o contexto visual para: "${brief.slice(0, 200)}".

Colete especificamente:
1. Estética real do Instagram/site da marca "${brandName}": cores dominantes, tipografia, composição dos posts, mood geral
2. Marcas do mesmo nicho que se posicionam visualmente bem (cite exemplos reais com descrição do que funciona)
3. Tendências visuais 2024-2025 para este segmento (composição, paletas em alta, elementos decorativos)

Responda em português. Seja específico — cite nomes reais, hexes de cores quando identificar, descreva composições.`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    researchSummary = resp.text ?? '';
  } catch {
    researchSummary = '';
  }

  const structurePrompt = `Você é um diretor de arte. Crie 3 referências visuais concretas para guiar este design.

${researchSummary ? `Pesquisa web coletada:\n${researchSummary.slice(0, 1800)}\n\n` : ''}Briefing: "${brief.slice(0, 300)}"
Contexto da marca: ${brandCtx.slice(0, 400)}

REGRA: use referências REAIS da pesquisa quando disponíveis. Não invente marcas ou estilos genéricos.
Descreva composição (assimétrica, centrada, split, full-bleed), tipografia (serif pesada, sans-light, etc.), paleta real.

Retorne APENAS JSON:
{
  "references": [
    {
      "id": "r1",
      "title": "Nome específico",
      "style": "Composição precisa + tipografia + elementos decorativos + ritmo visual",
      "palette": ["#HEX1", "#HEX2", "#HEX3"],
      "relevance": "Por que serve este projeto especificamente"
    }
  ]
}`;

  try {
    const resp = await generateWithRetry(ai, {
      model: config.models.utility,
      contents: structurePrompt,
      config: { responseMimeType: 'application/json' },
    });
    const raw = JSON.parse(resp.text ?? '{"references":[]}') as { references?: VisualRef[] };
    return { summary: researchSummary, refs: raw.references ?? [] };
  } catch {
    return { summary: researchSummary, refs: [] };
  }
}
