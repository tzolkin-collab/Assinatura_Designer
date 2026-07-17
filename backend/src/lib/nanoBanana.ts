import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { generateWithRetry } from './geminiRetry.js';

const ai = new GoogleGenAI({ apiKey: config.nanoBananaApiKey });

export interface Layer {
  id: string;
  type: 'text' | 'image' | 'shape';
  content?: string;
  url?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  textAlign?: 'left' | 'center' | 'right';
  lineHeight?: number;
  opacity?: number;
  borderRadius?: number;
  zIndex: number;
  contrastBackground?: boolean;
  contrastBackgroundColor?: string;
  contrastBackgroundOpacity?: number;
  contrastBackgroundRadius?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
}

export interface DesignState {
  format: 'carousel' | 'single' | 'story';
  width: number;
  height: number;
  backgroundColor: string;
  layers: Layer[];
}

export type DesignDimensions = {
  width: number;
  height: number;
};

export type ReferenceInlineAsset = {
  mimeType: string;
  dataBase64: string;
};

export type ProjectInlineImage = {
  mimeType: string;
  dataBase64: string;
  name?: string;
};

export type TextZone = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
};

export type TextZonesPerSlide = Array<{
  slide: number;
  zones: TextZone[];
}>;

// ── Post-generation validation: clamp all layers within canvas bounds ──────────
function validateLayers(layers: Layer[], canvasW: number, canvasH: number): Layer[] {
  return layers
    .filter(l => l && typeof l === 'object')
    .map(l => {
      const x = Math.max(0, Math.min(Math.round(l.x), canvasW - 1));
      const y = Math.max(0, Math.min(Math.round(l.y), canvasH - 1));
      const width = Math.max(1, Math.min(Math.round(l.width), canvasW - x));
      const height = Math.max(1, Math.min(Math.round(l.height), canvasH - y));
      return { ...l, x, y, width, height };
    });
}

export async function generateDesign(
  prompt: string,
  brandContext: string,
  format: 'carousel' | 'single' | 'story' = 'single',
  dimensionsOverride?: DesignDimensions,
  referenceText?: string,
  referenceAssets?: ReferenceInlineAsset[],
  projectAssets?: ProjectInlineImage[],
  textZonesPerSlide?: TextZonesPerSlide,
): Promise<DesignState[]> {
  const fallbackDimensions = {
    carousel: { width: 1080, height: 1080 },
    single: { width: 1080, height: 1080 },
    story: { width: 1080, height: 1920 },
  }[format];

  const dimensions =
    dimensionsOverride &&
    typeof dimensionsOverride.width === 'number' &&
    typeof dimensionsOverride.height === 'number' &&
    Number.isFinite(dimensionsOverride.width) &&
    Number.isFinite(dimensionsOverride.height)
      ? {
          width: Math.max(256, Math.floor(dimensionsOverride.width)),
          height: Math.max(256, Math.floor(dimensionsOverride.height)),
        }
      : fallbackDimensions;

  const slideTarget = typeof (brandContext.match(/Slides:\s*(\d+)/) || [])[1] === 'string'
    ? parseInt((brandContext.match(/Slides:\s*(\d+)/) || ['', '6'])[1] || '6', 10)
    : 6;

  const hasTextZones = textZonesPerSlide && textZonesPerSlide.length === slideTarget;

  const textZoneInstruction = hasTextZones
    ? `CRÍTICO — ZONAS DE TEXTO JÁ POSICIONADAS:
Os textos já foram gerados com posições exatas. NÃO crie layers do tipo "text".
Para cada slide, as zonas ocupadas pelos textos estão listadas como JSON abaixo.
Você DEVE manter essas zonas livres de shapes opacas (opacity >= 0.7).
Se uma shape precisar cruzar uma zona, use opacity <= 0.35 e cores que mantenham contraste com o texto.

Zonas por slide (coordenadas em pixels, origem top-left):
${JSON.stringify(textZonesPerSlide, null, 2)}

Estratégia recomendada:
- Fundo (zIndex 0-1): cobre canvas inteiro, backgroundColor já define a base
- Decorações (zIndex 2-4): blocos de cor nas BORDAS e cantos — longe das zonas de texto
- Imagens (zIndex 3-5): nas áreas sem texto, ou com overlay escuro apenas nas zonas sem texto
- Nunca coloque uma shape sólida (opacity > 0.35) sobre uma zona de texto`
    : `ESTRITAMENTE PROIBIDO criar layers do tipo "text". Os textos são gerados por um sistema separado com posicionamento preciso.
Use APENAS layers do tipo "shape" e "image". Sua função é exclusivamente visual: fundos, formas geométricas, degradês e imagens decorativas.
Qualquer layer com type="text" será descartado automaticamente.`;

  // Extract brand colors for concrete guidance
  const colorMatch = brandContext.match(/Cores da marca:\s*([^\n]+)/);
  const brandColors = colorMatch ? colorMatch[1].trim() : '';
  const colorGuidance = brandColors
    ? `Paleta da marca disponível: ${brandColors}
Use exclusivamente estas cores para shapes e fundos. Não invente novas cores.
Escolha combinações com contraste adequado: fundos escuros com texto claro, fundos claros com texto escuro.`
    : 'Use cores harmoniosas e profissionais.';

  // Grid anchors for composition guidance
  const W = dimensions.width;
  const H = dimensions.height;
  const padX = Math.round(W * 0.05);
  const padY = Math.round(H * 0.05);

  const systemInstruction = `Você é o NanoBanana, motor de design visual profissional. Cria FUNDOS, FORMAS e IMAGENS que sustentam tipografia.

CANVAS: ${W}×${H}px
PALETA: ${colorGuidance}

CONTEXTO DA MARCA:
${brandContext}

═══ ORÇAMENTO DE LAYERS POR SLIDE (LIMITE ABSOLUTO: 7 layers) ═══
• 1 BACKGROUND  (obrigatório, zIndex 0) — cobre 100% do canvas
• 1 ELEMENTO ESTRUTURAL (obrigatório, zIndex 1-2) — ancora a composição
• 2–4 ACENTOS (opcionais, zIndex 2-4) — pequenos, criam ritmo
• 0–1 IMAGEM (opcional, zIndex 3-5) — apenas se assets disponíveis
TOTAL: nunca mais de 7 layers.

═══ PADRÕES DE COMPOSIÇÃO — escolha UM por slide ═══

A) FULL-BLEED-GRADIENT
   Background: cor principal → cor secundária, ângulo 120–145°, cobre ${W}×${H}
   Elemento estrutural: barra horizontal height=${Math.round(H * 0.004)}–${Math.round(H * 0.006)}px, y=${Math.round(H * 0.12)} ou y=${Math.round(H * 0.88)}, largura 30–60% do canvas
   Acentos: 1–2 círculos (${Math.round(W * 0.04)}–${Math.round(W * 0.08)}px de diâmetro) nos cantos opostos ao texto

B) SPLIT-PANEL
   Background: cor neutra ou escura, ${W}×${H}
   Elemento estrutural: retângulo cobrindo 35–45% da largura (lado esquerdo OU direito), altura=${H}, cor de destaque sólida
   Acentos: linha vertical de 1–3px na borda do split, opacity 0.6

C) BOTTOM-ANCHOR
   Background: cor base, ${W}×${H}
   Elemento estrutural: shape no terço inferior (y=${Math.round(H * 0.62)}, height=${Math.round(H * 0.38)}), cor de contraste ou gradiente
   Acentos: barra horizontal fina no topo (y=${padY}, height=3px, width=15–25% do canvas)

D) TOP-ACCENT
   Background: cor principal, ${W}×${H}
   Elemento estrutural: barra no topo (y=0, height=${Math.round(H * 0.08)}–${Math.round(H * 0.12)}), cor de destaque forte
   Acentos: 2–3 formas geométricas pequenas no quarto inferior: círculos, linhas ou retângulos

E) FRAME
   Background: cor base, ${W}×${H}
   Elemento estrutural: retângulo borda (stroke visual) — shape de 2–4px de espessura no interior do canvas (x=${padX}, y=${padY}, width=${W - padX * 2}, height=${H - padY * 2}), backgroundColor transparente / opacity 0.3
   Acentos: marcadores de canto (quadrados 8–16px) nos 4 cantos do frame

F) DIAGONAL-CUT
   Background: cor principal, ${W}×${H}
   Elemento estrutural: shape larga cobrindo metade do canvas em diagonal (use borderRadius=0, posicione fora do canvas em x ou y para simular o corte)
   Acentos: linha diagonal fina de 1–2px no sentido do corte

G) HERO-SIDE
   Background: cor escura ou neutra, ${W}×${H}
   Elemento estrutural: grande bloco colorido (50–60% do canvas) em um dos lados, gradiente de dentro para fora
   Acentos: pontos/linhas no lado oposto para equilibrar peso visual

═══ ESPAÇAMENTO E BREATHING ROOM ═══
• ZONA LIVRE MÍNIMA: pelo menos 25% da área do canvas deve ser fundo sem shapes opacas (o "ar" do design)
• MARGEM DE SEGURANÇA: nenhum acento entra em x<${padX}, x>${W - padX}, y<${padY}, y>${H - padY}
• Acentos pequenos: área máxima = ${Math.round(W * 0.12)}×${Math.round(H * 0.12)}px cada
• Dois acentos do mesmo tipo: distância mínima entre centros = ${Math.round(W * 0.2)}px

═══ CONSISTÊNCIA ENTRE SLIDES ═══
• Mesma família de formas (bordRadius similar entre slides)
• Mesma paleta — não introduza novas cores além das da marca
• Varie o PADRÃO (A–G) entre slides — nunca repita o mesmo padrão 3 vezes seguidas

═══ GRADIENTES ═══
• Use gradientType="linear" com gradientColor2 e gradientAngle
• Ângulos favoritos: 120–145° (diagonal sofisticada), 90° (de cima p/baixo), 0° (horizontal)
• Gradiente no fundo: diferença de luminosidade de 5–15% entre cor1 e cor2 (sutil)
• Gradiente em elemento estrutural: pode ser mais dramático (20–40%)

═══ CAMPOS OBRIGATÓRIOS ═══
id (único por slide), type, x, y, width, height, zIndex, opacity
Para shape: color (#HEX), borderRadius
Para image: url ("asset://N")
Opcional mas recomendado: gradientType, gradientColor2, gradientAngle, shadowColor, shadowBlur

${textZoneInstruction}

═══ SAÍDA ═══
APENAS Array JSON de exatamente ${slideTarget} slides:
[{ "backgroundColor": "#HEX", "layers": [...] }, ...]
Zero markdown. Zero comentários. JSON puro.`;

  try {
    const contents: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
    const combinedPrompt = `Crie o design visual para: ${prompt}`;
    contents.push({ text: combinedPrompt });

    if (referenceText && referenceText.trim()) {
      contents.push({ text: `Referência textual:\n${referenceText.trim()}` });
    }

    if (Array.isArray(referenceAssets)) {
      for (const a of referenceAssets) {
        if (!a || typeof a !== 'object') continue;
        if (typeof a.mimeType !== 'string' || !a.mimeType.trim()) continue;
        if (typeof a.dataBase64 !== 'string' || !a.dataBase64.trim()) continue;
        contents.push({ inlineData: { mimeType: a.mimeType, data: a.dataBase64 } });
      }
    }

    const usableProjectAssets = Array.isArray(projectAssets)
      ? projectAssets
          .filter((a) => a && typeof a === 'object')
          .filter((a) => typeof a.mimeType === 'string' && typeof a.dataBase64 === 'string' && a.mimeType.startsWith('image/'))
          .slice(0, 8)
      : [];

    if (usableProjectAssets.length > 0) {
      contents.push({
        text:
          `Você recebeu ${usableProjectAssets.length} imagens para usar no design. ` +
          `Use "asset://N" (N = índice) para referenciar. ` +
          `Lista: ${usableProjectAssets
            .map((a, i) => `${i}:${typeof a.name === 'string' && a.name.trim() ? a.name.trim() : a.mimeType}`)
            .join(', ')}`,
      });
      for (const a of usableProjectAssets) {
        contents.push({ inlineData: { mimeType: a.mimeType, data: a.dataBase64 } });
      }
    }

    const response = await generateWithRetry(ai, {
      model: config.models.utility,
      contents,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
      },
    });

    const raw = response.text ?? '[]';
    const parsed = JSON.parse(raw) as unknown;
    let list: unknown[] = [];
    if (Array.isArray(parsed)) {
      list = parsed;
    }
    
    if (!Array.isArray(parsed) && parsed && typeof parsed === 'object') {
      list = [parsed];
    }

    const normalized = list.map((page) => {
      const p = page && typeof page === 'object' ? (page as Record<string, unknown>) : {};
      const rawLayers = Array.isArray(p.layers) ? (p.layers as Layer[]) : [];
      const visualLayers = rawLayers.filter(l => l && typeof l === 'object' && l.type !== 'text');
      return {
        ...p,
        width: dimensions.width,
        height: dimensions.height,
        layers: validateLayers(visualLayers, dimensions.width, dimensions.height),
      };
    }) as DesignState[];

    if (usableProjectAssets.length === 0) return normalized;

    const assetUrls = usableProjectAssets.map((a) => `data:${a.mimeType};base64,${a.dataBase64}`);
    return normalized.map((p) => {
      const layers = Array.isArray(p.layers) ? p.layers : [];
      const mappedLayers = layers.map((layer) => {
        if (!layer || typeof layer !== 'object') return layer;
        const l = layer as Layer;
        if (typeof l.url !== 'string') return l;
        const m = /^asset:\/\/(\d+)$/.exec(l.url.trim());
        if (!m) return l;
        const idx = parseInt(m[1] || '', 10);
        if (!Number.isFinite(idx) || idx < 0 || idx >= assetUrls.length) return l;
        return { ...l, url: assetUrls[idx] };
      });
      return { ...p, layers: mappedLayers };
    });
  } catch (error: unknown) {
    const status =
      error && typeof error === 'object' && 'status' in error
        ? (error as { status?: unknown }).status
        : undefined;
    if (status === 429) {
      throw new Error('Limite de cota excedido (Free Tier). Por favor, aguarde um minuto e tente novamente.');
    }
    throw error;
  }
}
