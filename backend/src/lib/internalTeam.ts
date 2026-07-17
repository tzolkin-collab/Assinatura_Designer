// Equipe interna: TODO usuário é membro de TODA marca.
//
// Decisão de produto (2026-07-17): o Designer é ferramenta INTERNA da equipe —
// o multi-tenant por convite fazia contas verem "sistemas diferentes" (conta
// sem membership logava num app deserto). Em vez de um backfill avulso que
// derrete no primeiro usuário/marca novos, o servidor GARANTE o invariante na
// subida e após criar marca/usuário.
//
// Papéis: membership existente NUNCA é rebaixada/alterada; só criamos as que
// faltam — user.role ADMIN vira OWNER da marca, demais viram EDITOR (podem
// criar/editar/exportar; gestão de equipe/integrações continua com OWNER/ADMIN).

import prisma from './prisma.js';
import { logger } from './logger.js';

export async function ensureInternalTeamMemberships(): Promise<void> {
  const [users, brands, existing] = await Promise.all([
    prisma.user.findMany({ select: { id: true, role: true } }),
    prisma.brand.findMany({ select: { id: true } }),
    prisma.brandMember.findMany({ select: { userId: true, brandId: true } }),
  ]);

  const has = new Set(existing.map((m) => `${m.userId}:${m.brandId}`));
  const missing: Array<{ userId: string; brandId: string; role: 'OWNER' | 'EDITOR' }> = [];

  for (const u of users) {
    for (const b of brands) {
      if (!has.has(`${u.id}:${b.id}`)) {
        missing.push({ userId: u.id, brandId: b.id, role: u.role === 'ADMIN' ? 'OWNER' : 'EDITOR' });
      }
    }
  }

  if (missing.length === 0) return;

  await prisma.brandMember.createMany({ data: missing, skipDuplicates: true });
  logger.info('Equipe interna sincronizada: memberships criadas', { criadas: missing.length });
}
