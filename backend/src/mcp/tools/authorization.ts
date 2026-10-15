import prisma from '../../lib/prisma.js';
import { ROLES_FOR_SCOPE, type BrandMode, type McpScope } from '../config.js';
import type { BrandGrant } from './types.js';

/**
 * Autorização por marca das ferramentas MCP — O ÚNICO lugar onde isso acontece.
 *
 * Duas fontes precisam concordar a cada chamada:
 *  1. o TOKEN: as marcas que o usuário aprovou no consentimento (`brandIds`) ou o modo
 *     "todas" (`brandMode`), que dispensa a lista;
 *  2. a ASSOCIAÇÃO ATUAL: a linha de BrandMember de agora, com o papel de agora.
 *
 * Só vale a interseção. Por isso, se o usuário é removido da marca ou rebaixado
 * (EDITOR → VIEWER) depois de conectar, o acesso cai na chamada seguinte — sem esperar
 * o access token expirar nem exigir revogação manual. E por isso um token aprovado
 * para a marca A nunca enxerga a marca B, mesmo que o usuário seja membro das duas.
 *
 * É uma consulta só por chamada (índice único userId+brandId já existe no schema).
 */
export async function resolveBrandGrants(params: {
  userId: string;
  brandIds: string[];
  scope: McpScope;
  /**
   * 'all' = o usuário escolheu "todas as minhas marcas": o token guarda o MODO, não uma lista,
   * e a associação de agora define o conjunto — inclui marcas criadas depois e exclui as que
   * ele perdeu. 'selected' (padrão) = só a interseção com `brandIds`.
   */
  brandMode?: BrandMode;
}): Promise<BrandGrant[]> {
  const all = params.brandMode === 'all';
  if (!all && params.brandIds.length === 0) return [];

  const rows = await prisma.brandMember.findMany({
    where: {
      userId: params.userId,
      ...(all ? {} : { brandId: { in: params.brandIds } }),
      // O papel precisa satisfazer o escopo da ferramenta: leitura = qualquer membro,
      // escrita = OWNER/ADMIN/EDITOR (mesma regra do app web).
      role: { in: ROLES_FOR_SCOPE[params.scope] },
    },
    select: { role: true, brand: { select: { id: true, slug: true, name: true } } },
  });

  return rows
    .map((row) => ({ id: row.brand.id, slug: row.brand.slug, name: row.brand.name, role: row.role }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
