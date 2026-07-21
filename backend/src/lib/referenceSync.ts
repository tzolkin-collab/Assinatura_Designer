import crypto from 'crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from './r2.js';
import { config as appConfig } from '../config.js';
import { isPublicHttpUrlResolved } from './validate.js';
import prisma from './prisma.js';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import { generateWithRetry } from './geminiRetry.js';
import { logger } from './logger.js';

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

export async function analyzeReferenceBackground(refId: string, slug: string, name: string, analysisUrl: string, sourceType: 'WEBSITE' | 'INSTAGRAM') {
  try {
    const brand = await prisma.brand.findUnique({
      where: { slug },
      include: { config: true },
    });

    const brandContext = brand?.config
      ? `Marca: ${brand.name}\nDiretrizes: ${brand.config.guidelines}\nCores: ${brand.config.colors.join(', ')}`
      : `Marca: ${brand?.name || slug}`;

    let imageUrl: string | null = null;
    let externalContent = '';

    try {
      let screenshotUrl = analysisUrl;

      const microlinkUrl = `https://api.microlink.io/?url=${encodeURIComponent(screenshotUrl)}&screenshot=true&meta=false&waitForTimeout=2000`;
      const res = await fetch(microlinkUrl);
      const json = await res.json() as any;
      if (json.status === 'success' && json.data?.screenshot?.url) {
        const imgRes = await fetch(json.data.screenshot.url);
        const arrayBuffer = await imgRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        imageUrl = await uploadBase64ToR2(buffer.toString('base64'), 'image/png');
      }
    } catch (err) {
      logger.error('Erro ao capturar screenshot via Microlink', { url: analysisUrl, error: err instanceof Error ? err.message : String(err) });
    }

    if (sourceType === 'WEBSITE') {
      externalContent = await fetchWebsiteHtml(analysisUrl);
    }
    
    if (sourceType !== 'WEBSITE') {
      externalContent = `Busque e analise o perfil ou post do Instagram fornecido: ${analysisUrl}`;
    }

    const ai = new GoogleGenAI({ apiKey: appConfig.geminiApiKey });

    const prompt = `
Você é um Diretor de Arte Sênior analisando um concorrente/referência para uma marca.
Contexto da Nossa Marca:
${brandContext}

Referência a ser analisada: "${name}" (${analysisUrl})
Tipo de Fonte: ${sourceType}
Conteúdo/Contexto Extraído:
${externalContent}

Sua tarefa é analisar essa referência e retornar um JSON com os seguintes campos exatos:
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

    const result = await generateWithRetry(ai, {
      model: appConfig.models.fast,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: responseSchema,
        tools: sourceType === 'INSTAGRAM' ? [{ googleSearch: {} }] : undefined,
      }
    });

    const parsed = JSON.parse(result.text ?? '{}');
    const insightCount = (parsed.insightsText?.match(/^#{1,3} /gm) || []).length || 3;

    await prisma.reference.update({
      where: { id: refId },
      data: { 
        status: 'ANALYZED',
        imageUrl: imageUrl ?? undefined,
        archetype: parsed.archetype,
        toneOfVoice: parsed.toneOfVoice,
        density: parsed.density,
        palette: parsed.palette,
        markers: parsed.markers ?? [],
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
