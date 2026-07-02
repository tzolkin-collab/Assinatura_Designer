import { getTemplate } from '../../lib/templates/index.js';
import type { PlannerOutput } from '../planner/index.js';
import {
  generateImageAssetForSlide,
  type InlineImageAsset,
  type LegacyBrandIdentity,
  type VisualRef,
} from '../../lib/fabricaLegacy.js';
import type { SemanticZone } from '../../lib/templates/types.js';

// slideIndex → { zoneId → imageUrl }
export type ImageOutput = Record<number, Record<string, string>>;

interface BrandRefs {
  refs: Array<{ insightsText: string | null; palette: string[] }>;
  uploadedAssets: Array<{ url: string; name?: string }>;
}

interface ConversationAsset {
  url: string;
  mimeType: string;
  name?: string;
}

export async function runImage(params: {
  plan: PlannerOutput;
  brand: LegacyBrandIdentity;
  brandContext: string;
  refs: VisualRef[];
  brandRefs: BrandRefs;
  conversationAssets: ConversationAsset[];
}): Promise<ImageOutput> {
  const { plan, brand, brandContext, refs, brandRefs, conversationAssets } = params;
  const output: ImageOutput = {};

  for (const slide of plan.slides) {
    const template = getTemplate(slide.templateId);
    if (!template) continue;

    const imageZones = template.semanticZones.filter((z: SemanticZone) => z.type === 'image');
    if (imageZones.length === 0) continue;

    output[slide.index] = {};

    let generatedDataUrl: string | null = null;

    for (const zone of imageZones) {
      const conversationMatch = conversationAssets[0];
      if (conversationMatch) {
        output[slide.index][zone.id] = conversationMatch.url;
        continue;
      }

      const brandAsset = brandRefs.uploadedAssets[0];
      if (brandAsset) {
        output[slide.index][zone.id] = brandAsset.url;
        continue;
      }

      if (!slide.imageHint) continue;

      if (!generatedDataUrl) {
        const inlineAssets: InlineImageAsset[] = conversationAssets.map((asset) => ({
          mimeType: asset.mimeType,
          dataBase64: asset.url.startsWith('data:') ? asset.url.split(',')[1] ?? '' : '',
          name: asset.name,
          source: 'conversation',
        })).filter((asset) => asset.dataBase64);

        try {
          generatedDataUrl = await generateImageAssetForSlide({
            prompt: `Slide ${slide.index + 1}: ${slide.imageHint}\nMensagem central: ${slide.keyMessage}\nFunção da imagem: apoiar o papel do slide (${slide.purpose}).`,
            brand,
            refs,
            width: template.dimensions.width,
            height: template.dimensions.height,
            brandCtx: [brandContext, `Direção visual do slide: ${plan.visualDirection}`].join('\n'),
            projectAssets: inlineAssets,
          });
        } catch (error) {
          console.warn(`[runImage] slide ${slide.index + 1} image generation failed:`, error);
          generatedDataUrl = null;
        }
      }

      if (generatedDataUrl) {
        output[slide.index][zone.id] = generatedDataUrl;
      }
    }
  }

  return output;
}

// Extrai imagens usadas em zonas de imagem de slides anteriores (evita repetição)
export function getUsedImageUrls(output: ImageOutput): string[] {
  return Object.values(output).flatMap(zones => Object.values(zones));
}
