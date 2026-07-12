import { Router, Response, NextFunction } from 'express';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import { generateWithRetry } from '../lib/geminiRetry.js';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { createError } from '../middleware/errorHandler.js';
import { config as appConfig } from '../config.js';
import { AuthRequest } from '../middleware/auth.js';

export const settingsRouter = Router();

const s3 = new S3Client({
  region: 'auto',
  endpoint: appConfig.r2Endpoint,
  credentials: {
    accessKeyId: appConfig.r2AccessKeyId,
    secretAccessKey: appConfig.r2SecretAccessKey,
  },
});

// Helper to find brand by slug and verify ownership
const getBrandId = async (slug: string, userId?: string) => {
  const brand = await prisma.brand.findUnique({ where: { slug } });
  if (!brand) throw createError(404, 'Brand not found');
  if (userId && brand.userId !== userId) throw createError(403, 'Forbidden: You do not own this brand');
  return brand.id;
};

// ── Agent & Branding Config ──

settingsRouter.get('/:slug/config', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const brandId = await getBrandId(req.params.slug as string, req.user?.userId);
    const config = await prisma.brandConfig.findUnique({ where: { brandId } });

    res.json({ data: config });
  } catch (error) {
    next(error);
  }
});

settingsRouter.put('/:slug/config', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const brandId = await getBrandId(req.params.slug as string, req.user?.userId);
    const { agentPrompt, primaryFonts, colors, guidelines, logoUrl, presentationConfig } = req.body;

    const normalizedPresentationConfig =
      presentationConfig === undefined
        ? undefined
        : (presentationConfig as Prisma.InputJsonValue);

    const config = await prisma.brandConfig.upsert({
      where: { brandId },
      update: { agentPrompt, primaryFonts, colors, guidelines, logoUrl, presentationConfig: normalizedPresentationConfig },
      create: {
        brandId,
        agentPrompt: agentPrompt || '',
        primaryFonts: primaryFonts || [],
        colors: colors || [],
        guidelines: guidelines || '',
        logoUrl,
        presentationConfig: normalizedPresentationConfig,
      },
    });

    res.json({ data: config });
  } catch (error) {
    next(error);
  }
});

// ── References ──

settingsRouter.get('/:slug/referencias', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const brandId = await getBrandId(req.params.slug as string, req.user?.userId);
    const refs = await prisma.reference.findMany({
      where: { brandId },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ data: refs });
  } catch (error) {
    next(error);
  }
});

settingsRouter.post('/:slug/referencias', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug as string;
    const brandId = await getBrandId(slug, req.user?.userId);
    const { name, analysisUrl, sourceType } = req.body;

    if (!name) throw createError(400, 'Reference name is required');
    if (!analysisUrl) throw createError(400, 'Reference URL is required for analysis');

    const validSourceType = sourceType === 'INSTAGRAM' ? 'INSTAGRAM' : 'WEBSITE';

    const ref = await prisma.reference.create({
      data: { name, analysisUrl, brandId, status: 'PENDING', insights: 0, sourceType: validSourceType },
    });

    // Respond immediately, analyze in background
    res.status(201).json({ data: ref });

    analyzeReferenceBackground(ref.id, slug, name, analysisUrl, validSourceType).catch(console.error);
  } catch (error) {
    next(error);
  }
});

async function uploadBase64ToR2(base64Data: string, mimeType: string): Promise<string> {
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

async function captureWebsiteScreenshot(url: string): Promise<string | null> {
  try {
    const pageSpeedUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?screenshot=true&url=${encodeURIComponent(url)}`;
    const response = await fetch(pageSpeedUrl);
    const data = await response.json();
    // @ts-expect-error PageSpeed response shape is intentionally narrowed here
    const screenshotData = data?.lighthouseResult?.audits?.['final-screenshot']?.details?.data;
    
    if (screenshotData && typeof screenshotData === 'string') {
      // screenshotData format: "data:image/jpeg;base64,..."
      const match = screenshotData.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        const mimeType = match[1];
        const base64Str = match[2];
        return await uploadBase64ToR2(base64Str, mimeType);
      }
    }
  } catch (error) {
    console.error('Error capturing screenshot via PageSpeed:', error);
  }
  return null;
}

async function fetchWebsiteHtml(url: string): Promise<string> {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    const text = await response.text();
    // Keep it reasonable in size by stripping out scripts and styles
    return text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
               .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
               .replace(/<[^>]+>/g, ' ') // strip remaining HTML tags
               .replace(/\s+/g, ' ')
               .substring(0, 15000); // limit to ~15k chars
  } catch {
    return 'Não foi possível obter o conteúdo HTML.';
  }
}

async function analyzeReferenceBackground(refId: string, slug: string, name: string, analysisUrl: string, sourceType: 'WEBSITE' | 'INSTAGRAM') {
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

    if (sourceType === 'WEBSITE') {
      imageUrl = await captureWebsiteScreenshot(analysisUrl);
      externalContent = await fetchWebsiteHtml(analysisUrl);
    }
    
    if (sourceType !== 'WEBSITE') {
      // For Instagram, we rely on Gemini's Google Search grounding to fetch context.
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
      model: 'gemini-2.5-flash',
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
        insightsText: parsed.insightsText, 
        insights: insightCount,
        archetype: parsed.archetype,
        toneOfVoice: parsed.toneOfVoice,
        density: parsed.density,
        palette: parsed.palette || [],
        markers: parsed.markers || [],
        imageUrl: imageUrl,
      },
    });
  } catch (error) {
    console.error('Failed to analyze reference:', error);
    await prisma.reference.update({
      where: { id: refId },
      data: { status: 'FAILED' },
    });
  }
}

settingsRouter.post('/:slug/referencias/:id/screenshot', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug as string;
    const brandId = await getBrandId(slug, req.user?.userId);
    const id = req.params.id as string;

    // Escopa a referência à marca — sem isto, o dono de uma marca poderia mexer
    // em referências de marcas de OUTROS usuários passando um id qualquer.
    const ref = await prisma.reference.findFirst({ where: { id, brandId } });
    if (!ref) throw createError(404, 'Reference not found');
    if (ref.sourceType !== 'WEBSITE' || !ref.analysisUrl) throw createError(400, 'Screenshot only available for WEBSITE references with a URL');

    res.json({ message: 'Screenshot capture started' });

    captureWebsiteScreenshot(ref.analysisUrl)
      .then((imageUrl) => {
        if (imageUrl) {
          return prisma.reference.update({ where: { id }, data: { imageUrl } });
        }
      })
      .catch(console.error);
  } catch (error) {
    next(error);
  }
});

settingsRouter.delete('/:slug/referencias/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug as string;
    const brandId = await getBrandId(slug, req.user?.userId);
    const id = req.params.id as string;
    // Escopa a exclusão à marca do usuário — antes qualquer dono de marca podia
    // deletar referências de marcas alheias passando só o id (cross-tenant).
    const result = await prisma.reference.deleteMany({ where: { id, brandId } });
    if (result.count === 0) throw createError(404, 'Reference not found');
    res.json({ message: 'Reference deleted' });
  } catch (error) {
    return next(error);
  }
});
