import AdmZip from 'adm-zip';
import prisma from './prisma.js';
import { uploadFileToR2 } from './r2.js';
import { createError } from '../middleware/errorHandler.js';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { logger } from './logger.js';
import { normalizarLogoParaFundoEscuro } from './logoTransparency.js';
import { mesclarGuidelines, normalizarParaFormulario } from './brandGuidelines.js';
import { sanitizeSvg, prepareStorableFile } from './svgSanitize.js';
import {
  extractBrandInsights,
  mergeHexColorLists,
  MAX_BRAND_COLORS,
  type BrandbookExtractionInputPart,
  type BrandbookExtractionStatus,
  type SVGClassification,
} from './brandbookExtraction.js';

export type { SVGClassification };

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
  /**
   * Estado HONESTO da extração por IA. Antes, qualquer falha (JSON truncado, PDF
   * grande demais, conta sem crédito…) caía num catch com `console.warn` e a rota
   * devolvia sucesso com tudo zerado — a UI mostrava "Indexado com sucesso!" sem
   * nada dentro. Agora o status vai explícito para quem chamou.
   */
  extraction: {
    status: BrandbookExtractionStatus;
    warnings: string[];
    reason?: string;
  };
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
  // Partes que vão para a extração via IA (map-reduce: uma chamada por PDF, uma
  // chamada para o grupo de imagens). SEM o teto global de 6 que existia antes.
  const extractionParts: BrandbookExtractionInputPart[] = [];
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
      // "Raw" não quer dizer "sem higiene": o arquivo bruto vai para um bucket público.
      // SVG sai limpo como image/svg+xml e HTML vira download — antes o mimetype do
      // cliente ia direto, então um .html ou .svg do brandbook era XSS armazenado.
      const rawPrepared = await prepareStorableFile({
        buffer: file.buffer,
        fileName: file.originalname,
        mimeType: file.mimetype || 'application/octet-stream',
      });
      const rawR2Url = await uploadFileToR2(
        rawPrepared.buffer,
        file.originalname,
        rawPrepared.mimeType,
        `brands/${brand.id}/brandbooks_raw`
      );
      await prisma.asset.create({
        data: {
          brandId: brand.id,
          name: file.originalname,
          url: rawR2Url,
          fileType: rawPrepared.mimeType,
          sizeBytes: rawPrepared.buffer.length,
          source: 'brandbook',
          tags: ['brandbook-raw'],
          uploadedBy: uploadedByUserId ?? null,
          folderId: brandbooksFolder.id,
        },
      });
    } catch (rawSaveErr) {
      logger.warn('Falha ao salvar arquivo RAW do brandbook', { fileName: file.originalname, error: rawSaveErr instanceof Error ? rawSaveErr.message : String(rawSaveErr) });
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
              extractionParts.push({
                kind: 'image',
                mimeType: entryName.endsWith('.png') ? 'image/png' : 'image/jpeg',
                data: buffer.toString('base64'),
                fileName: entry.name || entry.entryName,
              });
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
      } else if (file.mimetype === 'application/pdf') {
        // Cada PDF é UMA parte própria — a extração faz uma chamada por PDF
        // (map-reduce) e decide sozinha se manda inline ou via Files API.
        extractionParts.push({ kind: 'pdf', buffer: file.buffer, fileName: file.originalname });
      } else if (file.mimetype.startsWith('image/')) {
        extractionParts.push({ kind: 'image', mimeType: file.mimetype, data: file.buffer.toString('base64'), fileName: file.originalname });
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
      // A classificação olha o texto ORIGINAL (heurística de string, não executa nada);
      // o que vai ao R2 é sempre o SVG higienizado. SVG irrecuperável lança
      // InvalidSvgError e cai no catch abaixo: este item é pulado, os outros seguem.
      const content = item.buffer.toString('utf-8');
      const classification = classifySVG(item.filename, content);
      const limpo = await sanitizeSvg(item.buffer);

      const r2Url = await uploadFileToR2(limpo.buffer, item.filename, 'image/svg+xml', `brands/${brand.id}/brandbook`);

      const asset = await prisma.asset.create({
        data: {
          name: item.filename,
          url: r2Url,
          fileType: 'image/svg+xml',
          sizeBytes: limpo.buffer.length,
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
      logger.warn('Falha ao salvar SVG do brandbook', { fileName: item.filename, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── Extração de inteligência via Gemini AI (função pura, sem efeito colateral) ────
  const combinedTextContent = textSnippets.join('\n\n').slice(0, 15000);
  const regexColors = extractColorsFromText(combinedTextContent);

  const currentColors = brand.config?.colors ?? [];
  const currentFonts = brand.config?.primaryFonts ?? [];
  const currentGuidelines = brand.config?.guidelines ?? '';
  const currentGuidelinesText = normalizarParaFormulario(currentGuidelines, brand.name).history;

  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const extraction = await extractBrandInsights({
    client: ai,
    brandName: brand.name,
    parts: extractionParts,
    sharedText: combinedTextContent,
    existingContext: {
      guidelines: currentGuidelinesText,
      colors: currentColors,
      primaryFonts: currentFonts,
    },
  });

  const warnings = [...extraction.warnings];

  // Processa SVGs pescados e remontados pela IA — só existem quando a extração teve
  // sucesso (em 'failed' a lista vem sempre vazia). Mesma higienização do upload real:
  // é texto de modelo que leu o material do usuário, não é mais confiável que upload.
  for (const item of extraction.svgs) {
    try {
      let cleanSvg = item.svgCode.trim();
      cleanSvg = cleanSvg.replace(/^```(xml|svg|json)?/i, '').replace(/```$/i, '').trim();
      if (!cleanSvg.includes('xmlns=')) {
        cleanSvg = cleanSvg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
      }

      const svgBuffer = (await sanitizeSvg(cleanSvg)).buffer;
      const filename = item.name || `vetor-ia-${Date.now()}.svg`;

      const r2Url = await uploadFileToR2(svgBuffer, filename, 'image/svg+xml', `brands/${brand.id}/brandbook`);

      const asset = await prisma.asset.create({
        data: {
          name: filename,
          url: r2Url,
          fileType: 'image/svg+xml',
          sizeBytes: svgBuffer.length,
          source: 'brandbook',
          tags: ['brandbook', 'ai-reconstructed', item.classification],
          brandId: brand.id,
          uploadedBy: uploadedByUserId ?? null,
          folderId: brandbooksFolder.id,
        },
      });

      processedSvgs.push({
        id: asset.id,
        name: asset.name,
        url: asset.url,
        classification: item.classification,
      });

      if (item.classification === 'LOGOTYPE') {
        logotypesCount++;
        if (!detectedLogoUrl) detectedLogoUrl = r2Url;
      } else if (item.classification === 'GRAPHIC_ELEMENT') {
        graphicElementsCount++;
      } else {
        illustrationsCount++;
      }
    } catch (err) {
      logger.warn('Falha ao salvar SVG reconstruído pela IA', { fileName: item.name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── Consolidação final de cores, fontes e diretrizes ─────────────────────
  // Falha total da IA: NÃO sobrescreve a marca com nada (nem cores, nem fontes, nem
  // guidelines) — o catch silencioso de antes deixava a rota devolver "sucesso" com
  // tudo zerado; agora a marca simplesmente fica como estava.
  if (extraction.status === 'failed') {
    return {
      guidelines: currentGuidelines,
      colors: currentColors,
      primaryFonts: currentFonts,
      svgsIndexed: {
        logotypes: logotypesCount,
        graphicElements: graphicElementsCount,
        illustrations: illustrationsCount,
        total: processedSvgs.length,
      },
      svgs: processedSvgs,
      logoNeedsConfirmation: false,
      detectedLogoUrl: null,
      currentLogoUrl: brand.config?.logoUrl ?? null,
      extraction: { status: extraction.status, warnings, reason: extraction.reason },
    };
  }

  const aiColorHexes = extraction.colors.map((c) => c.hex);
  // Prioridade: cores já cadastradas > cores da IA > cores de regex (só complemento).
  // Deduplicação por DISTÂNCIA de cor (não só string exata) — pega quase-duplicatas
  // como "#3e101f" e "#3c111c" vistas de verdade em produção. Teto subiu de 12 para
  // 24; o que passar do teto é descartado com aviso, não em silêncio.
  const { colors: mergedColors, droppedForCap } = mergeHexColorLists([currentColors, aiColorHexes, regexColors]);
  if (droppedForCap.length > 0) {
    warnings.push(`${droppedForCap.length} cor(es) além do teto de ${MAX_BRAND_COLORS} foram descartadas: ${droppedForCap.join(', ')}`);
  }

  const aiFontNames = extraction.primaryFonts.map((f) => f.family);
  const mergedFonts = Array.from(new Set([...currentFonts, ...aiFontNames])).filter(Boolean);

  // Concatenar texto aqui quebrava o formato: a página de Branding grava
  // `guidelines` como JSON, e "JSON + texto colado" deixa de ser JSON. A página
  // então caía no catch, enterrava tudo dentro de `history` e resetava o nome
  // para o placeholder. mesclarGuidelines entende os dois formatos e sempre
  // devolve JSON que a página reabre sem perder campo.
  const newGuidelines = extraction.guidelines
    ? mesclarGuidelines(currentGuidelines, extraction.guidelines)
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
    extraction: { status: extraction.status, warnings, reason: extraction.reason },
  };
}
