import crypto from 'crypto';
import type { BrandRole } from '@prisma/client';

/**
 * Convites de equipe.
 *
 * O token cru só existe uma vez: é devolvido a quem convida (para virar link) e nunca
 * é persistido. No banco fica apenas o SHA-256 — assim um dump do banco não permite
 * aceitar convites alheios. Não usamos bcrypt aqui de propósito: o token já tem 256
 * bits de entropia, então não há o que "quebrar" por força bruta, e o lookup precisa
 * ser por índice (bcrypt teria salt por linha, forçando varredura da tabela inteira).
 */

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

/** Roles que um admin pode conceder num convite. OWNER fica de fora de propósito:
 *  transferir propriedade da marca não é um convite, é outra operação. */
export const INVITABLE_ROLES: BrandRole[] = ['ADMIN', 'EDITOR', 'VIEWER'];

export function isInvitableRole(role: unknown): role is BrandRole {
  return typeof role === 'string' && (INVITABLE_ROLES as string[]).includes(role);
}

export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function inviteExpiry(now = Date.now()): Date {
  return new Date(now + INVITE_TTL_MS);
}

export function buildInviteUrl(appOrigin: string, token: string): string {
  return `${appOrigin.replace(/\/$/, '')}/convite/${token}`;
}
