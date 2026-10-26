// Leitura e gravação da ficha do projeto (Cérebro de IA), compartilhadas pela rota HTTP e pela ferramenta MCP.
//
// Um só caminho de gravação garante que as duas portas apliquem as mesmas regras: arquivos da biblioteca da
// própria marca e medição dos logos (fundo exato e versão transparente).

import type { Prisma } from '@prisma/client';
import { brandProfileSchema, profileFromLegacy, type BrandProfileData } from './brandProfile.js';
import { enrichLogoFiles } from './logoEnrich.js';
import prisma from './prisma.js';

/** Logo, manual visual ou fonte que não é da biblioteca desta marca. A mensagem é segura para o usuário. */
export class ProfileFilesError extends Error {
  constructor() {
    super('Logo, manual visual e fontes precisam estar na biblioteca do projeto.');
    this.name = 'ProfileFilesError';
  }
}

/** A ficha de agora. Sem ficha salva, devolve a derivada dos campos antigos (`derived: true`); nada é gravado. */
export async function loadBrandProfile(brandId: string): Promise<{ profile: BrandProfileData; derived: boolean }> {
  const row = await prisma.brandProfile.findUnique({ where: { brandId } });
  if (row) {
    // Dado gravado fora do esquema cai na ficha vazia, como na tela.
    const parsed = brandProfileSchema.safeParse(row.data);
    return { profile: parsed.success ? parsed.data : {}, derived: false };
  }
  const config = await prisma.brandConfig.findUnique({ where: { brandId } });
  return { profile: profileFromLegacy(config), derived: true };
}

/**
 * Grava a ficha inteira. Logo, manual visual e arquivos de fonte têm de ser da biblioteca DESTA marca (mesmo
 * critério da troca de foto): sem isso o cliente mandaria qualquer URL e o servidor iria buscá-la (SSRF) ou
 * usaria arquivo de outra marca. Fundo exato e versão transparente dos logos são medidos aqui, nunca aceitos de fora.
 */
export async function saveBrandProfile(brandId: string, profile: BrandProfileData): Promise<BrandProfileData> {
  const arquivos = [
    ...(profile.logo?.files ?? []).map((f) => f.url),
    profile.visualManual?.imageUrl,
    ...(profile.typography ?? []).flatMap((t) => [t.fileUrl, t.referenceImageUrl]),
  ].filter((u): u is string => Boolean(u));
  for (const url of new Set(arquivos)) {
    const asset = await prisma.asset.findFirst({ where: { brandId, url }, select: { id: true } });
    if (!asset) throw new ProfileFilesError();
  }

  if (profile.logo?.files?.length) {
    const atual = await prisma.brandProfile.findUnique({ where: { brandId }, select: { data: true } });
    const anterior = brandProfileSchema.safeParse(atual?.data);
    profile = {
      ...profile,
      logo: { ...profile.logo, files: await enrichLogoFiles(profile.logo.files, anterior.success ? (anterior.data.logo?.files ?? []) : []) },
    };
  }

  const data = profile as unknown as Prisma.InputJsonValue;
  await prisma.brandProfile.upsert({ where: { brandId }, create: { brandId, data }, update: { data } });
  return profile;
}
