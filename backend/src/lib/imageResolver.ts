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
import { ensureRun, recordStep } from './generationTracing.js';
import { config } from '../config.js';
import { generateWithRetry } from './geminiRetry.js';
import { assertWithinBudget, recordUsage, getUsage } from './aiBudget.js';
import { getAiContext } from './aiContext.js';
import { searchUnsplashPhoto } from './unsplash.js';
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
  /** Só relevante para "reuse": o quanto o modelo está certo de que o asset serve
   *  de verdade. "medium" pausa a geração pra pedir aprovação do usuário em vez
   *  de decidir sozinho — ver AmbiguousImageCandidate/resolveSlideImages. */
  confidence?: 'high' | 'medium';
};

export interface AmbiguousImageCandidate {
  slideIndex: number;
  hint: string;
  assetUrl: string;
  assetName: string;
}

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

async function extractPromptFromImage(url: string, brandName: string): Promise<string | null> {
  const asset = await fetchAssetImageBase64(url);
  if (!asset) return null;

  try {
    const response = await generateWithRetry(ai, {
      model: config.models.fast,
      contents: [{
        role: 'user',
        parts: [
          {
            text: `Analise esta fotografia e extraia um prompt de geração de imagem extremamente detalhado (estilo Midjourney) baseado nela. 
Foque em iluminação, composição, cores, ângulos e estilo fotográfico. 
Não inclua nenhum texto, palavras soltas ou logos. Apenas a descrição fotográfica pura.
O objetivo é recriar esta exata sensação visual, mas adaptada para a marca: ${brandName}.
Responda APENAS com o prompt em inglês, sem aspas ou introduções.`,
          },
          { inlineData: { mimeType: asset.mimeType, data: asset.data } },
        ],
      }],
      config: { temperature: 0.2 },
    }, config.models.fast);
    return response.text?.trim() || null;
  } catch (err) {
    logger.warn('Falha ao extrair prompt da imagem do Unsplash para Remix', { error: (err as Error).message });
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
7. Para "reuse", inclua também "confidence": "high" quando o asset é claramente exato pro que o slide pede, ou "medium" quando serve mas não é óbvio (ex.: cobre a ideia geral mas não é uma correspondência perfeita). Decisões "medium" são mostradas pro usuário aprovar antes de usar — não deixe de marcar por medo disso.

Retorne APENAS um array JSON:
[{ "slideIndex": number, "action": ${actionsAllowed}, "assetUrl"?: string, "generatePrompt"?: string, "confidence"?: "high"|"medium" }]`;

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

// ── Passo 2a: gera uma foto/cena via modelo de imagem (bytes crus, sem upload) ──
export async function generatePhotoBuffer(
  prompt: string,
  brandName: string,
  width: number,
  height: number,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const aspectRatio = inferAspectRatio(width, height);
  const creativePrompt = `Crie uma imagem premium, realista e comercial para usar como elemento visual num design de apresentação/social media.

CENA: ${prompt}

MARCA: ${brandName}

REGRAS:
- Sem texto, letras, logotipos falsos ou marcas d'água.
- Deixe área respirável para o layout receber texto por cima se precisar.
- Estética premium, editorial, comercial, alta resolução, foco visual único.
- Resultado em proporção ${aspectRatio}.`;

  // Antes esta função chamava ai.models.generateContent direto, por fora do
  // generateWithRetry — passava batido pelo teto de gasto (assertWithinBudget) E
  // pelo registro de uso (recordUsage), deixando o gasto de gerar fotos invisível
  // no billing. Checa o teto UMA vez (é o mesmo teto pros dois modelos de imagem —
  // não faz sentido tentar o fallback se o teto já estourou) e registra uso a cada
  // tentativa bem-sucedida, mesmo mantendo o loop de fallback próprio (o de
  // generateWithRetry é pra modelo de TEXTO, não serve pra imagem).
  try {
    await assertWithinBudget();
  } catch (err) {
    logger.warn('Geração de foto pulada — teto de IA atingido', { error: (err as Error).message });
    return null;
  }

  const imageModels = [config.models.image, config.models.imageFallback];
  const tentados: string[] = [];
  const inicio = Date.now();
  for (const model of imageModels) {
    tentados.push(model);
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
      await recordUsage(model, response.usageMetadata);
      const dataUrl = extractGeneratedImageDataUrl(response);
      if (!dataUrl) continue;

      const [mimePart, base64] = dataUrl.split(',');
      const mimeType = /^data:(.+);base64$/.exec(mimePart ?? '')?.[1] || 'image/png';

      // O prompt criativo da imagem não existia em lugar nenhum depois da
      // geração — só a foto final. Sem ele não dá para comparar por que uma peça
      // antiga saiu melhor que uma nova.
      const runIdOk = await ensureRun();
      if (runIdOk) {
        recordStep({
          runId: runIdOk,
          kind: 'IMAGE',
          name: 'generatePhotoBuffer',
          model,
          attemptedModels: tentados,
          promptText: creativePrompt,
          inputTokens: response.usageMetadata?.promptTokenCount,
          outputTokens: response.usageMetadata?.candidatesTokenCount,
          latencyMs: Date.now() - inicio,
          metadata: { aspectRatio, width, height, mimeType, bytes: base64?.length ?? 0 },
        });
      }

      return { buffer: Buffer.from(base64 ?? '', 'base64'), mimeType };
    } catch (err) {
      logger.warn(`Geração de foto falhou no modelo ${model}`, { error: (err as Error).message });
    }
  }

  // Falha em todos os modelos também é dado: um slide sem foto tem explicação.
  const runIdFail = await ensureRun();
  if (runIdFail) {
    recordStep({
      runId: runIdFail,
      kind: 'IMAGE',
      name: 'generatePhotoBuffer',
      attemptedModels: tentados,
      promptText: creativePrompt,
      latencyMs: Date.now() - inicio,
      error: 'Nenhum modelo de imagem retornou imagem utilizável',
      metadata: { aspectRatio, width, height },
    });
  }
  return null;
}

// Autoverificação de coerência: manda a foto RECÉM-GERADA de volta pro modelo e
// pergunta se ela corresponde de verdade à cena pedida. Sem isto, uma foto com
// anatomia quebrada ou composição sem sentido ia parar no slide do mesmo jeito —
// a única "revisão" era o reviewer de HTML, que nunca olha o CONTEÚDO da imagem,
// só o layout ao redor dela.
async function critiquePhotoCoherence(buffer: Buffer, mimeType: string, description: string): Promise<boolean> {
  try {
    const response = await generateWithRetry(ai, {
      model: config.models.fast,
      contents: [{
        role: 'user',
        parts: [
          {
            text: `Esta imagem foi gerada por IA pra representar: "${description}".\n\nEla corresponde de verdade a essa cena? Reprove se tiver anatomia/objetos deformados, texto ilegível ou sem sentido embutido na imagem, ou composição visualmente quebrada. Responda SOMENTE com a palavra "aprovado" ou "reprovado".`,
          },
          { inlineData: { mimeType, data: buffer.toString('base64') } },
        ],
      }],
      config: { temperature: 0 },
    }, config.models.fast);

    return /aprovado/i.test((response.text ?? '').trim());
  } catch (err) {
    // Falha na autoverificação (modelo fora do ar, etc.) não deve travar a geração
    // por uma checagem extra — aceita a imagem por padrão.
    logger.warn('Autoverificação de coerência da foto falhou; aceitando a imagem por padrão', { error: (err as Error).message });
    return true;
  }
}

// Fração do teto diário de tokens da marca já consumida — usado pra decidir se
// vale mais buscar uma foto real (Unsplash) do que gerar mais uma por IA.
export async function shouldPreferUnsplashForCost(explicitBrandSlug?: string): Promise<boolean> {
  if (config.aiPhotoFallbackUsageRatio <= 0) return false;
  try {
    const brandSlug = explicitBrandSlug || getAiContext().brandSlug;
    if (!brandSlug) return false;
    
    // Verifica se a marca pediu para ignorar o limite de custo
    const brand = await prisma.brand.findUnique({
      where: { slug: brandSlug },
      include: { config: true }
    });
    if (brand?.config?.ignoreAiCostLimit) return false;

    const usage = await getUsage(brandSlug);
    if (!usage.brandBudget || usage.brandBudget <= 0) return false;

    const ratio = (usage.brandTokens ?? 0) / usage.brandBudget;
    const preferUnsplash = ratio >= config.aiPhotoFallbackUsageRatio;

    // Esta decisão troca arte generativa por banco de imagem por motivo de
    // ORÇAMENTO, e muda a peça sem avisar ninguém. Era invisível: uma arte podia
    // sair pior simplesmente por ter sido gerada perto do fim da cota do dia, e
    // não havia como saber depois. Agora fica no rastro, com os números.
    const runId = await ensureRun();
    if (runId) {
      recordStep({
        runId,
        kind: 'TOOL',
        name: 'shouldPreferUnsplashForCost',
        metadata: {
          preferUnsplash,
          ratio: Number(ratio.toFixed(4)),
          threshold: config.aiPhotoFallbackUsageRatio,
          brandTokens: usage.brandTokens ?? 0,
          brandBudget: usage.brandBudget,
        },
      });
    }

    return preferUnsplash;
  } catch (err) {
    logger.warn('Falha ao checar gasto de IA pra decidir fallback de foto', { error: (err as Error).message });
    return false;
  }
}

export interface ResolvedPhoto {
  url: string;
  source: 'ai-generated' | 'unsplash';
  credit?: string;
}

/**
 * Resolve UMA foto pro slide: IA continua sendo o caminho PRINCIPAL. Unsplash
 * entra como fallback em dois casos — (a) o gasto de IA da marca já está alto
 * (`shouldPreferUnsplashForCost`, tentado ANTES de gerar mais uma) ou (b) a foto
 * gerada foi reprovada na autoverificação de coerência (tentado DEPOIS, como
 * segunda chance antes de desistir). Nunca lança.
 */
async function resolvePhoto(
  prompt: string,
  brandName: string,
  width: number,
  height: number,
  brandId: string,
  imagePreference?: 'force-ai' | 'unsplash' | 'unsplash-remix'
): Promise<ResolvedPhoto | null> {
  let actualPrompt = prompt;

  if (imagePreference === 'unsplash-remix') {
    const fromUnsplash = await searchUnsplashPhoto(prompt, width, height, brandId);
    if (fromUnsplash) {
      logger.info('Remix IA: Extraindo prompt da imagem do Unsplash', { url: fromUnsplash.url });
      const extractedPrompt = await extractPromptFromImage(fromUnsplash.url, brandName);
      if (extractedPrompt) {
        actualPrompt = extractedPrompt;
      }
    }
  } else if (imagePreference === 'unsplash' || (imagePreference !== 'force-ai' && await shouldPreferUnsplashForCost(brandId))) {
    const fromUnsplash = await searchUnsplashPhoto(prompt, width, height, brandId);
    if (fromUnsplash) {
      if (imagePreference !== 'unsplash') logger.info('Gasto de IA elevado — usando foto do Unsplash em vez de gerar', { brandId });
      return { url: fromUnsplash.url, source: 'unsplash', credit: fromUnsplash.photographerName };
    }
    // Unsplash não achou nada bom pro termo — não desiste, tenta gerar mesmo assim.
  }

  const generated = await generatePhotoBuffer(actualPrompt, brandName, width, height);
  if (generated) {
    const aprovada = await critiquePhotoCoherence(generated.buffer, generated.mimeType, actualPrompt);
    if (aprovada) {
      const url = await uploadFileToR2(generated.buffer, `gerado-${Date.now()}.png`, generated.mimeType, `brands/${brandId}/generated`);
      return { url, source: 'ai-generated' };
    }
    logger.info('Foto gerada reprovada na autoverificação de coerência — tentando Unsplash antes de desistir', { prompt: actualPrompt.slice(0, 80) });
  }

  const fallback = await searchUnsplashPhoto(actualPrompt, width, height, brandId);
  if (fallback) return { url: fallback.url, source: 'unsplash', credit: fallback.photographerName };

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
  imagePreference?: 'force-ai' | 'unsplash' | 'unsplash-remix';
}

export interface ResolveSlideImagesResult {
  /** index→resultado (imageUrl OU svgMarkup), pronto pra mesclar no skeleton. */
  resolved: Map<number, ResolvedSlideImage>;
  /** Reuso "medium" (serve mas não é óbvio) — a pipeline PAUSA e pede aprovação
   *  do usuário em vez de decidir sozinha. Vazio na maioria das gerações. */
  pendingCandidates: AmbiguousImageCandidate[];
}

/**
 * Resolve a imagem de cada slide com `imageHint`. Retorna os já resolvidos
 * (imageUrl OU svgMarkup) prontos pra mesclar no skeleton, MAIS candidatos de
 * reuso ambíguos que precisam de aprovação humana antes de virar definitivos —
 * ver `resolveImageCandidateDecisions` pra aplicar a decisão do usuário sobre
 * eles. Nunca lança — falha parcial ou total só significa "menos slides com
 * imagem resolvida", nunca derruba a geração do deck.
 */
export async function resolveSlideImages(params: ResolveSlideImagesParams): Promise<ResolveSlideImagesResult> {
  const results = new Map<number, ResolvedSlideImage>();
  const pendingCandidates: AmbiguousImageCandidate[] = [];

  const slidesNeedingImage = params.skeleton
    .map((item, index) => ({ index, title: item.title, hint: item.imageHint }))
    .filter((s): s is { index: number; title: string; hint: string } => typeof s.hint === 'string' && s.hint.trim().length > 0);

  if (slidesNeedingImage.length === 0) return { resolved: results, pendingCandidates };

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
      const asset = existingAssets.find((a) => a.url === decision.assetUrl);
      if (!asset) continue;

      if (decision.confidence === 'medium') {
        // Serve mas não é óbvio — não decide sozinho, pausa pra aprovação (ver
        // pipeline.ts: pendingImageCandidates). O slide fica SEM imagem por ora;
        // resolveImageCandidateDecisions resolve depois da resposta do usuário.
        const item = params.skeleton.find((_, i) => i === decision.slideIndex);
        pendingCandidates.push({
          slideIndex: decision.slideIndex,
          hint: item?.imageHint ?? '',
          assetUrl: asset.url,
          assetName: asset.name,
        });
      } else {
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
      const photo = await resolvePhoto(decision.generatePrompt, params.brandName, params.width, params.height, params.brandId, params.imagePreference);
      if (photo) {
        generatedCount++;
        results.set(decision.slideIndex, { imageUrl: photo.url });
        const name = photo.source === 'unsplash'
          ? `Unsplash — foto de ${photo.credit ?? 'autor desconhecido'}`
          : `IA — ${decision.generatePrompt.slice(0, 60)}`;
        await prisma.asset.create({
          data: {
            brandId: params.brandId,
            uploadedBy: params.createdById,
            postId: params.postId,
            name,
            url: photo.url,
            fileType: photo.source === 'unsplash' ? 'image/jpeg' : 'image/png',
            sizeBytes: 0,
            source: photo.source,
            tags: [photo.source],
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

  return { resolved: results, pendingCandidates };
}

/**
 * Aplica a decisão do usuário sobre o bundle de candidatos ambíguos (aprovado no
 * chat, ver pipeline.ts `pendingImageCandidates`): "accept" usa o asset da
 * biblioteca que já estava sugerido; "regenerate" gera uma foto nova pra esses
 * slides em vez de reaproveitar. Nunca lança.
 */
export async function resolveImageCandidateDecisions(
  candidates: AmbiguousImageCandidate[],
  decision: 'accept' | 'regenerate',
  params: Pick<ResolveSlideImagesParams, 'brandName' | 'width' | 'height' | 'brandId' | 'createdById' | 'postId' | 'imagePreference'>,
): Promise<Map<number, ResolvedSlideImage>> {
  const results = new Map<number, ResolvedSlideImage>();

  if (decision === 'accept') {
    for (const c of candidates) results.set(c.slideIndex, { imageUrl: c.assetUrl });
    return results;
  }

  for (const c of candidates) {
    const photo = await resolvePhoto(c.hint, params.brandName, params.width, params.height, params.brandId, params.imagePreference);
    if (!photo) continue;
    results.set(c.slideIndex, { imageUrl: photo.url });
    const name = photo.source === 'unsplash'
      ? `Unsplash — foto de ${photo.credit ?? 'autor desconhecido'}`
      : `IA — ${c.hint.slice(0, 60)}`;
    await prisma.asset.create({
      data: {
        brandId: params.brandId,
        uploadedBy: params.createdById,
        postId: params.postId,
        name,
        url: photo.url,
        fileType: photo.source === 'unsplash' ? 'image/jpeg' : 'image/png',
        sizeBytes: 0,
        source: photo.source,
        tags: [photo.source],
      },
    }).catch((err) => logger.error('Falha ao salvar imagem gerada na biblioteca', { error: (err as Error).message }));
  }

  return results;
}
