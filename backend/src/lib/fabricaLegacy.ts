import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { generateWithRetry } from './geminiRetry.js';
import type { DesignLayer } from './designTypes.js';
import type { PlannerOutput } from '../agents/planner/index.js';
import type { ContentOutput } from '../agents/content/index.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
const imageAi = new GoogleGenAI({ apiKey: config.nanoBananaApiKey });

export interface VisualRef {
  id: string;
  title: string;
  style: string;
  palette: string[];
  relevance: string;
}

export interface LegacyBrandIdentity {
  name: string;
  guidelines?: string | null;
  colors: string[];
  fonts: string[];
}

export interface InlineImageAsset {
  mimeType: string;
  dataBase64: string;
  name?: string;
  source?: string;
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

export async function generateLegacyTextLayers(
  briefText: string,
  brandContext: string,
  dimensions: { width: number; height: number },
  slideCount: number,
): Promise<Array<{ textLayers: DesignLayer[] }>> {
  const { width: w, height: h } = dimensions;
  const padX = Math.round(w * 0.08);
  const padY = Math.round(h * 0.08);
  const safeX2 = w - padX;
  const safeY2 = h - padY;

  const systemInstruction = `Você é um diretor de arte tipográfico. Posiciona texto com precisão pixel-perfect em designs profissionais para ${slideCount} slides.

Canvas: ${w}×${h}px
Zona segura: x[${padX}–${safeX2}px], y[${padY}–${safeY2}px]
NUNCA posicione texto fora da zona segura.

═══ HIERARQUIA OBRIGATÓRIA — ESCOLHA UMA ESTRUTURA POR SLIDE ═══
TITLE-ONLY → 1 layer: título grande.
TITLE+SUPPORT → 2 layers: título + 1 subtítulo/lead.
TITLE+BODY → 3 layers: título + subtítulo curto + corpo de texto.
FULL-HIERARCHY → 4 layers: eyebrow tag + título + subtítulo + corpo.
NUNCA crie mais de 4 layers de texto por slide. Prefira menos.

═══ REGRAS DE ESPAÇAMENTO ═══
1. GAP mínimo entre layers: max(20, fontSize_anterior × 0.5) px
2. NUNCA sobrepor layers
3. height de cada layer = fontSize × lineHeight × numLinhas
4. O último layer deve caber até ${safeY2}px.

═══ POSICIONAMENTO POR TIPO ═══
Eyebrow: ${Math.round(h * 0.018)}–${Math.round(h * 0.024)}px
Título: ${Math.round(h * 0.075)}–${Math.round(h * 0.11)}px
Subtítulo: ${Math.round(h * 0.038)}–${Math.round(h * 0.052)}px
Corpo: ${Math.round(h * 0.028)}–${Math.round(h * 0.036)}px

═══ CAMPOS OBRIGATÓRIOS ═══
id, type="text", content, x, y, width, height, fontSize, fontFamily, fontWeight, color, textAlign, lineHeight, zIndex, letterSpacing, animationIn, animationDelay, animationDuration, contrastBackground, contrastBackgroundColor, contrastBackgroundOpacity, contrastBackgroundRadius

═══ REGRA GLOBAL DE CONTRASTE ═══
- Se houver foto, imagem, gradiente forte ou fundo visualmente complexo atrás do texto: defina contrastBackground=true.
- Nunca coloque texto diretamente sobre foto sem contrastBackground.

═══ SAÍDA ═══
APENAS array JSON com ${slideCount} objetos: [{ "textLayers": [...] }, ...]
Conteúdo REAL do roteiro — extraia com fidelidade. Nunca placeholder.`;

  const userPrompt = `Contexto da marca:\n${brandContext}\n\nRoteiro gerado (extraia o conteúdo exato de cada slide):\n${briefText.slice(0, 6000)}\n\nCrie as camadas de texto para ${slideCount} slides.`;

  const response = await generateWithRetry(ai, {
    model: config.models.utility,
    contents: userPrompt,
    config: { systemInstruction, responseMimeType: 'application/json' },
  });

  const raw = response.text ?? '[]';
  const parsed = JSON.parse(raw) as unknown;
  const list = Array.isArray(parsed) ? parsed : [];

  return list.map((item: unknown) => ({
    textLayers: Array.isArray((item as Record<string, unknown>)?.textLayers)
      ? (item as Record<string, unknown>).textLayers as DesignLayer[]
      : [],
  }));
}

export function buildLegacyTextBrief(plan: PlannerOutput, content: ContentOutput): string {
  return plan.slides
    .map((slide) => {
      const zones = content[slide.index] ?? {};
      const zoneLines = Object.entries(zones)
        .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
        .map(([zoneId, value]) => `• ${zoneId}: ${value}`)
        .join('\n');

      return [
        `SLIDE ${slide.index + 1} — ${slide.purpose}`,
        `Mensagem central: ${slide.keyMessage}`,
        slide.imageHint ? `Imagem/apoio visual: ${slide.imageHint}` : '',
        zoneLines || '• sem conteúdo textual definido',
      ].filter(Boolean).join('\n');
    })
    .join('\n\n');
}

function inferAspectRatio(width: number, height: number): string {
  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.08) return '1:1';
  if (Math.abs(ratio - 16 / 9) < 0.12) return '16:9';
  if (Math.abs(ratio - 9 / 16) < 0.12) return '9:16';
  if (Math.abs(ratio - 4 / 3) < 0.12) return '4:3';
  if (Math.abs(ratio - 3 / 4) < 0.12) return '3:4';
  if (Math.abs(ratio - 3 / 2) < 0.12) return '3:2';
  if (Math.abs(ratio - 2 / 3) < 0.12) return '2:3';
  return ratio > 1 ? '16:9' : '9:16';
}

function extractGeneratedImageDataUrl(response: unknown): string {
  const directData = typeof (response as { data?: unknown }).data === 'string'
    ? (response as { data: string }).data
    : '';
  if (directData) return `data:image/png;base64,${directData}`;

  const candidates = (response as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }> }).candidates;
  const parts = candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((part) => part.inlineData?.data);
  const imageData = imagePart?.inlineData?.data;
  if (!imageData) return '';
  const mimeType = imagePart?.inlineData?.mimeType || 'image/png';
  return `data:${mimeType};base64,${imageData}`;
}

export async function generateImageAssetForSlide({
  prompt,
  brand,
  refs,
  width,
  height,
  brandCtx,
  projectAssets,
  referenceAsset,
}: {
  prompt: string;
  brand: LegacyBrandIdentity;
  refs: VisualRef[];
  width: number;
  height: number;
  brandCtx: string;
  projectAssets?: InlineImageAsset[];
  referenceAsset?: { mimeType: string; dataBase64: string };
}): Promise<string> {
  const aspectRatio = inferAspectRatio(width, height);
  const referenceBlock = refs.length > 0
    ? refs.map((r, i) => [
        `Referência ${i + 1}: ${r.title}`,
        r.style ? `Direção visual: ${r.style}` : '',
        r.palette.length > 0 ? `Paleta observada: ${r.palette.join(', ')}` : '',
        r.relevance ? `Aplicação nesta imagem: ${r.relevance}` : '',
      ].filter(Boolean).join('\n')).join('\n\n')
    : 'Sem referências explícitas selecionadas; derive a direção visual da marca e do briefing.';

  const assets = projectAssets ?? [];
  const creativePrompt = `Crie uma imagem hero/fundo premium para ser usada em UM slide de apresentação.

PEDIDO DO SLIDE:
${prompt}

MARCA:
Nome: ${brand.name}
Cores oficiais: ${brand.colors.length > 0 ? brand.colors.join(', ') : 'não definidas'}
Fontes oficiais: ${brand.fonts.length > 0 ? brand.fonts.join(', ') : 'não definidas'}
Diretrizes: ${brand.guidelines || 'não definidas'}

CONTEXTO DA APRESENTAÇÃO:
${brandCtx}

REFERÊNCIAS VISUAIS:
${referenceBlock}

ASSETS:
${assets.length > 0 ? assets.map((a, i) => `${i + 1}. ${a.name ?? a.mimeType}${a.source ? ` (${a.source})` : ''}`).join('\n') : 'Nenhum asset visual comum.'}
${referenceAsset ? 'Referência visual anexada: use como direção de composição/estilo, sem copiar literalmente.' : ''}

REGRAS:
- Não coloque texto legível na imagem.
- Não crie logotipos falsos nem marcas d’água.
- Deixe área respirável para o layout receber texto.
- Visual comercial, premium, editorial, claro e alinhado à marca.
- Resultado em ${aspectRatio}.`;

  const contents: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [{ text: creativePrompt }];

  if (referenceAsset) {
    contents.push({ text: 'Referência visual anexada pelo usuário:' });
    contents.push({ inlineData: { mimeType: referenceAsset.mimeType, data: referenceAsset.dataBase64 } });
  }

  for (const asset of assets) {
    contents.push({ text: `Asset do projeto: ${asset.name ?? asset.mimeType}${asset.source ? ` (${asset.source})` : ''}` });
    contents.push({ inlineData: { mimeType: asset.mimeType, data: asset.dataBase64 } });
  }

  const imageModels = ['gemini-3-pro-image-preview', 'gemini-2.5-flash-image'];
  let lastError: unknown;

  for (const model of imageModels) {
    try {
      const response = await imageAi.models.generateContent({
        model,
        contents,
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          temperature: 0.85,
          topP: 0.95,
          imageConfig: {
            aspectRatio,
            imageSize: model === 'gemini-3-pro-image-preview' ? '2K' : '1K',
          },
        },
      });
      const dataUrl = extractGeneratedImageDataUrl(response);
      if (dataUrl) return dataUrl;
      lastError = new Error(`Modelo ${model} não retornou imagem`);
    } catch (error) {
      lastError = error;
      console.warn(`[fabrica:image] ${model} failed:`, error);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Falha ao gerar imagem com Nano Banana');
}

export function deduplicateLayerIds(layers: DesignLayer[]): DesignLayer[] {
  const seen = new Map<string, number>();
  return layers.map((layer) => {
    const base = layer.id ?? 'layer';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? layer : { ...layer, id: `${base}-${count}` };
  });
}

function normalizeHex(hex: unknown): string | null {
  if (typeof hex !== 'string') return null;
  const clean = hex.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(clean)) return clean;
  if (/^#[0-9a-fA-F]{3}$/.test(clean)) {
    const chars = clean.slice(1).split('');
    return `#${chars.map((c) => c + c).join('')}`;
  }
  return null;
}

function luminance(hex: string): number {
  const normalized = normalizeHex(hex) ?? '#ffffff';
  const n = parseInt(normalized.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);
}

function contrastRatio(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function ensureTextContrast(layers: DesignLayer[], backgroundColor: unknown): DesignLayer[] {
  const bg = normalizeHex(backgroundColor) ?? '#ffffff';
  const hasPhotoOrImage = layers.some((layer) => layer?.type === 'image');

  return layers.map((layer) => {
    if (!layer || layer.type !== 'text') return layer;

    const shouldUseWhiteSurface = hasPhotoOrImage
      || layer.contrastBackground === true
      || contrastRatio('#000000', bg) < 4.5;

    return {
      ...layer,
      color: '#000000',
      contrastBackground: shouldUseWhiteSurface,
      contrastBackgroundColor: shouldUseWhiteSurface ? '#ffffff' : layer.contrastBackgroundColor,
      contrastBackgroundOpacity: shouldUseWhiteSurface ? 0.96 : layer.contrastBackgroundOpacity,
      contrastBackgroundRadius: shouldUseWhiteSurface
        ? Math.max(12, Math.round((layer.fontSize ?? 24) * 0.4))
        : layer.contrastBackgroundRadius,
      shadowColor: shouldUseWhiteSurface ? 'rgba(0,0,0,0.08)' : layer.shadowColor,
      shadowBlur: shouldUseWhiteSurface ? Math.max(layer.shadowBlur ?? 0, 10) : layer.shadowBlur,
    };
  });
}

export function finalizeSlideContrast<T extends { backgroundColor?: unknown; layers?: DesignLayer[] }>(slide: T): T {
  return {
    ...slide,
    layers: ensureTextContrast(slide.layers ?? [], slide.backgroundColor),
  };
}
