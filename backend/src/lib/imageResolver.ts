// Resolve, ANTES do artista escrever HTML, qual imagem cada slide com `imageHint`
// deve usar: reaproveita um asset já existente na Biblioteca de Mídia da marca
// quando ele serve para a premissa do slide, ou gera um novo (foto via modelo de
// imagem, ou SVG via texto para ícone/ilustração vetorial simples) — nunca as duas
// coisas pro mesmo slide. Roda uma vez por deck, num único call de decisão (barato),
// e respeita um teto de gerações por deck (`config.maxGeneratedImagesPerDeck`).
//
// Gerado com sucesso, o asset novo entra na biblioteca (source:'ai-generated') pra
// decks futuros da mesma marca reaproveitarem em vez de gerar de novo — é a regra de
// "reaproveitar, não repetir" pedida pelo dono do produto.

import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { generateWithRetry } from './geminiRetry.js';
import { uploadFileToR2 } from './r2.js';
import prisma from './prisma.js';
import { logger } from './logger.js';
import type { SlideSkeletonItem } from '../agents/planner/index.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

export interface ExistingBrandAsset {
  url: string;
  name: string;
  tags: string[];
}

export interface ResolvedSlideImage {
  imageUrl?: string;
  svgMarkup?: string;
}

type ImageDecision = {
  slideIndex: number;
  action: 'reuse' | 'generate-photo' | 'generate-svg' | 'skip';
  assetUrl?: string;
  generatePrompt?: string;
};

function inferAspectRatio(width: number, height: number): string {
  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.08) return '1:1';
  if (Math.abs(ratio - 16 / 9) < 0.12) return '16:9';
  if (Math.abs(ratio - 9 / 16) < 0.12) return '9:16';
  if (Math.abs(ratio - 4 / 3) < 0.12) return '4:3';
  if (Math.abs(ratio - 3 / 4) < 0.12) return '3:4';
  return ratio > 1 ? '16:9' : '9:16';
}

function extractGeneratedImageDataUrl(response: unknown): string {
  const candidates = (response as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }> }).candidates;
  const parts = candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((part) => part.inlineData?.data);
  const imageData = imagePart?.inlineData?.data;
  if (!imageData) return '';
  const mimeType = imagePart?.inlineData?.mimeType || 'image/png';
  return `data:${mimeType};base64,${imageData}`;
}

const MAX_ASSET_BYTES = 8 * 1024 * 1024; // 8MB — trava contra asset gigante travando o call

// Baixa um asset existente pra mandar de VERDADE (pixel) na decisão de reuso.
// Antes a decisão era só por nome/tags em texto — um asset "banner-verao.jpg"
// tagueado "produto" podia ser reaproveitado num slide que pedia "foto de pessoa
// sorrindo" só por semelhança de texto, sem o modelo nunca ter visto a imagem.
async function fetchAssetImageBase64(url: string): Promise<{ mimeType: string; data: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
    if (!mimeType.startsWith('image/')) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_ASSET_BYTES) return null;
    return { mimeType, data: buffer.toString('base64') };
  } catch (err) {
    logger.warn('Falha ao baixar asset existente pra decisão visual de reuso', { url, error: (err as Error).message });
    return null;
  }
}

// ── Passo 1: decide reaproveitar, gerar ou pular, para cada slide com imageHint ──
async function decideImagePlan(
  slidesNeedingImage: Array<{ index: number; title: string; hint: string }>,
  existingAssets: ExistingBrandAsset[],
  allowGeneratedGraphics: boolean,
  allowSvgLayouts: boolean,
): Promise<ImageDecision[]> {
  if (slidesNeedingImage.length === 0) return [];

  // Baixa os assets em paralelo pra mandar de verdade (pixel) na decisão — não só
  // nome/tags em texto. Falha individual não derruba o plano: some da lista de
  // imagens anexadas, mas o asset continua listado em texto como fallback.
  const assetImages = await Promise.all(existingAssets.map((a) => fetchAssetImageBase64(a.url)));

  const assetsBlock = existingAssets.length > 0
    ? existingAssets.map((a, i) => `${i + 1}. Nome: ${a.name} | Tags: ${a.tags.join(', ') || 'nenhuma'} | URL: ${a.url}${assetImages[i] ? ' | Imagem anexada abaixo como "Asset ' + (i + 1) + '"' : ' | (imagem não pôde ser carregada, avalie só pelo nome/tags)'}`).join('\n')
    : 'Biblioteca vazia — nenhum asset disponível.';

  const slidesBlock = slidesNeedingImage
    .map((s) => `- Slide ${s.index}: "${s.title}" — precisa de: ${s.hint}`)
    .join('\n');

  const actionsAllowed = ['"reuse"', allowGeneratedGraphics ? '"generate-photo"' : null, allowSvgLayouts ? '"generate-svg"' : null, '"skip"']
    .filter(Boolean).join('|');

  const prompt = `Você decide, para cada slide abaixo, se a Biblioteca de Mídia da marca já tem uma imagem que SERVE de verdade pra premissa dele, ou se precisa gerar uma nova.

## Slides que pedem imagem:
${slidesBlock}

## Biblioteca de mídia da marca (assets existentes):
${assetsBlock}

## Regras de decisão:
1. "reuse": SÓ quando um asset da lista corresponde de verdade ao que o slide precisa — julgue pela IMAGEM anexada quando disponível (não só pelo nome/tags; um arquivo mal nomeado pode ser exatamente o que o slide precisa, e um nome parecido pode ser visualmente errado). Não force um encaixe genérico — um asset de "logo" não serve pra "foto de produto em uso".
${allowGeneratedGraphics ? '2. "generate-photo": quando o slide precisa de uma foto/cena realista (produto, pessoa, ambiente) e nada na biblioteca serve de verdade (visualmente).' : '2. Geração de foto está DESLIGADA para esta marca — nunca escolha "generate-photo". Se nada na biblioteca serve, use "skip".'}
${allowSvgLayouts ? '3. "generate-svg": quando o slide precisa de um ícone, ilustração vetorial simples ou gráfico decorativo complexo (não uma foto realista) e nada na biblioteca serve.' : '3. Geração de SVG está DESLIGADA para esta marca — nunca escolha "generate-svg". Se nada na biblioteca serve, use "skip".'}
4. "skip": quando não vale a pena gerar (raro — só se o hint for vago demais pra virar prompt de imagem), ou quando a ação necessária está desligada acima.
5. Para "reuse", "assetUrl" DEVE ser uma URL exata da lista acima.
6. Para "generate-photo"/"generate-svg" (só se permitido), "generatePrompt" é uma descrição visual completa e específica (cena, composição, luz, estilo) pronta pra virar prompt de geração — não repita o hint cru.

Retorne APENAS um array JSON:
[{ "slideIndex": number, "action": ${actionsAllowed}, "assetUrl"?: string, "generatePrompt"?: string }]`;

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [{ text: prompt }];
  existingAssets.forEach((_, i) => {
    const img = assetImages[i];
    if (img) {
      parts.push({ text: `Asset ${i + 1}:` });
      parts.push({ inlineData: img });
    }
  });

  try {
    const response = await generateWithRetry(ai, {
      model: config.models.fast,
      contents: [{ role: 'user', parts }],
      config: { responseMimeType: 'application/json', temperature: 0.2 },
    }, config.models.fast);

    const raw = response.text ?? '[]';
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d): d is ImageDecision =>
      d && typeof d === 'object' && typeof (d as ImageDecision).slideIndex === 'number' && typeof (d as ImageDecision).action === 'string',
    );
  } catch (err) {
    logger.error('Falha ao decidir plano de imagens; nenhum slide vai gerar imagem nesta rodada', { error: (err as Error).message });
    return [];
  }
}

// ── Passo 2a: gera uma foto/cena via modelo de imagem, sobe pro R2 ──────────────
async function generatePhotoAsset(
  prompt: string,
  brandName: string,
  width: number,
  height: number,
  brandId: string,
): Promise<string | null> {
  const aspectRatio = inferAspectRatio(width, height);
  const creativePrompt = `Crie uma imagem premium, realista e comercial para usar como elemento visual num design de apresentação/social media.

CENA: ${prompt}

MARCA: ${brandName}

REGRAS:
- Sem texto, letras, logotipos falsos ou marcas d'água.
- Deixe área respirável para o layout receber texto por cima se precisar.
- Estética premium, editorial, comercial, alta resolução, foco visual único.
- Resultado em proporção ${aspectRatio}.`;

  const imageModels = [config.models.image, config.models.imageFallback];
  for (const model of imageModels) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ text: creativePrompt }],
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          temperature: 0.85,
          imageConfig: { aspectRatio, imageSize: model === config.models.image ? '2K' : '1K' },
        },
      });
      const dataUrl = extractGeneratedImageDataUrl(response);
      if (!dataUrl) continue;

      const [, base64] = dataUrl.split(',');
      const buffer = Buffer.from(base64 ?? '', 'base64');
      const url = await uploadFileToR2(buffer, `gerado-${Date.now()}.png`, 'image/png', `brands/${brandId}/generated`);
      return url;
    } catch (err) {
      logger.warn(`Geração de foto falhou no modelo ${model}`, { error: (err as Error).message });
    }
  }
  return null;
}

// ── Passo 2b: gera SVG (ícone/ilustração vetorial) via texto — inline no HTML ───
async function generateSvgMarkup(prompt: string, brandColors: string[]): Promise<string | null> {
  const svgPrompt = `Crie um ícone ou ilustração vetorial SVG para: ${prompt}

Paleta disponível: ${brandColors.length > 0 ? brandColors.join(', ') : 'livre, harmônica'}

REGRAS:
- Retorne SOMENTE a tag <svg>...</svg> completa e válida, sem markdown, sem explicação.
- viewBox definido, sem width/height fixos em px (o CSS externo controla o tamanho).
- Estilo flat/moderno, poucas cores, traços limpos. Nada fotorrealista — é vetor.
- Sem <script>, sem <foreignObject>, sem referência a recursos externos.`;

  try {
    const response = await generateWithRetry(ai, {
      model: config.models.fast,
      contents: [{ role: 'user', parts: [{ text: svgPrompt }] }],
      config: { temperature: 0.6 },
    }, config.models.fast);

    let raw = (response.text ?? '').trim();
    raw = raw.replace(/^```(?:svg|xml|html)?\s*/i, '').replace(/```$/, '').trim();
    const match = /<svg[\s\S]*?<\/svg>/i.exec(raw);
    return match ? match[0] : null;
  } catch (err) {
    logger.warn('Geração de SVG falhou', { error: (err as Error).message });
    return null;
  }
}

export interface ResolveSlideImagesParams {
  brandId: string;
  brandName: string;
  brandColors: string[];
  width: number;
  height: number;
  skeleton: SlideSkeletonItem[];
  createdById?: string;
  postId?: string;
  /** Configuráveis em Presentation Config da marca. Default true — desligar é opt-out. */
  allowGeneratedGraphics?: boolean;
  allowSvgLayouts?: boolean;
}

/**
 * Resolve a imagem de cada slide com `imageHint`. Retorna um mapa index→resultado
 * (imageUrl OU svgMarkup) pronto pra ser mesclado no skeleton antes de chamar o
 * artista. Nunca lança — falha parcial ou total só significa "menos slides com
 * imagem resolvida", nunca derruba a geração do deck.
 */
export async function resolveSlideImages(params: ResolveSlideImagesParams): Promise<Map<number, ResolvedSlideImage>> {
  const results = new Map<number, ResolvedSlideImage>();

  const slidesNeedingImage = params.skeleton
    .map((item, index) => ({ index, title: item.title, hint: item.imageHint }))
    .filter((s): s is { index: number; title: string; hint: string } => typeof s.hint === 'string' && s.hint.trim().length > 0);

  if (slidesNeedingImage.length === 0) return results;

  // Teto de 8 (era 24): agora cada candidato é BAIXADO e mandado como imagem de
  // verdade na decisão (ver decideImagePlan) — 24 imagens num call estouraria
  // custo/latência à toa. 8 casa com o teto que o artista já usa (assetsBlock).
  const existingAssets = await prisma.asset.findMany({
    where: { brandId: params.brandId, fileType: { startsWith: 'image/' } },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: { url: true, name: true, tags: true },
  }).catch(() => [] as ExistingBrandAsset[]);

  const allowGeneratedGraphics = params.allowGeneratedGraphics !== false;
  const allowSvgLayouts = params.allowSvgLayouts !== false;

  const decisions = await decideImagePlan(slidesNeedingImage, existingAssets, allowGeneratedGraphics, allowSvgLayouts);

  let generatedCount = 0;
  const budget = Math.max(0, config.maxGeneratedImagesPerDeck);

  for (const decision of decisions) {
    if (decision.action === 'reuse' && decision.assetUrl) {
      // Só aceita reuse de um asset que realmente estava na lista oferecida —
      // o modelo às vezes inventa URL parecida.
      if (existingAssets.some((a) => a.url === decision.assetUrl)) {
        results.set(decision.slideIndex, { imageUrl: decision.assetUrl });
      }
      continue;
    }

    if (decision.action === 'skip' || !decision.generatePrompt) continue;
    // Segunda trava (o prompt já pede pra não escolher a ação desligada, isto é
    // o backstop caso o modelo ignore a instrução).
    if (decision.action === 'generate-photo' && !allowGeneratedGraphics) continue;
    if (decision.action === 'generate-svg' && !allowSvgLayouts) continue;

    if (generatedCount >= budget) {
      logger.info('Teto de imagens geradas do deck atingido — slide fica sem imagem', {
        slideIndex: decision.slideIndex,
        budget,
      });
      continue;
    }

    if (decision.action === 'generate-photo') {
      const url = await generatePhotoAsset(decision.generatePrompt, params.brandName, params.width, params.height, params.brandId);
      if (url) {
        generatedCount++;
        results.set(decision.slideIndex, { imageUrl: url });
        await prisma.asset.create({
          data: {
            brandId: params.brandId,
            uploadedBy: params.createdById,
            postId: params.postId,
            name: `IA — ${decision.generatePrompt.slice(0, 60)}`,
            url,
            fileType: 'image/png',
            sizeBytes: 0,
            source: 'ai-generated',
            tags: ['ai-generated'],
          },
        }).catch((err) => logger.error('Falha ao salvar imagem gerada na biblioteca', { error: (err as Error).message }));
      }
    } else if (decision.action === 'generate-svg') {
      const svg = await generateSvgMarkup(decision.generatePrompt, params.brandColors);
      if (svg) {
        generatedCount++;
        results.set(decision.slideIndex, { svgMarkup: svg });
        // SVG fica inline no HTML do slide (não é arquivo hospedado) — não vira
        // Asset da biblioteca; reaproveitamento de SVG é por prompt, não por URL.
      }
    }
  }

  return results;
}
