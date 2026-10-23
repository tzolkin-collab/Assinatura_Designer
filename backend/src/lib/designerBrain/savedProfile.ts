import prisma from '../prisma.js';
import { logger } from '../logger.js';
import { collabDetailsSchema, type CollabDetails } from '../brandCollab.js';
import { brandProfileSchema, renderProjectMemory, type BrandProfileData } from '../brandProfile.js';
import { isBrainOnWithoutProfile } from './enabled.js';
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

/** A leitura da ficha FALHOU (banco fora, erro inesperado): não dá para saber se o projeto tem ficha. */
export class BrainLayersReadError extends Error {
  constructor(readonly brandSlug: string, readonly cause: unknown) {
    super(`Não foi possível ler a ficha do projeto "${brandSlug}": ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'BrainLayersReadError';
  }
}

/**
 * Banco com migrations parciais: Prisma P2021 (a tabela não existe) ou P2022 (a coluna não existe). Os
 * dois dizem a mesma coisa, que a migration da ficha ainda não foi aplicada por inteiro neste banco.
 */
function isPartialMigration(err: unknown): boolean {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  return code === 'P2021' || code === 'P2022';
}

/**
 * `null` = a marca não tem ficha salva (nem ela nem a base). Isso NÃO desliga o cérebro: ele é global
 * e a marca segue com as camadas globais e a memória que o `resolveProjectMemory` achar.
 *
 * Falha de leitura NÃO é "sem ficha": um projeto que TEM ficha não pode seguir em silêncio como se não
 * tivesse. Aqui ela vira `BrainLayersReadError`, e quem gera (o pipeline) para com erro visível. A única
 * exceção é tabela ou coluna inexistente (P2021/P2022, banco com migrations parciais): aí não existe ficha
 * alguma para perder, então vale como "sem ficha", com aviso no log (nível warn), para não quebrar toda
 * geração enquanto a migration não é aplicada. Qualquer outro erro continua parando a geração.
 */
export async function loadBrainLayersStrict(brandSlug: string): Promise<BrainLayers | null> {
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
    if (isPartialMigration(err)) {
      logger.warn('Tabela ou coluna da ficha não existe (migration não aplicada ou parcial): projeto tratado como sem ficha', {
        brandSlug,
        code: (err as { code?: string }).code,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    throw new BrainLayersReadError(brandSlug, err);
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

/**
 * Versão tolerante, para quem só LÊ a ficha sem gerar nada (as tools MCP e o chat, que só decidem se o
 * cérebro está ativo): se a leitura falhar devolve `null` com aviso no log, como sempre fez. Quem GERA
 * a peça usa `loadBrainLayersStrict`, que não engole a falha.
 */
export async function loadBrainLayers(brandSlug: string): Promise<BrainLayers | null> {
  try {
    return await loadBrainLayersStrict(brandSlug);
  } catch (err) {
    if (!(err instanceof BrainLayersReadError)) throw err;
    logger.warn('Não foi possível ler a ficha do projeto: seguindo sem ela', { brandSlug, error: err.message });
    return null;
  }
}

/** Compatível com quem só quer a ficha do projeto. */
export async function loadSavedProfileBySlug(brandSlug: string): Promise<BrandProfileData | null> {
  return (await loadBrainLayers(brandSlug))?.projectProfile ?? null;
}

/**
 * O cérebro está ativo para a marca. Por padrão (cérebro global) SEMPRE, com ou sem ficha. Só na
 * saída de emergência (`DESIGNER_BRAIN_GLOBAL=off`) volta a depender de ficha salva (da marca ou da
 * base) ou de o slug estar em `DESIGNER_BRAIN_BRANDS`. O pipeline usa a mesma regra
 * (`isBrainOnWithoutProfile`) em vez de uma cópia, para a API e o worker nunca divergirem.
 */
export async function isBrainActiveForBrand(brandSlug: string): Promise<boolean> {
  if (isBrainOnWithoutProfile(brandSlug)) return true;
  return (await loadBrainLayers(brandSlug)) !== null;
}
