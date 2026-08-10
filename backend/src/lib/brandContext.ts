import { createError } from '../middleware/errorHandler.js';
import type { PresentationConfig } from './fabricaSession.js';
import prisma from './prisma.js';

export type DesignDocumentBrandContext = {
  name: string;
  slug: string;
  guidelines: string;
  agentPrompt: string;
  colors: string[];
  primaryFonts: string[];
  logoUrl?: string | null;
  presentationConfig?: PresentationConfig | null;
};

export type ResolvedBrandContext = DesignDocumentBrandContext & {
  id: string;
  references: Array<{
    name: string;
    archetype: string | null;
    toneOfVoice: string | null;
    density: string | null;
    palette: string[];
    insightsText: string | null;
  }>;
  /** Imagens do pool de assets da marca (upload/Drive/Asana) — o artista as usa em
   *  vez de inventar fotos de banco quando fizer sentido para o layout. Nome junto
   *  (antes era só URL crua — o artista escolhia sem nenhuma pista do conteúdo). */
  assetUrls: Array<{ url: string; name: string }>;
};

function normalizePresentationConfig(value: unknown): PresentationConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as PresentationConfig;
}

/**
 * Carrega o contexto da marca. **Não autoriza nada** — quem chama já deve ter passado
 * pelo `brandAccess` (middleware `requireBrandRole` ou `assertBrandAccess`).
 *
 * Antes esta função recebia um `userId` que era simplesmente ignorado, e o nome deu a
 * entender que havia checagem de acesso: rotas inteiras (ai, fabrica) ficaram abertas
 * por causa disso. O parâmetro foi removido para que a assinatura não volte a mentir.
 */
export async function resolveBrandContext(slug: string): Promise<ResolvedBrandContext> {
  const brand = await prisma.brand.findUnique({
    where: { slug },
    include: {
      config: true,
      refs: {
        where: { status: 'ANALYZED' },
        orderBy: { updatedAt: 'desc' },
        take: 8,
      },
      assets: {
        where: {
          OR: [
            { fileType: { startsWith: 'image/' } },
            { fileType: 'image/svg+xml' },
            { tags: { hasSome: ['LOGOTYPE', 'GRAPHIC_ELEMENT', 'ILLUSTRATION', 'brandbook'] } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { url: true, name: true, tags: true },
      },
    },
  });

  if (!brand) throw createError(404, 'Brand not found');

  return {
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    guidelines: brand.config?.guidelines ?? '',
    agentPrompt: brand.config?.agentPrompt ?? '',
    colors: brand.config?.colors ?? [],
    primaryFonts: brand.config?.primaryFonts ?? [],
    logoUrl: brand.config?.logoUrl,
    presentationConfig: normalizePresentationConfig(brand.config?.presentationConfig),
    references: brand.refs.map((ref) => ({
      name: ref.name,
      archetype: ref.archetype,
      toneOfVoice: ref.toneOfVoice,
      density: ref.density,
      palette: ref.palette,
      insightsText: ref.insightsText,
    })),
    assetUrls: brand.assets.map((a) => ({ url: a.url, name: `${a.name}${a.tags.length ? ` [${a.tags.join(',')}]` : ''}` })),
  };
}

export function buildBrandContextSummary(context: ResolvedBrandContext): string {
  const referenceLines = context.references
    .slice(0, 4)
    .map((reference) => {
      const descriptors = [reference.archetype, reference.toneOfVoice, reference.density]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(' · ');
      const palette = reference.palette.length > 0 ? `Paleta: ${reference.palette.join(', ')}` : '';
      const insights = typeof reference.insightsText === 'string' && reference.insightsText.trim().length > 0
        ? `Insights: ${reference.insightsText.trim().slice(0, 220)}`
        : '';
      return [`- ${reference.name}`, descriptors, palette, insights].filter(Boolean).join(' | ');
    });

  return [
    `Marca: ${context.name}`,
    context.guidelines ? `Diretrizes: ${context.guidelines}` : '',
    context.agentPrompt ? `Instruções do agente: ${context.agentPrompt}` : '',
    context.colors.length > 0 ? `Cores: ${context.colors.join(', ')}` : '',
    context.primaryFonts.length > 0 ? `Fontes: ${context.primaryFonts.join(', ')}` : '',
    context.presentationConfig?.visualVibe ? `Vibe visual preferida: ${context.presentationConfig.visualVibe}` : '',
    context.presentationConfig?.paletteDirection ? `Direção de paleta: ${context.presentationConfig.paletteDirection}` : '',
    context.presentationConfig?.paletteApproved?.length ? `Paleta aprovada: ${context.presentationConfig.paletteApproved.join(', ')}` : '',
    context.presentationConfig?.photoPreference ? `Preferência de fotos: ${context.presentationConfig.photoPreference}` : '',
    context.presentationConfig?.boldness ? `Nível de ousadia: ${context.presentationConfig.boldness}` : '',
    context.presentationConfig?.autoMode !== undefined ? `Modo automático padrão: ${context.presentationConfig.autoMode ? 'ativo' : 'desativado'}` : '',
    referenceLines.length > 0 ? `Referências analisadas:\n${referenceLines.join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

export function buildBrandAssistantInstruction(context: ResolvedBrandContext): string {
  return [
    `You are an expert design assistant for the brand "${context.name}".`,
    context.guidelines ? `Brand Guidelines: ${context.guidelines}` : '',
    context.agentPrompt ? `Agent Instructions: ${context.agentPrompt}` : '',
    context.colors.length > 0 ? `Brand Colors: ${context.colors.join(', ')}` : '',
    context.primaryFonts.length > 0 ? `Primary Fonts: ${context.primaryFonts.join(', ')}` : '',
    context.presentationConfig?.visualVibe ? `Visual Vibe: ${context.presentationConfig.visualVibe}` : '',
    context.presentationConfig?.paletteDirection ? `Palette Direction: ${context.presentationConfig.paletteDirection}` : '',
    context.presentationConfig?.paletteApproved?.length ? `Approved Palette: ${context.presentationConfig.paletteApproved.join(', ')}` : '',
    context.presentationConfig?.photoPreference ? `Photo Preference: ${context.presentationConfig.photoPreference}` : '',
    context.presentationConfig?.boldness ? `Boldness: ${context.presentationConfig.boldness}` : '',
    context.presentationConfig?.autoMode !== undefined ? `Default Auto Mode: ${context.presentationConfig.autoMode ? 'enabled' : 'disabled'}` : '',
    context.references.length > 0
      ? `Analyzed References:\n${context.references.slice(0, 4).map((reference) => {
          const palette = reference.palette.length > 0 ? `Palette ${reference.palette.join(', ')}` : '';
          const descriptors = [reference.archetype, reference.toneOfVoice, reference.density]
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .join(' · ');
          return `- ${reference.name}${descriptors ? ` | ${descriptors}` : ''}${palette ? ` | ${palette}` : ''}`;
        }).join('\n')}`
      : '',
  ].filter(Boolean).join('\n');
}
