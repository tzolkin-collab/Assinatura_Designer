import { Router, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import prisma from '../lib/prisma.js';
import { createError } from '../middleware/errorHandler.js';
import { generateDesign, type Layer, type TextZonesPerSlide } from '../lib/nanoBanana.js';
import { fixDesign, type DesignFix, type FixerEvent, type FixerPage, type FixJobContext } from '../lib/designFixer.js';
import { createJob as createFixJob, getJob as getFixJob, broadcastEvent as broadcastFixEvent, addSseClient as addFixSseClient, sendUserInput as sendFixUserInput, waitForUserInput, completeJob as completeFixJob, failJob as failFixJob } from '../lib/fixJobStore.js';
import { AuthRequest } from '../middleware/auth.js';
import { normalizeImage, isSupportedMimeType } from '../lib/imageNormalizer.js';
import { generateWithRetry, generateStreamWithRetry } from '../lib/geminiRetry.js';

import { buildBrandAssistantInstruction, buildBrandContextSummary, resolveBrandContext, type ResolvedBrandContext } from '../lib/brandContext.js';
import { requireBrandRole, EDITORS, type BrandRequest } from '../middleware/brandAccess.js';
import { MAX_SLIDES } from '../agents/planner/index.js';
import { logger } from '../lib/logger.js';
import { deduplicateLayerIds, finalizeSlideContrast } from '../lib/generationUtils.js';
import {
  createGenerationJob,
  getGenerationJob,
  broadcastGenerationEvent,
  addGenerationSseClient,
  completeGenerationJob,
  type GenerationJob,
  type GenerationMode,
} from '../lib/generationJobStore.js';
import {
  CREATE_PLAN,
  type CreateEvent,
  type ConsultQuestion,
  type CreatePlanStep,
  type VisualRef,
} from '../lib/generationEvents.js';


export const aiRouter = Router();

// Toda rota com :slug exige vínculo de edição com a marca (todas aqui geram ou editam
// design). Ficando no `param`, uma rota nova com :slug já nasce protegida — antes o
// slug era resolvido direto no handler e qualquer usuário logado gerava em qualquer marca.
aiRouter.param('slug', (req, res, next) =>
  requireBrandRole(EDITORS)(req as BrandRequest, res as Response, next as NextFunction),
);

// O job store in-memory de geração vive em lib/generationJobStore.ts (genérico
// sobre o evento). failGenerationJob fica aqui porque constrói o evento de erro
// específico do contrato CreateEvent, que é da camada de rotas.
function failGenerationJob(job: GenerationJob<CreateEvent>, message: string): void {
  job.status = 'error';
  job.error = message;
  broadcastGenerationEvent(job, { type: 'error', message });
  completeGenerationJob(job);
  job.status = 'error';
}

// ── Gemini text-layer generator (step 2 of the design pipeline) ──────────────
async function generateTextLayers(
  briefText: string,
  brandContext: string,
  dimensions: { width: number; height: number },
  slideCount: number,
): Promise<Array<{ textLayers: Layer[] }>> {
  const { width: w, height: h } = dimensions;

  // Derived grid anchors
  const padX = Math.round(w * 0.08);      // 8% padding cada lado
  const padY = Math.round(h * 0.08);      // 8% padding topo/base
  const safeX2 = w - padX;
  const safeY2 = h - padY;
  const maxTextW = Math.round(w * 0.75);  // largura máxima de texto (75% do canvas)

  const systemInstruction = `Você é um diretor de arte tipográfico. Posiciona texto com precisão pixel-perfect em designs profissionais para ${slideCount} slides.

Canvas: ${w}×${h}px
Zona segura: x[${padX}–${safeX2}px], y[${padY}–${safeY2}px]
NUNCA posicione texto fora da zona segura.

═══ HIERARQUIA OBRIGATÓRIA — ESCOLHA UMA ESTRUTURA POR SLIDE ═══

TITLE-ONLY     → 1 layer: título grande. Use para slides de impacto/capa.
TITLE+SUPPORT  → 2 layers: título + 1 subtítulo/lead. Máximo.
TITLE+BODY     → 3 layers: título + subtítulo curto + corpo de texto.
FULL-HIERARCHY → 4 layers: eyebrow tag + título + subtítulo + corpo. Máximo absoluto.

NUNCA crie mais de 3 layers de texto por slide. Prefira 2 ou 3 para clareza.
Priorize SEMPRE 1 estrutura hierárquica clara por slide.

═══ REGRAS DE ESPAÇAMENTO (INVIOLÁVEIS) ═══

1. GAP MÍNIMO entre layers: max(25, fontSize_anterior × 0.6) px (aumentado para mais respiro)
   Exemplo: título fontSize=86px → gap ≥ 52px antes do próximo layer.
2. NUNCA sobrepor layers: y_próximo ≥ y_anterior + height_anterior + gap_mínimo
3. height de cada layer = fontSize × lineHeight × numLinhas (arredonde para cima)
   numLinhas = ceil(content.length / charsPerLine) onde charsPerLine ≈ width / (fontSize × 0.55)
4. Após calcular todos os layers, verifique se cabem: último y + height ≤ ${safeY2}. Ajuste y inicial se necessário.

═══ POSICIONAMENTO POR TIPO ═══

Eyebrow/tag (zIndex 10):
  fontSize: ${Math.round(h * 0.018)}–${Math.round(h * 0.024)}px | fontWeight "600" | UPPERCASE no content
  y: ${padY}–${padY + Math.round(h * 0.06)}px (topo da zona segura)
  letterSpacing: 2–3px

Título (zIndex 12):
  fontSize: ${Math.round(h * 0.075)}–${Math.round(h * 0.11)}px | fontWeight "800" ou "bold"
  Sem eyebrow: y = ${padY}–${Math.round(h * 0.28)}px | Com eyebrow: y = eyebrow.y + eyebrow.height + gap
  width: ${Math.round(w * 0.55)}–${Math.round(maxTextW)}px
  letterSpacing: ${Math.round(h * 0.07)}px+ → -2 a -4 | menor → -1 a -2

Subtítulo/lead (zIndex 11):
  fontSize: ${Math.round(h * 0.038)}–${Math.round(h * 0.052)}px | fontWeight "normal" ou "600"
  y: título.y + título.height + gap
  width: ${Math.round(w * 0.5)}–${Math.round(maxTextW)}px
  letterSpacing: -0.5 a 0

Corpo/bullets (zIndex 13):
  fontSize: ${Math.round(h * 0.028)}–${Math.round(h * 0.036)}px | fontWeight "normal"
  y: layer_anterior.y + layer_anterior.height + gap
  width: ${Math.round(w * 0.48)}–${Math.round(w * 0.65)}px | lineHeight: 1.45–1.6
  letterSpacing: 0 a 0.3

═══ ALINHAMENTO ═══
- textAlign "left": x = ${padX}–${Math.round(w * 0.12)}px
- textAlign "center": x = (${w} - width) / 2 (calcule o centro real)
- textAlign "right": x + width = ${safeX2}

═══ ANIMAÇÃO (aplique sempre) ═══
Eyebrow: animationIn="fade", delay=0, duration=0.35
Título: animationIn="slide-up", delay=0.1, duration=0.65
Subtítulo: animationIn="slide-up", delay=0.25, duration=0.5
Corpo: animationIn="fade", delay=0.4, duration=0.45

═══ CAMPOS OBRIGATÓRIOS POR LAYER ═══
id, type="text", content (texto real do roteiro), x, y, width, height,
fontSize, fontFamily (use fonte da marca), fontWeight, color (#HEX contrastante ao fundo),
textAlign, lineHeight, zIndex, letterSpacing, animationIn, animationDelay, animationDuration,
contrastBackground, contrastBackgroundColor, contrastBackgroundOpacity, contrastBackgroundRadius

═══ REGRA GLOBAL DE CONTRASTE — INVIOLÁVEL ═══
- Todo texto precisa ter contraste mínimo perceptível contra o fundo.
- Se o fundo for branco/claro: use texto preto ou muito escuro.
- Se o fundo for preto/escuro: use texto branco ou muito claro.
- Se houver foto, imagem, gradiente forte ou fundo visualmente complexo atrás do texto: defina contrastBackground=true.
- Para contrastBackground=true: use contrastBackgroundColor preto com texto branco, ou branco com texto preto; opacity entre 0.68 e 0.82; borderRadius proporcional ao fontSize.
- Nunca coloque texto diretamente sobre foto sem contrastBackground.

═══ EXEMPLOS DE HIERARQUIA VISUAL ═══

HIERARQUIA BOA:
- Eyebrow: Pequeno, caps, alto contraste.
- Headline: Grande, negrito, peso 800-bold.
- Subtitle: Médio, peso 600, espaçamento adequado.
- Body: Pequeno, peso normal, lineHeight 1.6.

HIERARQUIA RUIM (EVITAR):
- Título sobreposto ao subtítulo.
- Texto sem contraste sobre imagem complexa.
- Múltiplas fontes com pesos similares.
- Espaçamento insuficiente entre elementos.

REGRAS DE HIERARQUIA VISUAL:
1. Limite de 2 fontes por design.
2. Distinção clara entre roles (eyebrow, headline, subtitle, body).
3. Gap mínimo: max(25px, fontSize_anterior × 0.6).
4. NUNCA sobrepor layers.
5. Sempre usar contrastBackground=true para texto sobre imagem.

═══ SAÍDA ═══
APENAS array JSON com ${slideCount} objetos: [{ "textLayers": [...] }, ...]
Conteúdo REAL do roteiro — extraia com fidelidade. Nunca placeholder.
IDs únicos por slide: "title-${0}", "subtitle-${0}", "body-${0}", "tag-${0}" (sufixo = índice do slide).`;

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
      ? (item as Record<string, unknown>).textLayers as Layer[]
      : [],
  }));
}

// GET /api/ai/jobs/:jobId  — generation job status
aiRouter.get('/jobs/:jobId', (req: AuthRequest, res: Response) => {
  const job = getGenerationJob(req.params.jobId as string, req.user?.userId);
  if (!job) return res.status(404).json({ error: 'Job not found or expired' });
  res.json({
    data: {
      id: job.id,
      status: job.status,
      postId: job.postId,
      pages: job.pages,
      error: job.error,
      eventCount: job.events.length,
      expiresAt: job.expiresAt,
    },
  });
});

// GET /api/ai/jobs/:jobId/stream — replayable generation SSE stream
aiRouter.get('/jobs/:jobId/stream', (req: AuthRequest, res: Response) => {
  const job = getGenerationJob(req.params.jobId as string, req.user?.userId);
  if (!job) return res.status(404).json({ error: 'Job not found or expired' });

  const from = Number.parseInt(String(req.query.from ?? '0'), 10);
  const fromEventIndex = Number.isFinite(from) && from > 0 ? from : 0;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  addGenerationSseClient(job, res, fromEventIndex);
});

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

function normalizeDesignDimension(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(256, Math.min(4096, Math.floor(value))) : fallback;
}

// Contagem de slides pedida na geração livre (não é o mesmo teto do `normalizeSlideCount`,
// que serve ao fluxo de posts e para em 12 — aqui apresentações de 50+ são legítimas).
// Sem teto nenhum, `slideCount: 100000` viravam 100k chamadas de IA numa requisição:
// cota e custo iam junto. MAX_SLIDES é o mesmo limite que o planner já aplica.
function normalizeRequestedSlideCount(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(MAX_SLIDES, Math.floor(value)))
    : fallback;
}

function normalizeStringArray(value: unknown, limit = 12): string[] {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()).slice(0, limit)
    : [];
}

async function getBrandContext(brandSlug: string) {
  const brand = await resolveBrandContext(brandSlug);
  return buildBrandAssistantInstruction(brand);
}

// POST /api/ai/:slug/chat
aiRouter.post('/:slug/chat', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { message } = req.body;
    const slug = req.params.slug as string;

    if (!message || typeof message !== 'string') throw createError(400, 'Message is required and must be a string');
    if (!config.geminiApiKey) throw createError(500, 'Gemini API Key is not configured');

    const systemInstruction = await getBrandContext(slug);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await generateStreamWithRetry(ai, {
      model: config.models.utility,
      contents: message,
      config: { systemInstruction: systemInstruction || undefined },
    });

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error: unknown) {
    const status =
      error && typeof error === 'object' && 'status' in error
        ? (error as { status?: unknown }).status
        : undefined;
    if (!res.headersSent) {
      if (status === 429) return next(createError(429, 'Limite de cota excedido. Aguarde um momento.'));
      return next(error);
    }
    
    const msg = status === 429 ? 'Limite de cota excedido' : 'Generation failed midway';
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    res.end();
  }
});

// POST /api/ai/:slug/analyze-benchmark
aiRouter.post('/:slug/analyze-benchmark', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { content } = req.body;
    const slug = req.params.slug as string;

    if (!content) throw createError(400, 'Content is required for analysis');

    const brandContext = await getBrandContext(slug);

    const prompt = `
Contexto da Marca Atual:
${brandContext}

Analise a seguinte referência/concorrente e extraia insights acionáveis para a nossa marca.
Referência:
"${content}"

Por favor, responda com uma análise estruturada (formato Markdown) focada em:
1. O que eles estão fazendo bem.
2. Oportunidades que nossa marca pode explorar.
3. Sugestão de 3 tipos de posts baseados nessa análise.
`;

    const response = await generateWithRetry(ai, {
      model: config.models.utility,
      contents: prompt,
    });

    const insights = response.text ?? 'Nenhum insight gerado.';
    res.json({ data: { insights } });
  } catch (error) {
    next(error);
  }
});

// POST /api/ai/:slug/generate-briefing
aiRouter.post('/:slug/generate-briefing', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { industry, audience, keywords } = req.body;
    const slug = req.params.slug as string;

    if (!industry || !audience) throw createError(400, 'Industry and audience are required');

    const brand = await prisma.brand.findUnique({ where: { slug } });
    if (!brand) throw createError(404, 'Brand not found');

    const prompt = `
Como um Diretor de Arte Especialista em IA, crie as diretrizes de marca (Brand Guidelines) e as instruções do Agente de IA para a marca "${brand.name}".
Setor: ${industry}
Público Alvo: ${audience}
Palavras-chave: ${(keywords || []).join(', ')}

Sua resposta deve estar ESTRITAMENTE no formato JSON com as seguintes chaves:
{
  "guidelines": "Resumo detalhado do tom de voz, identidade visual e regras de comunicação (max 3 parágrafos).",
  "agentPrompt": "Instrução no formato de 'System Prompt' (ex: Você é um assistente de IA focado em... Seu tom deve ser...)",
  "suggestedColors": ["#HEX1", "#HEX2", "#HEX3"]
}
Não retorne Markdown ou outras tags de formatação ao redor do JSON. Apenas o texto JSON puro validável.
`;

    const response = await generateWithRetry(ai, {
      model: config.models.utility,
      contents: prompt,
    });

    let rawText = response.text ?? '{}';
    rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

    let parsedData;
    try {
      parsedData = JSON.parse(rawText);
    } catch {
      throw createError(500, 'Failed to parse Gemini JSON output', 'AI_PARSE_ERROR');
    }

    res.json({ data: parsedData });
  } catch (error) {
    next(error);
  }
});

// POST /api/ai/:slug/extract-from-logo
aiRouter.post('/:slug/extract-from-logo', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { logoData, mimeType } = req.body;
    const slug = req.params.slug as string;

    if (!logoData || typeof logoData !== 'string') throw createError(400, 'logoData is required');
    if (!mimeType || typeof mimeType !== 'string') throw createError(400, 'mimeType is required');
    if (!isSupportedMimeType(mimeType)) throw createError(400, `Tipo não suportado: ${mimeType}`);

    const brand = await prisma.brand.findUnique({ where: { slug } });
    if (!brand) throw createError(404, 'Brand not found');

    // Normaliza para formato aceito pelo Gemini (SVG → PNG, HEIC → JPEG, etc.)
    const inputBuffer = Buffer.from(logoData, 'base64');
    const normalized = await normalizeImage(inputBuffer, mimeType);
    const normalizedB64 = normalized.buffer.toString('base64');

    const prompt = `Analise este logotipo de marca e retorne APENAS um JSON válido com as seguintes chaves:
{
  "colors": ["#HEX1", "#HEX2", "#HEX3", "#HEX4", "#HEX5"],
  "fontRecommendation": "Nome de uma fonte Google Fonts que combina visualmente com este logo (ex: Playfair Display, Montserrat, Raleway)"
}
Extraia as 5 cores dominantes reais presentes no logo como hex codes. Sugira uma fonte que harmonize com o estilo do logo. Retorne apenas JSON puro, sem markdown.`;

    const response = await generateWithRetry(ai, {
      model: config.models.utility,
      contents: {
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType: normalized.mimeType, data: normalizedB64 } },
        ],
      },
    });

    let rawText = response.text ?? '{}';
    rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

    let parsedData: { colors?: string[]; fontRecommendation?: string };
    try {
      parsedData = JSON.parse(rawText);
    } catch {
      throw createError(500, 'Falha ao interpretar resposta da IA');
    }

    res.json({ data: parsedData });
  } catch (error) {
    next(error);
  }
});

// POST /api/ai/:slug/generate-image
aiRouter.post('/:slug/generate-image', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { prompt, width, height, designReferences, brandCtxFromClient, projectAssets, referenceAsset } = req.body as {
      prompt?: unknown;
      width?: unknown;
      height?: unknown;
      designReferences?: unknown;
      brandCtxFromClient?: unknown;
      projectAssets?: unknown;
      referenceAsset?: unknown;
    };
    const slug = req.params.slug as string;

    if (!prompt || typeof prompt !== 'string') throw createError(400, 'Prompt is required');
    if (!config.nanoBananaApiKey) throw createError(500, 'Nano Banana API Key is not configured');

    const brand = await prisma.brand.findUnique({
      where: { slug },
      include: { config: true },
    });
    if (!brand) throw createError(404, 'Brand not found');

    const normalizedWidth =
      typeof width === 'number' && Number.isFinite(width) ? Math.max(256, Math.min(4096, Math.floor(width))) : 1080;
    const normalizedHeight =
      typeof height === 'number' && Number.isFinite(height) ? Math.max(256, Math.min(4096, Math.floor(height))) : 1080;

    const colors = brand.config?.colors || [];
    const fonts = brand.config?.primaryFonts || [];
    const refs = normalizeDesignReferences(designReferences);
    const contextFromClient = typeof brandCtxFromClient === 'string' ? brandCtxFromClient.trim().slice(0, 5000) : '';
    const referenceBlock = refs.length > 0
      ? refs.map((r, i) => [
          `Referência ${i + 1}: ${r.title}`,
          r.style ? `Direção visual: ${r.style}` : '',
          r.palette.length > 0 ? `Paleta observada: ${r.palette.join(', ')}` : '',
          r.relevance ? `Aplicação nesta arte: ${r.relevance}` : '',
        ].filter(Boolean).join('\n')).join('\n\n')
      : 'Sem referências explícitas selecionadas; derive a direção visual da marca e do briefing.';

    const validProjectAssets = Array.isArray(projectAssets)
      ? (projectAssets as unknown[])
          .filter((a) => a && typeof a === 'object')
          .map((a) => a as { mimeType?: unknown; dataBase64?: unknown; name?: unknown; source?: unknown })
          .filter((a) => typeof a.mimeType === 'string' && typeof a.dataBase64 === 'string' && a.mimeType.startsWith('image/'))
          .slice(0, 8)
          .map((a) => ({
            mimeType: a.mimeType as string,
            dataBase64: a.dataBase64 as string,
            name: typeof a.name === 'string' ? a.name : undefined,
            source: typeof a.source === 'string' ? a.source : undefined,
          }))
      : [];

    const validReferenceAsset =
      referenceAsset &&
      typeof referenceAsset === 'object' &&
      typeof (referenceAsset as { mimeType?: unknown }).mimeType === 'string' &&
      typeof (referenceAsset as { dataBase64?: unknown }).dataBase64 === 'string'
        ? {
            mimeType: (referenceAsset as { mimeType: string }).mimeType,
            dataBase64: (referenceAsset as { dataBase64: string }).dataBase64,
          }
        : undefined;

    const brandGuidelines = brand.config?.guidelines ?? '';
    const aspectRatio = inferAspectRatio(normalizedWidth, normalizedHeight);
    const creativePrompt = `Crie uma imagem publicitária premium para ser usada dentro de um layout de apresentação/social post.

BRIEFING PRINCIPAL:
${prompt.trim()}

MARCA:
Nome: ${brand.name}
Cores oficiais: ${colors.length > 0 ? colors.join(', ') : 'não definidas'}
Fontes oficiais: ${fonts.length > 0 ? fonts.join(', ') : 'não definidas'}
Diretrizes: ${brandGuidelines || 'não definidas'}

CONTEXTO ESTRUTURADO DA FÁBRICA:
${contextFromClient || 'não enviado'}

REFERÊNCIAS VISUAIS QUE DEVEM GUIAR A IMAGEM:
${referenceBlock}

ASSETS DISPONÍVEIS:
${validProjectAssets.filter((a) => a.source !== 'logo').length > 0 ? validProjectAssets.filter((a) => a.source !== 'logo').map((a, i) => `${i + 1}. ${a.name ?? a.mimeType}${a.source ? ` (${a.source})` : ''}`).join('\n') : 'Nenhum asset visual comum.'}
${validProjectAssets.some((a) => a.source === 'logo') ? 'Logo da marca enviado separadamente: use como identidade visual, paleta, proporção e referência de assinatura. Não trate como imagem decorativa comum nem coloque o logo aleatoriamente.' : ''}
${validReferenceAsset ? 'Há uma referência visual anexada; use como direção de composição/estilo, não copie literalmente.' : ''}

REGRAS DE QUALIDADE:
- Gere uma imagem com direção de arte clara, não genérica.
- Use as referências para composição, paleta, luz, textura e atmosfera.
- Preserve consistência com a marca; não introduza cores que conflitem com a paleta oficial.
- Evite texto, letras, logotipos falsos, marcas d'água, mockups aleatórios e elementos sem relação com o briefing.
- Pense como fundo/hero visual para layout: deixe área respirável para texto, contraste limpo e foco visual único.
- Estética premium, editorial, limpa, comercial, com acabamento profissional.
- Resultado em ${aspectRatio}, alta resolução.`;

    const imageAi = new GoogleGenAI({ apiKey: config.nanoBananaApiKey });
    const contents: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [{ text: creativePrompt }];

    if (validReferenceAsset) {
      contents.push({ text: 'Referência visual anexada pelo usuário:' });
      contents.push({ inlineData: { mimeType: validReferenceAsset.mimeType, data: validReferenceAsset.dataBase64 } });
    }

    for (const asset of validProjectAssets) {
      const label = asset.source === 'logo'
        ? `Logo oficial da marca: ${asset.name ?? asset.mimeType}. Use apenas como referência de identidade visual e assinatura.`
        : `Asset do projeto: ${asset.name ?? asset.mimeType}${asset.source ? ` (${asset.source})` : ''}`;
      contents.push({ text: label });
      contents.push({ inlineData: { mimeType: asset.mimeType, data: asset.dataBase64 } });
    }

    let dataUrl = '';
    const imageModels = ['gemini-3-pro-image-preview', 'gemini-2.5-flash-image'];
    let lastImageError: unknown;

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

        dataUrl = extractGeneratedImageDataUrl(response);
        if (!dataUrl) throw new Error(`Modelo ${model} não retornou imagem`);
        
        const post = await prisma.post.create({
          data: {
            brandId: brand.id,
            createdById: req.user?.userId || undefined,
            type: 'SINGLE_IMAGE',
            status: 'READY',
            content: { type: 'image', dataUrl, prompt: creativePrompt, referencesUsed: refs } as Prisma.InputJsonValue,
            previewUrl: dataUrl,
          },
        });

        res.status(201).json({ data: { ...post, dataUrl } });
        return;
      } catch (error) {
        lastImageError = error;
        console.warn(`[generate-image] ${model} failed:`, error);
      }
    }

    if (!dataUrl) {
      const msg = lastImageError instanceof Error ? lastImageError.message : 'Falha ao gerar imagem com Nano Banana';
      throw createError(500, msg);
    }

    const post = await prisma.post.create({
      data: {
        brandId: brand.id,
        type: 'SINGLE_IMAGE',
        status: 'READY',
        content: { type: 'image', dataUrl, prompt: creativePrompt, referencesUsed: refs } as Prisma.InputJsonValue,
        previewUrl: dataUrl,
      },
    });

    res.status(201).json({ data: { ...post, dataUrl } });
  } catch (error) {
    console.error('Erro na geração de imagem:', error);
    next(error);
  }
});

// ── /create shared types ─────────────────────────────────────────────────────

type GenerateImageReference = {
  id?: string;
  title: string;
  style: string;
  palette: string[];
  relevance: string;
};

function normalizeDesignReferences(value: unknown): GenerateImageReference[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => item as Record<string, unknown>)
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : undefined,
      title: typeof item.title === 'string' ? item.title.trim() : '',
      style: typeof item.style === 'string' ? item.style.trim() : '',
      palette: Array.isArray(item.palette) ? item.palette.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).slice(0, 5) : [],
      relevance: typeof item.relevance === 'string' ? item.relevance.trim() : '',
    }))
    .filter((item) => item.title || item.style || item.relevance)
    .slice(0, 6);
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

function dataUrlToProjectImage(dataUrl: string, name: string): { mimeType: string; dataBase64: string; name: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1] || 'image/png', dataBase64: match[2] || '', name };
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

async function generateImageAssetForSlide({
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
  brand: Prisma.BrandGetPayload<{ include: { config: true } }>;
  refs: GenerateImageReference[];
  width: number;
  height: number;
  brandCtx: string;
  projectAssets?: Array<{ mimeType: string; dataBase64: string; name?: string; source?: string }>;
  referenceAsset?: { mimeType: string; dataBase64: string };
}): Promise<string> {
  const colors = brand.config?.colors || [];
  const fonts = brand.config?.primaryFonts || [];
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
Cores oficiais: ${colors.length > 0 ? colors.join(', ') : 'não definidas'}
Fontes oficiais: ${fonts.length > 0 ? fonts.join(', ') : 'não definidas'}
Diretrizes: ${brand.config?.guidelines || 'não definidas'}

CONTEXTO DA APRESENTAÇÃO:
${brandCtx}

REFERÊNCIAS VISUAIS:
${referenceBlock}

ASSETS:
${assets.filter((a) => a.source !== 'logo').length > 0 ? assets.filter((a) => a.source !== 'logo').map((a, i) => `${i + 1}. ${a.name ?? a.mimeType}${a.source ? ` (${a.source})` : ''}`).join('\n') : 'Nenhum asset visual comum.'}
${assets.some((a) => a.source === 'logo') ? 'Logo oficial enviado separadamente: use como identidade, paleta e assinatura. Não trate como imagem decorativa comum.' : ''}
${referenceAsset ? 'Referência visual anexada: use como direção de composição/estilo, sem copiar literalmente.' : ''}

REGRAS:
- Não coloque texto legível na imagem.
- Não crie logotipos falsos nem marcas d’água.
- Deixe área respirável para o layout receber texto.
- Visual comercial, premium, editorial, claro e alinhado à marca.
- Resultado em ${aspectRatio}.`;

  const imageAi = new GoogleGenAI({ apiKey: config.nanoBananaApiKey });
  const contents: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [{ text: creativePrompt }];

  if (referenceAsset) {
    contents.push({ text: 'Referência visual anexada pelo usuário:' });
    contents.push({ inlineData: { mimeType: referenceAsset.mimeType, data: referenceAsset.dataBase64 } });
  }

  for (const asset of assets) {
    const label = asset.source === 'logo'
      ? `Logo oficial da marca: ${asset.name ?? asset.mimeType}. Use apenas como referência de identidade visual e assinatura.`
      : `Asset do projeto: ${asset.name ?? asset.mimeType}${asset.source ? ` (${asset.source})` : ''}`;
    contents.push({ text: label });
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
      console.warn(`[create:image] ${model} failed:`, error);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Falha ao gerar imagem com Nano Banana');
}

// ── Phase 1: Ask clarifying questions ────────────────────────────────────────

async function consultDesign(
  message: string,
  brandCtx: string,
  send: (e: CreateEvent) => void,
): Promise<void> {
  const prompt = `Você é um diretor de arte consultivo experiente. Analise este briefing e gere 2-3 perguntas estratégicas que vão melhorar significativamente o resultado final.

Briefing: "${message}"

Contexto da marca:
${brandCtx}

Regras:
- Máximo 3 perguntas, cada uma com exatamente 4 opções curtas
- Foque em: objetivo, público-alvo, tom/estilo visual, call-to-action
- Seja específico para ESTE briefing — não genérico
- As opções devem ser mutuamente exclusivas e cobrindo o espectro

Retorne APENAS JSON válido:
{
  "analysis": "O que você entendeu do pedido e o potencial criativo (1-2 frases diretas em português)",
  "questions": [
    {
      "id": "q1",
      "text": "Pergunta clara e direta",
      "options": ["Opção A concreta", "Opção B concreta", "Opção C concreta", "Opção D concreta"]
    }
  ]
}`;

  const resp = await generateWithRetry(ai, {
    model: config.models.utility,
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  });

  const raw = JSON.parse(resp.text ?? '{"analysis":"","questions":[]}') as {
    analysis?: string;
    questions?: ConsultQuestion[];
  };

  if (raw.analysis) send({ type: 'text', text: raw.analysis });
  if (Array.isArray(raw.questions) && raw.questions.length > 0) {
    send({ type: 'questions', questions: raw.questions });
  }
}

// ── Phase 1: Research brand + visual references (with Google Search grounding) ──

async function researchBrand(
  brandName: string,
  brief: string,
  brandCtx: string,
): Promise<{ summary: string; refs: VisualRef[] }> {
  // Pass 1 — live web research via Google Search tool (text output, not JSON mode)
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
    // Google Search unavailable (quota or config) — fall through to context-only refs
  }

  // Pass 2 — structure refs for display (JSON mode, uses research + brand context)
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
      "title": "Nome específico (ex: 'Feed do @nomemarca', 'Estética Brutalist Editorial 2024')",
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


// POST /api/ai/:slug/search-design-references  — Curated design reference search
aiRouter.post('/:slug/search-design-references', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { brief } = req.body as { brief?: unknown };
    const slug = req.params.slug as string;

    const brand = await prisma.brand.findUnique({ where: { slug }, include: { config: true } });
    if (!brand) throw createError(404, 'Brand not found');

    const brandColors = (brand.config?.colors ?? []).join(', ') || 'não definidas';
    const briefStr = typeof brief === 'string' ? brief.slice(0, 300) : '';

    // Pass 1: Google Search grounding for real design references
    let researchText = '';
    try {
      const resp = await generateWithRetry(ai, {
        model: config.models.utility,
        contents: `Pesquise referências visuais de design para apresentações (slides, pitch decks) em sites como Behance, Dribbble, Pitch.com, Figma Community, Awwwards.

Marca: "${brand.name}"
${briefStr ? `Briefing: "${briefStr}"` : ''}
Cores da marca: ${brandColors}

Encontre 3 referências REAIS e específicas de apresentações alinhadas com esta marca. Descreva composição, tipografia, paleta e elementos decorativos de cada uma. Seja específico — cite nomes reais, hexes quando identificar.`,
        config: { tools: [{ googleSearch: {} }] },
      });
      researchText = resp.text ?? '';
    } catch { /* Google Search unavailable — fall through */ }

    // Pass 2: Structure as JSON
    const structurePrompt = `Você é um diretor de arte. Crie 3 referências visuais específicas para guiar o design de uma apresentação profissional.

${researchText ? `Pesquisa web coletada:\n${researchText.slice(0, 2000)}\n\n` : ''}Marca: ${brand.name}
Cores: ${brandColors}
${briefStr ? `Briefing: ${briefStr}` : ''}

Use referências REAIS da pesquisa quando disponíveis. Descreva composição (split, full-bleed, centrado), tipografia e paleta de cada uma.

Retorne APENAS JSON:
{
  "references": [
    {
      "id": "r1",
      "title": "Nome específico (ex: 'Pitch.com — deck minimalista 2024')",
      "style": "Composição precisa + tipografia + elementos decorativos",
      "palette": ["#HEX1", "#HEX2", "#HEX3"],
      "relevance": "Por que serve este projeto especificamente"
    }
  ]
}`;

    const resp = await generateWithRetry(ai, {
      model: config.models.utility,
      contents: structurePrompt,
      config: { responseMimeType: 'application/json' },
    });

    const raw = JSON.parse(resp.text ?? '{"references":[]}') as { references?: unknown[] };
    res.json({ data: { references: raw.references ?? [] } });
  } catch (error) {
    next(error);
  }
});

// POST /api/ai/:slug/patch-design — Task-list driven visual modification of an existing design (SSE)
aiRouter.post('/:slug/patch-design', async (req: AuthRequest, res: Response, next: NextFunction) => {
  const {
    currentPages,
    request,
    brandCtxFromClient,
    slideCount,
    width = 1920,
    height = 1080,
    projectAssets,
    referenceAsset,
  } = req.body as {
    currentPages: unknown[];
    request: string;
    brandCtxFromClient?: string;
    slideCount?: number;
    width?: number;
    height?: number;
    projectAssets?: unknown;
    referenceAsset?: unknown;
  };
  const slug = req.params.slug as string;

  if (!Array.isArray(currentPages) || currentPages.length === 0) {
    return next(createError(400, 'currentPages must be a non-empty array'));
  }
  if (!request || typeof request !== 'string' || !request.trim()) {
    return next(createError(400, 'request is required'));
  }

  let brand: Prisma.BrandGetPayload<{ include: { config: true } }> | null;
  try {
    brand = await prisma.brand.findUnique({ where: { slug }, include: { config: true } });
  } catch (e) { return next(e); }
  if (!brand) return next(createError(404, 'Brand not found'));

  const sc = normalizeRequestedSlideCount(slideCount, currentPages.length);
  const w  = normalizeDesignDimension(width, 1920);
  const h  = normalizeDesignDimension(height, 1080);
  const dims = { width: w, height: h };

  const brandCtx = [
    `Marca: ${brand.name}`,
    `Diretrizes: ${brand.config?.guidelines ?? ''}`,
    `Cores da marca: ${(brand.config?.colors ?? []).join(', ')}`,
    `Fontes: ${(brand.config?.primaryFonts ?? []).join(', ')}`,
    `Slides: ${sc}`,
    brandCtxFromClient ? `\nContexto da sessão:\n${brandCtxFromClient.slice(0, 600)}` : '',
  ].filter(Boolean).join('\n');

  const validProjectAssets = Array.isArray(projectAssets)
    ? (projectAssets as unknown[])
        .filter(a => a && typeof a === 'object')
        .map(a => a as { mimeType?: unknown; dataBase64?: unknown; name?: unknown })
        .filter(a => typeof a.mimeType === 'string' && typeof a.dataBase64 === 'string' && (a.mimeType as string).startsWith('image/'))
        .slice(0, 8)
        .map(a => ({ mimeType: a.mimeType as string, dataBase64: a.dataBase64 as string, name: typeof a.name === 'string' ? a.name : undefined }))
    : undefined;

  const validReferenceAsset =
    referenceAsset && typeof referenceAsset === 'object' &&
    typeof (referenceAsset as { mimeType?: unknown }).mimeType === 'string' &&
    typeof (referenceAsset as { dataBase64?: unknown }).dataBase64 === 'string'
      ? { mimeType: (referenceAsset as { mimeType: string }).mimeType, dataBase64: (referenceAsset as { dataBase64: string }).dataBase64 }
      : undefined;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event: CreateEvent) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    // ── Step 1: Plan tasks ─────────────────────────────────────────────────────
    interface PatchTask { id: string; description: string; slides: number[] | 'all'; }

    const planResp = await generateWithRetry(ai, {
      model: config.models.utility,
      contents: `Você vai modificar um deck de ${sc} slides. Planeje tarefas visuais concretas.

PEDIDO: "${request.slice(0, 400)}"

MARCA: ${brand.name} | Cores: ${(brand.config?.colors ?? []).join(', ')}

Planeje de 2 a 5 tarefas específicas. Cada tarefa deve:
- Ser uma mudança visual concreta (cor, gradiente, composição, shape, imagem, espaçamento)
- Especificar slides afetados: array de índices 0-based ou "all"
- Ser atômica (uma mudança por tarefa)

Retorne APENAS JSON (sem markdown):
[{"id":"t1","description":"Tarefa concisa e técnica","slides":[0,1]},...]`,
      config: { responseMimeType: 'application/json' },
    });

    let tasks: PatchTask[] = [];
    try {
      const parsed = JSON.parse(planResp.text ?? '[]') as unknown;
      tasks = Array.isArray(parsed) ? (parsed as PatchTask[]).slice(0, 5) : [];
    } catch { /* fallback below */ }
    if (tasks.length === 0) tasks = [{ id: 't1', description: request.slice(0, 100), slides: 'all' }];

    send({ type: 'plan', steps: tasks.map(t => ({ id: t.id, text: t.description, status: 'pending' })) });

    // ── Step 2: Execute tasks ──────────────────────────────────────────────────
    type SlideRecord = Record<string, unknown>;
    const workingPages: SlideRecord[] = currentPages.map(p => ({ ...(p as SlideRecord) }));

    const clamp = (l: Layer): Layer => ({
      ...l,
      x: Math.max(0, Math.min(Math.round(l.x), w - 1)),
      y: Math.max(0, Math.min(Math.round(l.y), h - 1)),
      width: Math.max(1, Math.min(Math.round(l.width), w - Math.max(0, Math.round(l.x)))),
      height: Math.max(1, Math.min(Math.round(l.height), h - Math.max(0, Math.round(l.y)))),
    });

    for (const task of tasks) {
      send({ type: 'plan-step', stepId: task.id, status: 'active' });

      const targetIndices = task.slides === 'all'
        ? Array.from({ length: sc }, (_, i) => i)
        : (task.slides as number[]).filter(i => typeof i === 'number' && i >= 0 && i < sc);

      // Run all slides for this task in parallel (NanoBanana-only visual regeneration)
      const results = await Promise.allSettled(
        targetIndices.map(async (slideIdx) => {
          const currentSlide = workingPages[slideIdx] as SlideRecord ?? {};
          const existingLayers = Array.isArray(currentSlide.layers) ? (currentSlide.layers as Layer[]) : [];
          const existingTextLayers = existingLayers.filter(l => l && l.type === 'text');

          const singleCtx = brandCtx.replace(/Slides:\s*\d+/, 'Slides: 1') +
            `\nSlide ${slideIdx + 1} de ${sc} | Fundo atual: ${typeof currentSlide.backgroundColor === 'string' ? currentSlide.backgroundColor : '#000'}`;

          const singleTextZones: TextZonesPerSlide | undefined = existingTextLayers.length > 0
            ? [{ slide: 0, zones: existingTextLayers.map(l => ({ id: l.id, x: l.x, y: l.y, w: l.width, h: l.height, color: l.color })) }]
            : undefined;

          const [designSlide] = await generateDesign(
            task.description,
            singleCtx,
            'carousel',
            dims,
            undefined,
            validReferenceAsset ? [validReferenceAsset] : undefined,
            validProjectAssets,
            singleTextZones,
          );

          const page = {
            ...designSlide,
            width: w,
            height: h,
            layers: deduplicateLayerIds([...(designSlide?.layers ?? []), ...existingTextLayers.map(clamp)]),
          };

          return { slideIdx, page };
        }),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { slideIdx, page } = result.value;
          workingPages[slideIdx] = page as SlideRecord;
          send({ type: 'slide-update', index: slideIdx, page });
        }
      }

      send({ type: 'plan-step', stepId: task.id, status: 'done' });
    }

    // ── Step 3: Persist ────────────────────────────────────────────────────────
    const post = await prisma.post.create({
      data: {
        brandId: brand!.id,
        type: 'CAROUSEL',
        status: 'DRAFT',
        content: workingPages as unknown as Prisma.InputJsonValue,
      },
    });

    send({ type: 'done', postId: post.id });
  } catch (err: unknown) {
    send({ type: 'error', message: err instanceof Error ? err.message : 'Erro na modificação' });
  }

  if (!res.writableEnded) res.end();
});

function canAccessFixJob(jobId: string, userId?: string) {
  const job = getFixJob(jobId);
  if (!job || job.expiresAt < Date.now()) return undefined;
  if (job.userId && userId && job.userId !== userId) return undefined;
  return job;
}

function runFixJob(jobId: string, payload: {
  currentPages: FixerPage[];
  selectedFixes?: DesignFix[];
  planOnly?: boolean;
  request?: string;
}) {
  const job = getFixJob(jobId);
  if (!job) return;
  const send = (event: FixerEvent) => broadcastFixEvent(job, event);
  const context: FixJobContext = {
    emit: send,
    getMemory: () => job.memory.join('\n'),
    addMemory: (entry: string) => job.memory.push(entry),
    triedFixes: job.triedFixes,
    isAutoMode: () => job.autoMode,
    setAutoMode: () => { job.autoMode = true; },
    isCancelled: () => job.status === 'cancelled',
    waitForInput: async (question: string) => waitForUserInput(job, question),
  };

  void fixDesign(
    context,
    payload.currentPages,
    [],
    { width: payload.currentPages[0]?.width ?? 1080, height: payload.currentPages[0]?.height ?? 1080 },
    payload.request ?? '',
    { selectedFixes: payload.selectedFixes, planOnly: payload.planOnly },
  ).then((pages) => {
    job.pages = pages;
    completeFixJob(job, pages);
  }).catch((error) => {
    failFixJob(job, error instanceof Error ? error.message : 'Erro interno');
  });
}

// POST /api/ai/:slug/fix-design-job — start recoverable AI design fixer job
aiRouter.post('/:slug/fix-design-job', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug as string;
    const brand = await prisma.brand.findUnique({ where: { slug } });
    if (!brand) throw createError(404, 'Brand not found');

    const { currentPages, selectedFixes, planOnly, request } = req.body as {
      currentPages?: unknown;
      selectedFixes?: DesignFix[];
      planOnly?: boolean;
      request?: string;
    };
    if (!Array.isArray(currentPages)) throw createError(400, 'currentPages is required');

    const job = createFixJob(currentPages);
    job.slug = slug;
    job.userId = req.user?.userId;
    res.status(202).json({ data: { jobId: job.id, status: job.status } });

    queueMicrotask(() => runFixJob(job.id, {
      currentPages: currentPages as FixerPage[],
      selectedFixes,
      planOnly,
      request,
    }));
  } catch (error) {
    next(error);
  }
});

// GET /api/ai/fix-jobs/:jobId — status/replay metadata
aiRouter.get('/fix-jobs/:jobId', (req: AuthRequest, res: Response) => {
  const job = canAccessFixJob(req.params.jobId as string, req.user?.userId);
  if (!job) return res.status(404).json({ error: 'Job not found or expired' });
  res.json({ data: { id: job.id, status: job.status, pages: job.pages, waitingFor: job.waitingFor, eventCount: job.events.length, expiresAt: job.expiresAt } });
});

// GET /api/ai/fix-jobs/:jobId/stream — replayable fix SSE stream
aiRouter.get('/fix-jobs/:jobId/stream', (req: AuthRequest, res: Response) => {
  const job = canAccessFixJob(req.params.jobId as string, req.user?.userId);
  if (!job) return res.status(404).json({ error: 'Job not found or expired' });
  const from = Number.parseInt(String(req.query.from ?? '0'), 10);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  addFixSseClient(job, res, Number.isFinite(from) && from > 0 ? from : 0);
});

// POST /api/ai/fix-jobs/:jobId/input — human-in-loop input for fixer
aiRouter.post('/fix-jobs/:jobId/input', (req: AuthRequest, res: Response) => {
  const job = canAccessFixJob(req.params.jobId as string, req.user?.userId);
  if (!job) return res.status(404).json({ error: 'Job not found or expired' });
  const input = typeof req.body?.input === 'string' ? req.body.input : '';
  sendFixUserInput(job, input);
  broadcastFixEvent(job, { type: 'user-input-received', input });
  res.json({ data: { status: job.status } });
});

// POST /api/ai/:slug/fix-design  — SSE streaming AI correction orchestration
aiRouter.post('/:slug/fix-design', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { pages, canvasWidth, canvasHeight, planOnly, selectedFixes } = req.body as {
      pages: unknown;
      canvasWidth?: unknown;
      canvasHeight?: unknown;
      planOnly?: unknown;
      selectedFixes?: unknown;
    };
    const slug = req.params.slug as string;

    if (!Array.isArray(pages) || pages.length === 0) throw createError(400, 'pages must be a non-empty array');

    const brand = await prisma.brand.findUnique({ where: { slug }, include: { config: true } });
    if (!brand) throw createError(404, 'Brand not found');

    const brandColors: string[] = brand.config?.colors ?? [];
    const brandContext = await getBrandContext(slug);

    const dims = {
      width: typeof canvasWidth === 'number' && canvasWidth > 0 ? canvasWidth : 1080,
      height: typeof canvasHeight === 'number' && canvasHeight > 0 ? canvasHeight : 1080,
    };

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event: FixerEvent) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    let cancelled = false;
    req.on('close', () => { cancelled = true; });

    const sessionMemory: string[] = [];
    const ctx: FixJobContext = {
      emit: send,
      getMemory: () => sessionMemory.join('\n'),
      addMemory: (entry) => { sessionMemory.push(entry); },
      triedFixes: new Map(),
      isAutoMode: () => true,
      setAutoMode: () => {},
      isCancelled: () => cancelled || res.writableEnded,
      waitForInput: async () => 'yes',
    };

    const approvedFixes = Array.isArray(selectedFixes)
      ? (selectedFixes as unknown[]).filter(f => f && typeof f === 'object') as DesignFix[]
      : undefined;

    await fixDesign(ctx, pages as FixerPage[], brandColors, dims, brandContext, {
      planOnly: planOnly === true,
      selectedFixes: approvedFixes && approvedFixes.length > 0 ? approvedFixes : undefined,
    });

    if (!res.writableEnded) res.end();

  } catch (error: unknown) {
    if (!res.headersSent) {
      next(error);
    } else {
      const msg = error instanceof Error ? error.message : 'Fix failed';
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
        res.end();
      }
    }
  }
});
