import { Router, Response, NextFunction } from 'express';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import prisma from '../lib/prisma.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { normalizeImage, isSupportedMimeType } from '../lib/imageNormalizer.js';
import { generateWithRetry } from '../lib/geminiRetry.js';
import { requireBrandRole, EDITORS, type BrandRequest } from '../middleware/brandAccess.js';

export const aiRouter = Router();

// Toda rota com :slug exige vínculo de edição com a marca (todas aqui geram ou editam
// design). Ficando no `param`, uma rota nova com :slug já nasce protegida — antes o
// slug era resolvido direto no handler e qualquer usuário logado gerava em qualquer marca.
aiRouter.param('slug', (req, res, next) =>
  requireBrandRole(EDITORS)(req as BrandRequest, res as Response, next as NextFunction),
);

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

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
