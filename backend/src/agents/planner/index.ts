import { GoogleGenAI } from '@google/genai';
import { config } from '../../config.js';
import { getTemplatesByCategory } from '../../lib/templates/index.js';
import { generateWithRetry } from '../../lib/geminiRetry.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Planner ───────────────────────────────────────────────────────────────────

export async function runPlanner(params: {
  brief: string;
  brandContext: string;
  format: 'presentation' | 'carousel';
}): Promise<PlannerOutput> {
  const templates = getTemplatesByCategory(params.format);
  const templateList = templates.map(t => `- ${t.id}: ${t.label}`).join('\n');
  const dims = params.format === 'presentation'
    ? { width: 1920, height: 1080 }
    : { width: 1080, height: 1080 };

  const prompt = `Você é o Agente Planejador de um sistema de design com IA.

## Brief do usuário
${params.brief}

## Contexto da marca
${params.brandContext}

## Templates disponíveis (${params.format})
${templateList}

## Sua tarefa
Monte o plano criativo completo. Para cada slide, escolha o templateId mais adequado da lista acima.

Regras:
- O primeiro slide deve ser sempre uma capa (title-hero ou carousel-cover)
- O último slide deve ser sempre encerramento (closing ou carousel-closing)
- Distribua os tipos de slide para criar variedade visual
- Slides com dados/métricas devem usar data-chart ou carousel-data
- Slides com citações devem usar quote ou carousel-quote
- **MUITO IMPORTANTE:** Crie um design RICO EM FOTOS. Inclua SEMPRE um \`imageHint\` descritivo em pelo menos metade dos slides (especialmente capa, encerramento e templates que aceitam imagens) para que o Agente de Imagens possa gerar fotografias reais. NÃO gere uma apresentação inteira só com textos.
- **REGRA GLOBAL SOBRE FOTOS E TEXTO:** NUNCA coloque texto embutido na imagem. O seu \`imageHint\` deve ser PURAMENTE visual e descritivo (ex: 'Foto de montanhas com céu azul'). Se houver necessidade de escrita, ela será tratada nas zonas de texto do slide. Portanto, não inclua overlays, letreiros, placas ou citações embutidas no pedido da foto.
- **CORES E LEITURA:** Ouse na paleta para capas e encerramentos, mas para slides de CONTEÚDO (texto longo, citações, dados), opte SEMPRE por fundo branco (\`#FFFFFF\`) e textos em preto (\`#000000\`) para máxima legibilidade.
- **LIBERDADE CRIATIVA NOS FUNDOS E ENFEITES:** Você tem TOTAL LIBERDADE para usar e abusar de \`decorativeShapes\` para criar fundos com cortes diagonais (ex: usando triângulos/polígonos), efeitos visuais complexos, overlays fotográficos, linhas divisórias finas (ex: \`height: 2\`, \`width: 200\`) ou caixas de destaque. Aja como um Diretor de Arte: não deixe o design vazio.

Responda APENAS com JSON válido:
{
  "reasoning": "sua pausa de raciocínio avaliando o contexto e decidindo a melhor abordagem",
  "objective": "objetivo claro em 1 frase",
  "narrativeArc": "como a história se desenvolve",
  "visualDirection": "direção visual específica",
  "toneAndVoice": "tom e voz",
  "format": "${params.format}",
  "dimensions": { "width": ${dims.width}, "height": ${dims.height} },
  "colors": ["#hex-background-1", "#hex-background-2"],
  "fonts": ["FontName1", "FontName2"],
  "slides": [
    {
      "index": 0,
      "templateId": "template-id",
      "purpose": "papel na narrativa",
      "keyMessage": "mensagem central",
      "imageHint": "descrição visual detalhada para gerar a imagem (ex: 'Foto profissional de mulher em escritório iluminado'). Deixe nulo apenas se não quiser imagem.",
      "decorativeShapes": [
        {
          "type": "shape",
          "shapeType": "rectangle|triangle|polygon|star|line",
          "color": "#hex",
          "opacity": 0.5,
          "width": 100,
          "height": 100,
          "x": 50,
          "y": 50,
          "rotation": 45,
          "borderRadius": 50,
          "gradientType": "linear|radial|none",
          "gradientColor2": "#hex2",
          "zIndex": 0
        }
      ]
    }
  ],
  "qualityCriteria": ["critério 1", "critério 2"]
}`;

  const response = await generateWithRetry(ai, {
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json', temperature: 0.4 },
  }, 'gemini-2.5-flash');

  const raw = response.text ?? '{}';
  return JSON.parse(raw) as PlannerOutput;
}
