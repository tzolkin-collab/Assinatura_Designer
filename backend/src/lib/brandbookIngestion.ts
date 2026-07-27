import AdmZip from 'adm-zip';
import prisma from './prisma.js';
import { uploadFileToR2 } from './r2.js';
import { createError } from '../middleware/errorHandler.js';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';

export type SVGClassification = 'LOGOTYPE' | 'GRAPHIC_ELEMENT' | 'ILLUSTRATION';

export interface IngestedSVG {
  id: string;
  name: string;
  url: string;
  classification: SVGClassification;
}

export interface BrandbookIngestResult {
  guidelines: string;
  colors: string[];
  primaryFonts: string[];
  svgsIndexed: {
    logotypes: number;
    graphicElements: number;
    illustrations: number;
    total: number;
  };
  svgs: IngestedSVG[];
  logoNeedsConfirmation: boolean;
  detectedLogoUrl?: string | null;
  currentLogoUrl?: string | null;
}

function extractColorsFromText(text: string): string[] {
  const hexRegex = /#(?:[A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})\b/g;
  const matches = text.match(hexRegex) || [];
  const normalized = matches.map((c) => {
    if (c.length === 4) {
      return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`.toUpperCase();
    }
    return c.toUpperCase();
  });
  return Array.from(new Set(normalized));
}

function classifySVG(filename: string, content: string): SVGClassification {
  const lowerName = filename.toLowerCase();
  const lowerContent = content.toLowerCase();

  if (
    lowerName.includes('logo') ||
    lowerName.includes('logotype') ||
    lowerName.includes('brandmark') ||
    lowerName.includes('marca') ||
    lowerName.includes('isotipo') ||
    lowerName.includes('simbolo')
  ) {
    return 'LOGOTYPE';
  }

  // Se contém muitas linhas, paths de padrão ou palavras de moldura/divisor
  if (
    lowerName.includes('pattern') ||
    lowerName.includes('frame') ||
    lowerName.includes('divider') ||
    lowerName.includes('border') ||
    lowerName.includes('background') ||
    lowerName.includes('grafismo') ||
    lowerName.includes('forma') ||
    lowerContent.includes('pattern')
  ) {
    return 'GRAPHIC_ELEMENT';
  }

  return 'ILLUSTRATION';
}

export async function processBrandbookIngest({
  brandSlug,
  files,
  uploadedByUserId,
}: {
  brandSlug: string;
  files: Express.Multer.File[];
  uploadedByUserId?: string;
}): Promise<BrandbookIngestResult> {
  const brand = await prisma.brand.findUnique({
    where: { slug: brandSlug },
    include: { config: true },
  });

  if (!brand) throw createError(404, 'Marca não encontrada');

  const textSnippets: string[] = [];
  const imagePartsForGemini: Array<{ inlineData: { mimeType: string; data: string } }> = [];
  const rawSvgsToProcess: Array<{ filename: string; buffer: Buffer }> = [];

  for (const file of files) {
    const filename = file.originalname.toLowerCase();

    // 1. Arquivo ZIP (descompactar pasta de SVGs e assets)
    if (file.mimetype === 'application/zip' || filename.endsWith('.zip')) {
      try {
        const zip = new AdmZip(file.buffer);
        const zipEntries = zip.getEntries();

        for (const entry of zipEntries) {
          if (entry.isDirectory) continue;
          const entryName = entry.entryName.toLowerCase();
          const buffer = entry.getData();

          if (entryName.endsWith('.svg')) {
            rawSvgsToProcess.push({ filename: entry.name || entry.entryName, buffer });
          } else if (entryName.endsWith('.html') || entryName.endsWith('.htm') || entryName.endsWith('.css')) {
            const txt = buffer.toString('utf-8');
            textSnippets.push(txt);
          } else if (entryName.endsWith('.png') || entryName.endsWith('.jpg') || entryName.endsWith('.jpeg') || entryName.endsWith('.webp')) {
            if (imagePartsForGemini.length < 5) {
              imagePartsForGemini.push({
                inlineData: {
                  mimeType: entryName.endsWith('.png') ? 'image/png' : 'image/jpeg',
                  data: buffer.toString('base64'),
                },
              });
            }
          }
        }
      } catch (err) {
        console.warn('Erro ao descompactar ZIP:', err);
      }
    }
    // 2. SVG Individual
    else if (file.mimetype === 'image/svg+xml' || filename.endsWith('.svg')) {
      rawSvgsToProcess.push({ filename: file.originalname, buffer: file.buffer });
      textSnippets.push(file.buffer.toString('utf-8'));
    }
    // 3. HTML / CSS Individual
    else if (file.mimetype === 'text/html' || filename.endsWith('.html') || filename.endsWith('.htm') || filename.endsWith('.css')) {
      const txt = file.buffer.toString('utf-8');
      textSnippets.push(txt);

      // Extrai SVGs inline se houver <svg...</svg>
      const inlineSvgRegex = /<svg[\s\S]*?<\/svg>/gi;
      let match;
      let svgIndex = 1;
      while ((match = inlineSvgRegex.exec(txt)) !== null) {
        rawSvgsToProcess.push({
          filename: `inline-graphic-${svgIndex++}.svg`,
          buffer: Buffer.from(match[0], 'utf-8'),
        });
      }
    }
    // 4. Imagens PNG / JPG / WEBP / PDF
    else if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      if (imagePartsForGemini.length < 6) {
        imagePartsForGemini.push({
          inlineData: {
            mimeType: file.mimetype === 'application/pdf' ? 'application/pdf' : file.mimetype,
            data: file.buffer.toString('base64'),
          },
        });
      }
    }
  }

  // ── Processar e upload dos SVGs no R2 + Prisma Asset ──────────────────────
  const processedSvgs: IngestedSVG[] = [];
  let logotypesCount = 0;
  let graphicElementsCount = 0;
  let illustrationsCount = 0;
  let detectedLogoUrl: string | null = null;

  for (const item of rawSvgsToProcess) {
    try {
      const content = item.buffer.toString('utf-8');
      const classification = classifySVG(item.filename, content);

      const r2Url = await uploadFileToR2(item.buffer, item.filename, 'image/svg+xml', `brands/${brand.id}/brandbook`);

      const asset = await prisma.asset.create({
        data: {
          name: item.filename,
          url: r2Url,
          fileType: 'image/svg+xml',
          sizeBytes: item.buffer.length,
          source: 'brandbook',
          tags: ['brandbook', classification],
          brandId: brand.id,
          uploadedBy: uploadedByUserId ?? null,
        },
      });

      processedSvgs.push({
        id: asset.id,
        name: asset.name,
        url: asset.url,
        classification,
      });

      if (classification === 'LOGOTYPE') {
        logotypesCount++;
        if (!detectedLogoUrl) detectedLogoUrl = r2Url;
      } else if (classification === 'GRAPHIC_ELEMENT') {
        graphicElementsCount++;
      } else {
        illustrationsCount++;
      }
    } catch (err) {
      console.warn(`Falha ao salvar SVG ${item.filename}:`, err);
    }
  }

  // ── Extração de inteligência via Gemini AI ─────────────────────────────────
  const combinedTextContent = textSnippets.join('\n\n').slice(0, 15000);
  const regexColors = extractColorsFromText(combinedTextContent);

  let aiGuidelines = '';
  let aiColors: string[] = [];
  let aiFonts: string[] = [];

  const promptText = `
Você é um diretor de arte e estrategista de branding experiente.
Analise os arquivos e textos anexados do Brandbook da marca "${brand.name}".

Sua tarefa é extrair e estruturar as seguintes informações em JSON rigoroso:
1. "guidelines": Resumo completo e detalhado do tom de voz, regras de marca, personalidade e proibições de design (em markdown, 2-4 parágrafos).
2. "colors": Lista de códigos hexadecimais da paleta de cores (ex: ["#FF6B35", "#171717"]).
3. "primaryFonts": Lista de nomes de famílias de fontes utilizadas (ex: ["Inter", "Roboto"]).

Responda APENAS em JSON no formato:
{
  "guidelines": "...",
  "colors": ["#HEX1", "#HEX2"],
  "primaryFonts": ["Fonte1"]
}
`;

  try {
    const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    const aiResponse = await ai.models.generateContent({
      model: config.models.fast,
      contents: [
        ...imagePartsForGemini,
        { text: `${promptText}\n\nConteúdo textual extraído:\n${combinedTextContent}` },
      ],
      config: {
        responseMimeType: 'application/json',
      },
    });

    if (aiResponse.text) {
      const parsed = JSON.parse(aiResponse.text);
      if (parsed.guidelines) aiGuidelines = parsed.guidelines;
      if (Array.isArray(parsed.colors)) aiColors = parsed.colors.filter((c: unknown) => typeof c === 'string' && c.startsWith('#'));
      if (Array.isArray(parsed.primaryFonts)) aiFonts = parsed.primaryFonts.filter((f: unknown) => typeof f === 'string');
    }
  } catch (err) {
    console.warn('IA Ingestion fallback (leitura local usada):', err);
  }

  // ── Consolidação final de cores, fontes e diretrizes ─────────────────────
  const currentColors = brand.config?.colors ?? [];
  const mergedColors = Array.from(new Set([...currentColors, ...aiColors, ...regexColors])).slice(0, 12);

  const currentFonts = brand.config?.primaryFonts ?? [];
  const mergedFonts = Array.from(new Set([...currentFonts, ...aiFonts])).filter(Boolean);

  const currentGuidelines = brand.config?.guidelines ?? '';
  const newGuidelines = aiGuidelines
    ? currentGuidelines
      ? `${currentGuidelines}\n\n### Atualização do Brandbook:\n${aiGuidelines}`
      : aiGuidelines
    : currentGuidelines;

  const currentLogoUrl = brand.config?.logoUrl ?? null;
  let logoNeedsConfirmation = false;

  // Se detectou logo e já existe uma logo configurada, solicita confirmação
  if (detectedLogoUrl) {
    if (currentLogoUrl && currentLogoUrl !== detectedLogoUrl) {
      logoNeedsConfirmation = true;
    } else if (!currentLogoUrl) {
      // Se não havia logo, define como oficial automaticamente
      await prisma.brandConfig.upsert({
        where: { brandId: brand.id },
        update: { logoUrl: detectedLogoUrl },
        create: {
          brandId: brand.id,
          agentPrompt: `Você é o assistente de design da marca ${brand.name}.`,
          guidelines: newGuidelines,
          colors: mergedColors,
          primaryFonts: mergedFonts,
          logoUrl: detectedLogoUrl,
        },
      });
    }
  }

  // Atualiza as configurações de branding no banco
  await prisma.brandConfig.upsert({
    where: { brandId: brand.id },
    update: {
      guidelines: newGuidelines,
      colors: mergedColors,
      primaryFonts: mergedFonts.length > 0 ? mergedFonts : ['Inter'],
    },
    create: {
      brandId: brand.id,
      agentPrompt: `Você é o assistente de design da marca ${brand.name}.`,
      guidelines: newGuidelines,
      colors: mergedColors,
      primaryFonts: mergedFonts.length > 0 ? mergedFonts : ['Inter'],
      logoUrl: detectedLogoUrl ?? null,
    },
  });

  return {
    guidelines: newGuidelines,
    colors: mergedColors,
    primaryFonts: mergedFonts,
    svgsIndexed: {
      logotypes: logotypesCount,
      graphicElements: graphicElementsCount,
      illustrations: illustrationsCount,
      total: processedSvgs.length,
    },
    svgs: processedSvgs,
    logoNeedsConfirmation,
    detectedLogoUrl,
    currentLogoUrl,
  };
}
