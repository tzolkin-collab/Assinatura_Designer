import { createError } from '../middleware/errorHandler.js';
import type { PresentationConfig } from './fabricaSession.js';
import prisma from './prisma.js';
import { REFERENCE_ASSET_TAGS } from './designerBrain/referenceTags.js';

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
  /**
   * Bibliotecas de onde a marca pode usar arquivos: a dela e, num desdobramento, a da base (ele
   * herda a identidade da base: logo, fotos, manual). A própria marca vem primeiro.
   */
  libraryBrandIds: string[];
  /** Imagens do pool de assets da marca (upload/Drive/Asana) — o artista as usa em
   *  vez de inventar fotos de banco quando fizer sentido para o layout. Nome junto
   *  (antes era só URL crua — o artista escolhia sem nenhuma pista do conteúdo). */
  assetUrls: Array<{ url: string; name: string; /** upload | drive | asana | canva | ai-generated */ source?: string }>;
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
      assets: {
        where: {
          // Material de referência (manual visual, moodboard, fonte, paleta) é para o modelo VER, não para entrar num slide.
          NOT: { tags: { hasSome: [...REFERENCE_ASSET_TAGS] } },
          OR: [
            { fileType: { startsWith: 'image/' } },
            { fileType: 'image/svg+xml' },
            { tags: { hasSome: ['LOGOTYPE', 'GRAPHIC_ELEMENT', 'ILLUSTRATION', 'brandbook'] } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { url: true, name: true, tags: true, source: true },
      },
    },
  });

  if (!brand) throw createError(404, 'Brand not found');

  let assets = brand.assets;
  const libraryBrandIds = [brand.id];
  if (brand.parentBrandId) {
    libraryBrandIds.push(brand.parentBrandId);
    const parentAssets = await prisma.asset.findMany({
      where: {
        brandId: brand.parentBrandId,
        NOT: { tags: { hasSome: [...REFERENCE_ASSET_TAGS] } },
        OR: [
          { fileType: { startsWith: 'image/' } },
          { fileType: 'image/svg+xml' },
          { tags: { hasSome: ['LOGOTYPE', 'GRAPHIC_ELEMENT', 'ILLUSTRATION', 'brandbook'] } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { url: true, name: true, tags: true, source: true },
    });
    const seen = new Set(assets.map((a) => a.url));
    // Os da própria marca primeiro; a base completa o que sobrar do teto de 20.
    assets = [...assets, ...parentAssets.filter((a) => !seen.has(a.url))].slice(0, 20);
  }

  return {
    id: brand.id,
    libraryBrandIds,
    name: brand.name,
    slug: brand.slug,
    guidelines: brand.config?.guidelines ?? '',
    agentPrompt: brand.config?.agentPrompt ?? '',
    colors: brand.config?.colors ?? [],
    primaryFonts: brand.config?.primaryFonts ?? [],
    logoUrl: brand.config?.logoUrl,
    presentationConfig: normalizePresentationConfig(brand.config?.presentationConfig),
    assetUrls: assets.map((a) => ({ url: a.url, name: `${a.name}${a.tags.length ? ` [${a.tags.join(',')}]` : ''}`, source: a.source })),
  };
}

export function buildBrandContextSummary(context: ResolvedBrandContext): string {
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
    context.presentationConfig?.allowSvgLayouts === false ? 'Desenho vetorial: NÃO use <svg> inline nesta marca — resolva com CSS puro.' : '',
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
  ].filter(Boolean).join('\n');
}
