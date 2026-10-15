import prisma from '../prisma.js';
import { logger } from '../logger.js';
import { collabDetailsSchema, type CollabDetails } from '../brandCollab.js';
import { brandProfileSchema, renderProjectMemory, type BrandProfileData } from '../brandProfile.js';
import { isDesignerBrainEnabled } from './enabled.js';
import type { BrainAsset, CollabLayer } from './types.js';

/**
 * As camadas que o cérebro lê de UMA marca: a ficha SALVA do projeto-base e, quando a marca é um
 * desdobramento, a camada de collab com SÓ o que muda. Ficha só derivada dos campos antigos (nunca
 * salva) não conta: ela é uma sugestão, não uma decisão.
 *
 * Desdobramento herda a identidade da base: quem manda é a ficha do projeto-base. Se a base não
 * tem ficha mas o desdobramento tem, a do desdobramento ocupa o lugar de projeto.
 */
export interface BrainLayers {
  projectName: string;
  projectProfile: BrandProfileData | null;
  collab: CollabLayer | null;
}

function parseProfile(raw: unknown, brandSlug: string): BrandProfileData | null {
  if (raw === null || raw === undefined) return null;
  const parsed = brandProfileSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn('Ficha salva inválida: ignorada na geração', { brandSlug, issues: parsed.error.issues.length });
    return null;
  }
  return parsed.data;
}

/** O "o que muda" do desdobramento, em texto: contexto, objetivo, público, campanha, parceiro. */
export function renderCollabMemory(details: CollabDetails, ownProfile: BrandProfileData | null, name: string): string {
  const lines = [
    details.context?.trim() ? `Contexto: ${details.context.trim()}` : '',
    details.objective?.trim() ? `Objetivo: ${details.objective.trim()}` : '',
    details.audience?.trim() ? `Público: ${details.audience.trim()}` : '',
    details.campaign?.trim() ? `Produto/campanha: ${details.campaign.trim()}` : '',
    details.partner
      ? `Parceiro: ${details.partner.name}${details.partner.logoUrl ? ' (logo nos ativos)' : ''}${details.partner.visualManualUrl ? ' (guia visual nos ativos)' : ''}`
      : '',
  ].filter(Boolean);
  if (ownProfile) {
    const own = renderProjectMemory(name, ownProfile);
    if (own.includes('\n')) lines.push(`AJUSTES PRÓPRIOS DESTE DESDOBRAMENTO (valem só aqui):\n${own}`);
  }
  return lines.join('\n');
}

function collabAssets(details: CollabDetails): BrainAsset[] {
  const out: BrainAsset[] = [];
  if (details.partner?.logoUrl) out.push({ name: `Logo do parceiro ${details.partner.name}`, url: details.partner.logoUrl, role: 'logo' });
  if (details.partner?.visualManualUrl) {
    out.push({ name: `Guia visual do parceiro ${details.partner.name}`, url: details.partner.visualManualUrl, role: 'visual-manual' });
  }
  return out;
}

/**
 * `null` = a marca não tem ficha salva (nem ela nem a base): o cérebro fica desligado, como antes.
 * Se a leitura falhar (tabela sem migration, banco fora) a geração segue sem o cérebro, com aviso
 * no log: uma camada opcional não pode derrubar a geração.
 */
export async function loadBrainLayers(brandSlug: string): Promise<BrainLayers | null> {
  const slug = brandSlug.trim().toLowerCase();
  let row;
  try {
    row = await prisma.brand.findUnique({
      where: { slug },
      select: {
        name: true,
        kind: true,
        collab: true,
        profile: { select: { data: true } },
        parent: { select: { name: true, slug: true, profile: { select: { data: true } } } },
      },
    });
  } catch (err) {
    logger.warn('Não foi possível ler a ficha do projeto: geração segue sem ela', {
      brandSlug,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  if (!row) return null;

  const own = parseProfile(row.profile?.data, slug);

  if (!row.parent) {
    return own ? { projectName: row.name, projectProfile: own, collab: null } : null;
  }

  const base = parseProfile(row.parent.profile?.data, row.parent.slug);
  if (!base && !own) return null;

  const detailsParsed = collabDetailsSchema.safeParse(row.collab ?? {});
  if (!detailsParsed.success) logger.warn('Detalhes do desdobramento inválidos: ignorados', { brandSlug });
  const details: CollabDetails = detailsParsed.success ? detailsParsed.data : {};
  const partnership = row.kind === 'PARTNERSHIP';

  return {
    // Sem ficha na base, a do próprio desdobramento é o projeto e não entra duas vezes como "ajuste".
    projectName: base ? row.parent.name : row.name,
    projectProfile: base ?? own,
    collab: {
      name: row.name,
      kind: partnership ? 'partnership' : 'internal',
      memory: renderCollabMemory(details, base ? own : null, row.name),
      ...(partnership && details.baseProtagonism !== undefined ? { leadPercent: details.baseProtagonism } : {}),
      assets: collabAssets(details),
    },
  };
}

/** Compatível com quem só quer a ficha do projeto. */
export async function loadSavedProfileBySlug(brandSlug: string): Promise<BrandProfileData | null> {
  return (await loadBrainLayers(brandSlug))?.projectProfile ?? null;
}

/**
 * O cérebro está ativo para a marca quando ela (ou a base dela) tem ficha salva.
 * `DESIGNER_BRAIN_BRANDS` continua valendo como retaguarda até as marcas piloto (a Amanda)
 * existirem como ficha no banco.
 */
export async function isBrainActiveForBrand(brandSlug: string): Promise<boolean> {
  if (isDesignerBrainEnabled(brandSlug)) return true;
  return (await loadBrainLayers(brandSlug)) !== null;
}
