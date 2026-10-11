import prisma from '../prisma.js';
import { logger } from '../logger.js';
import { brandProfileSchema, type BrandProfileData } from '../brandProfile.js';
import { isDesignerBrainEnabled } from './enabled.js';

/**
 * A ficha SALVA do projeto (Cérebro da IA). É a fonte do cérebro: quem a salvou escolheu estas
 * regras, e o pipeline as lê dali. Ficha só derivada dos campos antigos (nunca salva) não conta:
 * ela é uma sugestão, não uma decisão.
 *
 * Linha que não passa no schema vira "sem ficha" com aviso no log, em vez de derrubar a geração.
 */
export async function loadSavedProfileBySlug(brandSlug: string): Promise<BrandProfileData | null> {
  let row: { data: unknown } | null;
  try {
    row = await prisma.brandProfile.findFirst({
      where: { brand: { slug: brandSlug.trim().toLowerCase() } },
      select: { data: true },
    });
  } catch (err) {
    // Banco sem a tabela da ficha (migration ainda não aplicada) ou fora do ar: uma geração não pode
    // cair por causa de uma camada opcional. Sem ficha, a marca segue no caminho que já tinha.
    logger.warn('Não foi possível ler a ficha do projeto: geração segue sem ela', {
      brandSlug,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  if (!row) return null;
  const parsed = brandProfileSchema.safeParse(row.data);
  if (!parsed.success) {
    logger.warn('Ficha salva inválida: ignorada na geração', { brandSlug, issues: parsed.error.issues.length });
    return null;
  }
  return parsed.data;
}

/**
 * O cérebro está ativo para a marca quando ela tem ficha salva. `DESIGNER_BRAIN_BRANDS` continua
 * valendo como retaguarda até as marcas piloto (a Amanda) existirem como ficha no banco.
 */
export async function isBrainActiveForBrand(brandSlug: string): Promise<boolean> {
  if (isDesignerBrainEnabled(brandSlug)) return true;
  return (await loadSavedProfileBySlug(brandSlug)) !== null;
}
