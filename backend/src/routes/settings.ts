import { Router, Response, NextFunction } from 'express';
import dns from 'dns/promises';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import bcrypt from 'bcrypt';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import { generateWithRetry } from '../lib/geminiRetry.js';
import { config } from '../config.js';
import type { Prisma, BrandRole } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { getBilling } from '../lib/aiBudget.js';
import { assertBrandAccess, ANY_MEMBER, EDITORS } from '../middleware/brandAccess.js';
import { createError } from '../middleware/errorHandler.js';
import { config as appConfig } from '../config.js';
import { AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';
import { parseBody } from '../lib/validate.js';

export const settingsRouter = Router();

const referenciaSchema = z.object({
  name: z.string({ required_error: 'Reference name is required' }).trim().min(1, 'Reference name is required'),
  analysisUrl: z
    .string({ required_error: 'Reference URL is required for analysis' })
    .trim()
    .min(1, 'Reference URL is required for analysis'),
  sourceType: z.string().optional(),
});

const s3 = new S3Client({
  region: 'auto',
  endpoint: appConfig.r2Endpoint,
  credentials: {
    accessKeyId: appConfig.r2AccessKeyId,
    secretAccessKey: appConfig.r2SecretAccessKey,
  },
});

// Um IP (v4 ou v6 literal) é público? Bloqueia loopback, privado, CGNAT e
// link-local (inclui a metadata 169.254.169.254) e ULA/link-local IPv6.
function isPublicIp(ip: string): boolean {
  const host = ip.toLowerCase();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((n) => n > 255)) return false;
    const [a, b] = o as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;              // link-local + metadata
    if (a === 172 && b >= 16 && b <= 31) return false;     // privado
    if (a === 192 && b === 168) return false;              // privado
    if (a === 100 && b >= 64 && b <= 127) return false;    // CGNAT
    return true;
  }
  if (host.includes(':')) { // IPv6
    if (host === '::' || host === '::1') return false;
    if (host.startsWith('fe80')) return false;             // link-local
    if (host.startsWith('fc') || host.startsWith('fd')) return false; // ULA
    if (host.startsWith('::ffff:')) {                      // IPv4-mapped → valida o v4 embutido
      return isPublicIp(host.slice('::ffff:'.length));
    }
    return true;
  }
  return true;
}

// Guard SSRF síncrono (protocolo + host). Rejeita localhost e IPs privados
// literais. Usado na validação de entrada; o fetch real usa a variante que
// também resolve o DNS (contra rebinding).
function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  const isLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
  if (isLiteral) return isPublicIp(host);
  return true;
}

// Variante para o momento do fetch: além do guard síncrono, resolve o hostname e
// exige que TODOS os IPs resolvidos sejam públicos — fecha o DNS rebinding
// (hostname público apontando para IP interno). Resíduo: janela TOCTOU entre a
// resolução e a conexão (mitigável só com pinning do IP na conexão).
async function isPublicHttpUrlResolved(raw: string): Promise<boolean> {
  if (!isPublicHttpUrl(raw)) return false;
  let host: string;
  try { host = new URL(raw).hostname.toLowerCase(); } catch { return false; }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return true; // literal já validado
  try {
    const results = await dns.lookup(host, { all: true });
    return results.length > 0 && results.every((r) => isPublicIp(r.address));
  } catch {
    return false;
  }
}

// Resolve a marca pelo slug exigindo vínculo do usuário (BrandMember).
// Antes isso comparava `brand.userId`, o que trancava a equipe inteira fora das configurações.
const getBrandId = async (slug: string, userId?: string, roles: BrandRole[] = EDITORS) => {
  const brand = await assertBrandAccess(slug, userId, roles);
  return brand.id;
};

// ── Agent & Branding Config ──

settingsRouter.get('/:slug/config', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const brandId = await getBrandId(req.params.slug as string, req.user?.userId, ANY_MEMBER);
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
    const brandId = await getBrandId(req.params.slug as string, req.user?.userId, ANY_MEMBER);
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
    const { name, analysisUrl, sourceType } = parseBody(referenciaSchema, req.body);

    // Guard de SSRF: só http(s) público. Fica fora do zod porque é mais que formato
    // de URL — resolve o host e barra IPs privados/loopback.
    if (!isPublicHttpUrl(analysisUrl)) throw createError(400, 'URL inválida ou não permitida (apenas http(s) público)');

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
    // Tipado na mão em vez de `@ts-expect-error`: o retorno de `response.json()` varia
    // (`unknown` pelo @types/node, `any` quando a lib DOM entra no projeto), e a
    // diretiva quebrava o build no dia em que a resposta parasse de dar erro.
    const data = (await response.json()) as {
      lighthouseResult?: { audits?: Record<string, { details?: { data?: unknown } } | undefined> };
    } | null;
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
    // Defesa em profundidade: nunca faz fetch server-side de host não-público
    // (resolve o DNS também, contra rebinding).
    if (!(await isPublicHttpUrlResolved(url))) return 'Não foi possível obter o conteúdo HTML.';
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
      model: config.models.fast,
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

// ── GET /api/settings/perfil ──
settingsRouter.get('/perfil', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        asanaToken: true,
        googleAccessToken: true,
        canvaAccessToken: true,
      },
    });

    if (!user) throw createError(404, 'Usuário não encontrado');

    res.json({
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        connections: {
          asana: !!user.asanaToken,
          googleDrive: !!user.googleAccessToken,
          canva: !!user.canvaAccessToken,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── PUT /api/settings/perfil ──
settingsRouter.put('/perfil', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    const { name, password } = req.body as { name?: string; password?: string };

    const updateData: Prisma.UserUpdateInput = {};
    if (name && name.trim().length > 0) {
      updateData.name = name.trim();
    }
    if (password && password.length >= 8) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updateData).length === 0) {
      throw createError(400, 'Nenhum dado válido para atualização fornecido');
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, name: true, email: true, role: true },
    });

    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

// ── DELETE /api/settings/connections/:provider ──
settingsRouter.delete('/connections/:provider', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    const { provider } = req.params;

    const updateData: Prisma.UserUpdateInput = {};
    if (provider === 'asana') {
      updateData.asanaToken = null;
    } else if (provider === 'google') {
      updateData.googleAccessToken = null;
      updateData.googleRefreshToken = null;
      updateData.googleTokenExpiry = null;
    } else if (provider === 'canva') {
      updateData.canvaAccessToken = null;
      updateData.canvaRefreshToken = null;
      updateData.canvaTokenExpiry = null;
      updateData.canvaUserId = null;
      updateData.canvaCodeVerifier = null;
      updateData.canvaOauthState = null;
    } else {
      throw createError(400, 'Provedor de conexão inválido');
    }

    await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    res.json({ message: `Conexão com ${provider} removida com sucesso` });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/settings/tenants ──
settingsRouter.get('/tenants', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user?.role !== 'ADMIN') {
      throw createError(403, 'Acesso exclusivo para administradores');
    }

    const brands = await prisma.brand.findMany({
      include: {
        members: {
          select: {
            role: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
        _count: { select: { posts: true, folders: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ data: brands });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/settings/billing ──
settingsRouter.get('/billing', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user?.role !== 'ADMIN') {
      throw createError(403, 'Acesso exclusivo para administradores');
    }

    const { month } = req.query as { month?: string };
    const report = await getBilling(undefined, month);

    res.json({ data: report });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/settings/agent ──
settingsRouter.get('/agent', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user?.role !== 'ADMIN') {
      throw createError(403, 'Acesso exclusivo para administradores');
    }

    res.json({
      data: {
        models: config.models,
        thinkingBudget: config.geminiThinkingBudget,
        dailyTokenBudget: config.aiDailyTokenBudget,
        brandDailyTokenBudget: config.aiBrandDailyTokenBudget,
      },
    });
  } catch (error) {
    next(error);
  }
});

