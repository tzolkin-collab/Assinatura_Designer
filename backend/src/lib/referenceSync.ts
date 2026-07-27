import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from './r2.js';
import { config as appConfig } from '../config.js';
import { isPublicHttpUrlResolved } from './validate.js';
import prisma from './prisma.js';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import { generateWithRetry } from './geminiRetry.js';
import { logger } from './logger.js';
import { fetchInstagramProfileReview, type InstagramProfileReview } from './apifyInstagram.js';
import { fetchWebsiteReview, type WebsitePage } from './apifyWebsiteCrawler.js';
import { extractJsonObject } from './jsonHelper.js';

interface ReferenceImage {
  base64: string;
  mimeType: string;
}

/** Material bruto coletado via Apify (sem nenhuma chamada ao Gemini ainda) —
 *  usado tanto pelo fluxo automático quanto pelo fluxo de benchmark, que
 *  coleta uma vez e só chama a análise depois que o usuário confirma. */
export interface CollectedMaterial {
  website?: WebsitePage[] | null;
  instagram?: InstagramProfileReview | null;
}

export async function uploadBase64ToR2(base64Data: string, mimeType: string): Promise<string> {
  const inputBuffer = Buffer.from(base64Data, 'base64');
  const extension = mimeType.split('/')[1] || 'jpg';
  const key = `references/${crypto.randomUUID()}.${extension}`;

  await s3.send(new PutObjectCommand({
    Bucket: appConfig.r2BucketName,
    Key: key,
    Body: inputBuffer,
    ContentType: mimeType,
  }));

  return `${appConfig.r2PublicUrl}/${key}`;
}


export async function fetchWebsiteHtml(url: string): Promise<string> {
  try {
    if (!(await isPublicHttpUrlResolved(url))) return 'Não foi possível obter o conteúdo HTML.';
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    const text = await response.text();
    return text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
               .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
               .replace(/<[^>]+>/g, ' ')
               .replace(/\s+/g, ' ')
               .substring(0, 15000);
  } catch {
    return 'Não foi possível obter o conteúdo HTML.';
  }
}

/** Baixa uma imagem de uma URL e devolve em base64 — nunca lança, devolve null em qualquer falha. */
async function downloadImageAsBase64(url: string, fallbackMimeType: string): Promise<ReferenceImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get('content-type')?.split(';')[0] || fallbackMimeType;
    return { base64: buffer.toString('base64'), mimeType };
  } catch {
    return null;
  }
}

/**
 * Só a etapa de coleta (Apify), sem nenhuma chamada ao Gemini — usada tanto
 * pelo fluxo automático (`analyzeReferenceBackground`) quanto pelo fluxo de
 * benchmark, que coleta o material de vários candidatos de uma vez e só
 * chama a análise depois que o usuário confirma quais quer manter.
 *
 * WEBSITE: rastreia até ~5 páginas-chave do domínio via Apify
 * (website-content-crawler) — texto + screenshot de cada uma.
 * INSTAGRAM: busca o perfil (bio/seguidores) + até 12 posts recentes com
 * imagem via Apify (Microlink não presta pra Instagram, ele bloqueia
 * screenshot headless).
 * Nunca lança — falha vira `{}` (nem `website` nem `instagram` setados),
 * deixando `buildAnalysisInputs` cair nos fallbacks de sempre.
 */
export async function collectReferenceMaterial(
  analysisUrl: string,
  sourceType: 'WEBSITE' | 'INSTAGRAM',
): Promise<CollectedMaterial> {
  if (sourceType === 'WEBSITE') {
    const pages = await fetchWebsiteReview(analysisUrl, 5);
    return { website: pages };
  }
  const review = await fetchInstagramProfileReview(analysisUrl, 12);
  return { instagram: review };
}

/**
 * Transforma o material já coletado (ou vazio) em `images`/`externalContent`/
 * `useGoogleSearchFallback` pro Gemini — inclui os MESMOS fallbacks de sempre
 * (screenshot único via Microlink pra site, Google Search grounding pro
 * Instagram) quando a coleta não trouxe nada. Nunca chama a Apify — quem
 * decide se vale coletar de novo é o chamador (`analyzeReferenceBackground`
 * coleta sempre; `analyzeReferenceFromCollectedMaterial` reaproveita o que já
 * foi coletado na etapa de confirmação do benchmark).
 */
async function buildAnalysisInputs(
  analysisUrl: string,
  sourceType: 'WEBSITE' | 'INSTAGRAM',
  collected: CollectedMaterial,
): Promise<{ images: ReferenceImage[]; externalContent: string; useGoogleSearchFallback: boolean }> {
  const images: ReferenceImage[] = [];
  let externalContent = '';
  let useGoogleSearchFallback = false;

  if (sourceType === 'WEBSITE') {
    const pages = collected.website;
    if (pages && pages.length > 0) {
      for (const page of pages) {
        if (page.screenshotUrl) {
          const img = await downloadImageAsBase64(page.screenshotUrl, 'image/jpeg');
          if (img) images.push(img);
        }
      }
      externalContent = pages
        .map((p) => [`Página: ${p.url}`, p.title ? `Título: ${p.title}` : '', p.description ? `Descrição: ${p.description}` : '', p.text].filter(Boolean).join('\n'))
        .join('\n\n---\n\n');
    } else {
      // Sem Apify ou crawler falhou: volta pro screenshot único via Microlink.
      try {
        const microlinkUrl = `https://api.microlink.io/?url=${encodeURIComponent(analysisUrl)}&screenshot=true&meta=false&waitForTimeout=2000`;
        const res = await fetch(microlinkUrl);
        const json = (await res.json()) as any;
        if (json.status === 'success' && json.data?.screenshot?.url) {
          const img = await downloadImageAsBase64(json.data.screenshot.url, 'image/png');
          if (img) images.push(img);
        }
      } catch (err) {
        logger.error('Erro ao capturar screenshot via Microlink', { url: analysisUrl, error: err instanceof Error ? err.message : String(err) });
      }
      externalContent = await fetchWebsiteHtml(analysisUrl);
    }
  } else {
    const review = collected.instagram;
    if (review && (review.posts.length > 0 || review.biography)) {
      for (const post of review.posts) {
        const img = await downloadImageAsBase64(post.imageUrl, 'image/jpeg');
        if (img) images.push(img);
      }
      externalContent = [
        review.fullName ? `Nome: ${review.fullName}` : '',
        review.username ? `Usuário: @${review.username}` : '',
        review.biography ? `Bio: ${review.biography}` : '',
        review.followersCount ? `Seguidores: ${review.followersCount}` : '',
        review.followsCount ? `Seguindo: ${review.followsCount}` : '',
        review.verified ? 'Conta verificada' : '',
        '',
        `Posts recentes analisados (${review.posts.length}):`,
        ...review.posts.map((p, i) => [
          `Post ${i + 1}${p.likesCount ? ` — ${p.likesCount} curtidas` : ''}${p.commentsCount ? `, ${p.commentsCount} comentários` : ''}:`,
          p.caption ? `Legenda: ${p.caption}` : '',
          p.hashtags?.length ? `Hashtags: ${p.hashtags.join(', ')}` : '',
        ].filter(Boolean).join('\n')),
      ].filter(Boolean).join('\n');
    }
    // Sem imagem real (Apify não configurada ou falhou): cai pro fallback
    // antigo — busca por texto, nunca inventa hex sem screenshot (ver prompt).
    if (images.length === 0) {
      externalContent = `Busque e analise o perfil ou post do Instagram fornecido: ${analysisUrl}`;
      useGoogleSearchFallback = true;
    }

    // Concorrente com site E Instagram (fluxo de benchmark): 1 aba só,
    // Instagram é a fonte principal (mais visual) e o site vira contexto
    // extra no MESMO texto — nunca uma segunda referência/aba.
    if (collected.website && collected.website.length > 0) {
      const siteContext = collected.website
        .map((p) => [`Página: ${p.url}`, p.title ? `Título: ${p.title}` : '', p.text].filter(Boolean).join('\n'))
        .join('\n\n');
      externalContent += `\n\nSite oficial (contexto adicional):\n${siteContext}`;
    }
  }

  return { images, externalContent, useGoogleSearchFallback };
}

/**
 * Ponto de entrada padrão: um review completo, não uma foto/página isolada.
 * Coleta o material (Apify) e já dispara a análise em seguida — usado pelo
 * fluxo standalone de "Nova Análise"/"Refazer Análise"/auto-sync legado.
 */
export async function analyzeReferenceBackground(
  refId: string,
  slug: string,
  name: string,
  analysisUrl: string,
  sourceType: 'WEBSITE' | 'INSTAGRAM',
) {
  const collected = await collectReferenceMaterial(analysisUrl, sourceType);
  const { images, externalContent, useGoogleSearchFallback } = await buildAnalysisInputs(analysisUrl, sourceType, collected);

  await runReferenceAnalysis({
    refId, slug, name, analysisUrl, sourceType,
    images, externalContent, useGoogleSearchFallback,
  });
}

/**
 * Entrypoint do fluxo de benchmark: o material já foi coletado na etapa de
 * confirmação (`collectReferenceMaterial`, mostrado ao usuário antes de gastar
 * com a análise) — aqui só falta chamar o Gemini, NUNCA re-chama a Apify.
 */
export async function analyzeReferenceFromCollectedMaterial(
  refId: string,
  slug: string,
  name: string,
  analysisUrl: string,
  sourceType: 'WEBSITE' | 'INSTAGRAM',
  collected: CollectedMaterial,
) {
  const { images, externalContent, useGoogleSearchFallback } = await buildAnalysisInputs(analysisUrl, sourceType, collected);

  await runReferenceAnalysis({
    refId, slug, name, analysisUrl, sourceType,
    images, externalContent, useGoogleSearchFallback,
  });
}

/**
 * Upload manual: a pessoa anexa um print de verdade do Instagram (perfil ou
 * post) direto na UI — contorna de vez o bloqueio de screenshot headless,
 * funciona sempre, sem depender de nenhum scraper de terceiro.
 */
export async function analyzeReferenceWithUploadedImage(
  refId: string,
  slug: string,
  name: string,
  analysisUrl: string,
  sourceType: 'WEBSITE' | 'INSTAGRAM',
  imageBase64: string,
  mimeType: string,
) {
  await runReferenceAnalysis({
    refId, slug, name, analysisUrl, sourceType,
    images: [{ base64: imageBase64, mimeType }],
    externalContent: sourceType === 'WEBSITE' ? await fetchWebsiteHtml(analysisUrl) : `Perfil/post do Instagram: ${analysisUrl}`,
    useGoogleSearchFallback: false,
  });
}

/**
 * O núcleo da análise: prompt + schema + chamada ao Gemini + persistência. Reusado
 * pelo fluxo automático (review completo de várias imagens/páginas via Apify, ou
 * screenshot único via Microlink pra site sem Apify) e pelo upload manual
 * (`analyzeReferenceWithUploadedImage`).
 */
async function runReferenceAnalysis(params: {
  refId: string;
  slug: string;
  name: string;
  analysisUrl: string;
  sourceType: 'WEBSITE' | 'INSTAGRAM';
  /** Todas as imagens reais coletadas (posts do Instagram, páginas do site, ou
   *  o upload manual) — 0 a N. Mandadas juntas pro Gemini pra um review
   *  holístico (consistência visual ao longo de vários posts/páginas), não
   *  uma foto isolada. */
  images: ReferenceImage[];
  externalContent: string;
  /** Sem NENHUMA imagem real, Instagram cai pra Google Search grounding (sinal
   *  fraco, texto-só). Com imagem real, a visão é suficiente e a busca some —
   *  evita "achismo" competindo com o que a IA está realmente vendo. */
  useGoogleSearchFallback: boolean;
}) {
  const { refId, slug, name, analysisUrl, sourceType, images, externalContent, useGoogleSearchFallback } = params;
  try {
    const brand = await prisma.brand.findUnique({
      where: { slug },
      include: { config: true },
    });

    const brandContext = brand?.config
      ? `Marca: ${brand.name}\nDiretrizes: ${brand.config.guidelines}\nCores: ${brand.config.colors.join(', ')}`
      : `Marca: ${brand?.name || slug}`;

    // Sobe TODAS as imagens coletadas pro R2 — antes só a primeira ia pro ar e
    // o resto (até 12 posts do Instagram ou 5 páginas do site) era descartado
    // depois de servir só a análise; agora a galeria completa fica disponível
    // pra aba da referência. `imageUrl` continua sendo a capa (primeira),
    // mantido por compatibilidade com quem só lê esse campo único.
    const uploadedUrls = images.length > 0
      ? await Promise.all(images.map((img) => uploadBase64ToR2(img.base64, img.mimeType)))
      : [];
    const imageUrl = uploadedUrls[0] ?? null;

    const ai = new GoogleGenAI({ apiKey: appConfig.geminiApiKey });

    const prompt = `
Você é um Diretor de Arte Sênior fazendo um REVIEW COMPLETO de um concorrente/referência para uma marca — não a análise de um post ou página isolada, mas do perfil/site como um todo.
Contexto da Nossa Marca:
${brandContext}

Referência a ser analisada: "${name}" (${analysisUrl})
Tipo de Fonte: ${sourceType}
Conteúdo/Contexto Extraído:
${externalContent}
${images.length > 0
  ? `\n${images.length} imagens REAIS estão anexadas a esta mensagem (${sourceType === 'INSTAGRAM' ? 'posts recentes do perfil' : 'páginas do site'}). Baseie "palette" e "density" no que você VÊ nas imagens (cores reais dos pixels, densidade visual real, consistência ou variação ao longo delas) — NÃO invente hex a partir do texto. "archetype" e "toneOfVoice" devem considerar o padrão que se repete nas várias imagens + o texto, não uma imagem isolada.`
  : '\n(Sem imagem disponível — baseie-se no texto/conteúdo acima; para "palette", só inclua cores que estejam EXPLICITAMENTE mencionadas no conteúdo, ou devolva array vazio em vez de inventar hex.)'}

Sua tarefa é analisar essa referência como um todo e retornar um JSON com os seguintes campos exatos:
{
  "archetype": "string (ex: O Sábio, O Criador, etc)",
  "toneOfVoice": "string (ex: Autoridade Direta, Amigável, etc)",
  "density": "string (ex: Baixa (Minimalista), Alta (Informativa))",
  "palette": ["string (hex color 1)", "string (hex color 2)", "string (hex color 3)"],
  "markers": [
    {
      "id": "m1",
      "x": 30, // número de 0 a 100 (posição X no layout)
      "y": 20, // número de 0 a 100 (posição Y no layout)
      "label": "string (insight visual rápido)"
    }
    // retorne exatamente 3 marcadores baseados no que você espera ver no layout
  ],
  "insightsText": "string (Sua análise detalhada em formato Markdown contendo: 1. O que estão fazendo bem, 2. Oportunidades, 3. Sugestões de posts)"
}
`;

    const responseSchema: Schema = {
      type: Type.OBJECT,
      properties: {
        archetype: { type: Type.STRING },
        toneOfVoice: { type: Type.STRING },
        density: { type: Type.STRING },
        palette: { type: Type.ARRAY, items: { type: Type.STRING } },
        markers: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              x: { type: Type.NUMBER },
              y: { type: Type.NUMBER },
              label: { type: Type.STRING },
            },
            required: ['id', 'x', 'y', 'label']
          }
        },
        insightsText: { type: Type.STRING },
      },
      required: ['archetype', 'toneOfVoice', 'density', 'palette', 'markers', 'insightsText']
    };

    // A API do Gemini REJEITA (400 "Tool use with a response mime type... is
    // unsupported") combinar responseMimeType/responseSchema com `tools` — não dá
    // pra pedir grounding (Google Search) E saída estruturada ao mesmo tempo. Sem
    // isto, TODA análise de Instagram sem imagem real (o caminho de fallback)
    // quebrava com 400 e a referência ia direto pra FAILED — o benchmarking de
    // Instagram nunca funcionou de fato, mesmo antes desta rodada de mudanças.
    const usingTools = useGoogleSearchFallback && images.length === 0;

    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
      { text: usingTools ? `${prompt}\n\nRetorne SOMENTE o JSON puro, sem markdown, sem texto antes ou depois.` : prompt },
    ];
    for (const img of images) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
    }

    const result = await generateWithRetry(ai, {
      model: appConfig.models.fast,
      contents: { role: 'user', parts },
      config: usingTools
        ? { tools: [{ googleSearch: {} }] }
        : { responseMimeType: 'application/json', responseSchema: responseSchema },
    });

    const parsed = extractJsonObject(result.text ?? '{}') as {
      archetype?: string;
      toneOfVoice?: string;
      density?: string;
      palette?: string[];
      markers?: unknown[];
      insightsText?: string;
    };
    const insightCount = (parsed.insightsText?.match(/^#{1,3} /gm) || []).length || 3;

    await prisma.reference.update({
      where: { id: refId },
      data: {
        status: 'ANALYZED',
        imageUrl: imageUrl ?? undefined,
        galleryImageUrls: uploadedUrls,
        archetype: parsed.archetype,
        toneOfVoice: parsed.toneOfVoice,
        density: parsed.density,
        palette: parsed.palette,
        markers: (parsed.markers ?? []) as Prisma.InputJsonValue,
        insightsText: parsed.insightsText,
        insights: insightCount,
        lastSyncedAt: new Date()
      }
    });
  } catch (error) {
    logger.error('Error analyzing reference', { refId, error: error instanceof Error ? error.message : String(error) });
    await prisma.reference.update({
      where: { id: refId },
      data: { status: 'FAILED', insightsText: 'Falha ao analisar a referência.' }
    });
  }
}
