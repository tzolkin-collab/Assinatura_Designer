import AdmZip from 'adm-zip';
import prisma from './prisma.js';
import { uploadFileToR2 } from './r2.js';
import { createError } from '../middleware/errorHandler.js';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { normalizarLogoParaFundoEscuro } from './logoTransparency.js';

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

function parseIngestionJSON(rawText: string): any {
  let cleanText = rawText.trim();
  cleanText = cleanText.replace(/^```(json|xml)?/i, '').replace(/```$/i, '').trim();

  let parsed: any = {};
  try {
    parsed = JSON.parse(cleanText);
  } catch (err) {
    console.warn('JSON.parse falhou, tentando resgate de emergência...', err);
    try {
      parsed = JSON.parse(cleanText + ']}');
    } catch {
      parsed = {};
    }
  }

  // Se guidelines veio como objeto ou stringified JSON, converte para Markdown limpo
  if (parsed.guidelines) {
    if (typeof parsed.guidelines === 'object' && parsed.guidelines !== null) {
      const g = parsed.guidelines;
      parsed.guidelines = [g.history, g.guidelines, g.voice, g.rules, g.summary].filter(Boolean).join('\n\n');
    } else if (typeof parsed.guidelines === 'string' && parsed.guidelines.trim().startsWith('{')) {
      try {
        const inner = JSON.parse(parsed.guidelines);
        if (typeof inner === 'object' && inner !== null) {
          parsed.guidelines = [inner.history, inner.guidelines, inner.voice, inner.rules, inner.summary].filter(Boolean).join('\n\n');
        }
      } catch {
        // Mantém como está se não for JSON válido
      }
    }
  }

  // Se reconstructedSvgs não veio no JSON parsed, resgata objetos SVG com Regex
  if (!Array.isArray(parsed.reconstructedSvgs) || parsed.reconstructedSvgs.length === 0) {
    const svgRegex = /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"classification"\s*:\s*"([^"]+)"\s*,\s*"svgCode"\s*:\s*"([\s\S]*?)"\s*\}/gi;
    const extracted: Array<{ name: string; classification: string; svgCode: string }> = [];
    let match;
    while ((match = svgRegex.exec(cleanText)) !== null) {
      const svgCode = match[3].replace(/\\"/g, '"').replace(/\\n/g, '\n');
      if (svgCode.includes('<svg')) {
        extracted.push({
          name: match[1],
          classification: match[2],
          svgCode,
        });
      }
    }
    if (extracted.length > 0) {
      parsed.reconstructedSvgs = extracted;
    }
  }

  return parsed;
}

function classifySVG(filename: string, content: string): SVGClassification {
  const lowerName = filename.toLowerCase();
  const lowerContent = content.toLowerCase();

  // 1. Logotipo oficial e variações de marca
  if (
    lowerName.includes('logo') ||
    lowerName.includes('logotype') ||
    lowerName.includes('brandmark') ||
    lowerName.includes('marca') ||
    lowerName.includes('isotipo') ||
    lowerName.includes('simbolo') ||
    lowerContent.includes('id="logo"') ||
    lowerContent.includes('class="logo"') ||
    lowerContent.includes('id="brand"')
  ) {
    return 'LOGOTYPE';
  }

  // 2. Elementos gráficos, molduras, divisores e padrões de fundo
  if (
    lowerName.includes('pattern') ||
    lowerName.includes('frame') ||
    lowerName.includes('divider') ||
    lowerName.includes('border') ||
    lowerName.includes('background') ||
    lowerName.includes('grafismo') ||
    lowerName.includes('forma') ||
    lowerName.includes('banner') ||
    lowerName.includes('faixa') ||
    lowerContent.includes('<pattern') ||
    lowerContent.includes('id="grafismo"') ||
    lowerContent.includes('class="pattern"')
  ) {
    return 'GRAPHIC_ELEMENT';
  }

  // 3. Ilustrações e ícones gerais
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

  // Encontra ou cria a pasta "Brandbooks" (MEDIA)
  let brandbooksFolder = await prisma.folder.findFirst({
    where: { brandId: brand.id, type: 'MEDIA', name: 'Brandbooks' },
  });
  if (!brandbooksFolder) {
    brandbooksFolder = await prisma.folder.create({
      data: { brandId: brand.id, type: 'MEDIA', name: 'Brandbooks' },
    });
  }

  for (const file of files) {
    const filename = file.originalname.toLowerCase();

    // Salva o arquivo RAW no R2 e no banco
    try {
      const rawR2Url = await uploadFileToR2(
        file.buffer, 
        file.originalname, 
        file.mimetype || 'application/octet-stream', 
        `brands/${brand.id}/brandbooks_raw`
      );
      await prisma.asset.create({
        data: {
          brandId: brand.id,
          name: file.originalname,
          url: rawR2Url,
          fileType: file.mimetype || 'application/octet-stream',
          sizeBytes: file.size,
          source: 'brandbook',
          tags: ['brandbook-raw'],
          uploadedBy: uploadedByUserId ?? null,
          folderId: brandbooksFolder.id,
        },
      });
    } catch (rawSaveErr) {
      console.warn(`Falha ao salvar arquivo RAW ${file.originalname}:`, rawSaveErr);
    }

    let isZipHandled = false;

    // Tenta descompactar como ZIP se tiver extensão/mimetype de zip ou octet-stream
    if (filename.endsWith('.zip') || file.mimetype.includes('zip') || file.mimetype === 'application/octet-stream') {
      try {
        const zip = new AdmZip(file.buffer);
        const zipEntries = zip.getEntries();
        if (zipEntries && zipEntries.length > 0) {
          isZipHandled = true;
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
              if (imagePartsForGemini.length < 6) {
                imagePartsForGemini.push({
                  inlineData: {
                    mimeType: entryName.endsWith('.png') ? 'image/png' : 'image/jpeg',
                    data: buffer.toString('base64'),
                  },
                });
              }
            }
          }
        }
      } catch {
        isZipHandled = false;
      }
    }

    if (!isZipHandled) {
      if (file.mimetype === 'image/svg+xml' || filename.endsWith('.svg')) {
        rawSvgsToProcess.push({ filename: file.originalname, buffer: file.buffer });
        textSnippets.push(file.buffer.toString('utf-8'));
      } else if (file.mimetype === 'text/html' || filename.endsWith('.html') || filename.endsWith('.htm') || filename.endsWith('.css')) {
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
      } else if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
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
          folderId: brandbooksFolder.id,
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
Você é um especialista em direção de arte, vetorização de marcas e engenharia de SVGs.
Examine atentamente cada slide e imagem da apresentação/brandbook da marca "${brand.name}".

Sua missão é extrair e vetorizar rigorosamente as seguintes informações em JSON:
1. "guidelines": Resumo do tom de voz, regras de marca, promessa e personalidade (markdown, 2-4 parágrafos).
2. "colors": Lista de todos os códigos hexadecimais da paleta de cores visíveis (ex: cores de fundo, botões, ícones, textos, ex: ["#3D101C", "#F8ECE5", "#892A45", "#3F51B5"]).
3. "primaryFonts": Lista de nomes das famílias tipográficas utilizadas nos títulos e textos (ex: ["Inter", "Montserrat", "Playfair"]).
4. "reconstructedSvgs": VETORIZE e remonte o código SVG limpo para CADA um dos seguintes elementos encontrados nas imagens (gere até 15 objetos vetoriais com viewBox, paths, stroke, fill e dimensões precisas):
   - A LOGO OFICIAL da marca visível no canto superior esquerdo ou nos cabeçalhos (ex: o monograma "A✦ ASSINATURA" ou "A✦ ASSINATURA MARCA PRÓPRIA" com a estrela de 4 pontas). Classificação: "LOGOTYPE".
   - O ÍCONE DA ESTRELA DE 4 PONTAS (Sparkle ✦) que é o grafismo assinatura da marca. Classificação: "GRAPHIC_ELEMENT".
   - O CONJUNTO DE ÍCONES DE LINHA/CARD visíveis nos slides (ex: Ícone de caixa/estoque, sacola de compras, cadeado, gráfico de barras com seta, alvo/bullseye, coração, relógio/cronômetro, presente/bônus, bisnaga de creme, pessoas/aquisição, checkmark). Classificação: "ILLUSTRATION".
   - GRAFISMOS DE MOLDURA E ESTRUTURA (ex: engrenagem/quebra-cabeça de 4 peças, arcos/linhas de fundo, barra chevron de etapas). Classificação: "GRAPHIC_ELEMENT".

Formato do JSON de resposta:
{
  "guidelines": "...",
  "colors": ["#HEX1", "#HEX2", "#HEX3"],
  "primaryFonts": ["Fonte1"],
  "reconstructedSvgs": [
    { "name": "logo-assinatura-vector.svg", "classification": "LOGOTYPE", "svgCode": "<svg viewBox=\\"0 0 200 60\\">...</svg>" },
    { "name": "sparkle-estrela-4-pontas.svg", "classification": "GRAPHIC_ELEMENT", "svgCode": "<svg viewBox=\\"0 0 40 40\\">...</svg>" },
    { "name": "icone-caixa-estoque.svg", "classification": "ILLUSTRATION", "svgCode": "<svg viewBox=\\"0 0 32 32\\">...</svg>" }
  ]
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
        maxOutputTokens: 8192,
      },
    });

    if (aiResponse.text) {
      const parsed = parseIngestionJSON(aiResponse.text);
      if (parsed.guidelines) aiGuidelines = parsed.guidelines;
      if (Array.isArray(parsed.colors)) aiColors = parsed.colors.filter((c: unknown) => typeof c === 'string' && c.startsWith('#'));
      if (Array.isArray(parsed.primaryFonts)) aiFonts = parsed.primaryFonts.filter((f: unknown) => typeof f === 'string');

      // Processa SVGs pescados e remontados pela IA
      if (Array.isArray(parsed.reconstructedSvgs)) {
        for (const item of parsed.reconstructedSvgs) {
          if (item?.svgCode && typeof item.svgCode === 'string' && item.svgCode.includes('<svg')) {
            try {
              let cleanSvg = item.svgCode.trim();
              cleanSvg = cleanSvg.replace(/^```(xml|svg|json)?/i, '').replace(/```$/i, '').trim();
              if (!cleanSvg.includes('xmlns=')) {
                cleanSvg = cleanSvg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
              }

              const svgBuffer = Buffer.from(cleanSvg, 'utf-8');
              const filename = item.name || `vetor-ia-${Date.now()}.svg`;
              const classification: SVGClassification =
                item.classification === 'LOGOTYPE' || item.classification === 'ILLUSTRATION' || item.classification === 'GRAPHIC_ELEMENT'
                  ? item.classification
                  : 'GRAPHIC_ELEMENT';

              const r2Url = await uploadFileToR2(svgBuffer, filename, 'image/svg+xml', `brands/${brand.id}/brandbook`);

              const asset = await prisma.asset.create({
                data: {
                  name: filename,
                  url: r2Url,
                  fileType: 'image/svg+xml',
                  sizeBytes: svgBuffer.length,
                  source: 'brandbook',
                  tags: ['brandbook', 'ai-reconstructed', classification],
                  brandId: brand.id,
                  uploadedBy: uploadedByUserId ?? null,
                  folderId: brandbooksFolder.id,
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
              console.warn('Falha ao salvar SVG pescado pela IA:', err);
            }
          }
        }
      }
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
      detectedLogoUrl = await normalizarLogoParaFundoEscuro(detectedLogoUrl);
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
