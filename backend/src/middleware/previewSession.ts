import prisma from '../lib/prisma.js';
import { enrichAiContext } from '../lib/aiContext.js';
import { READ_SCOPE } from '../mcp/config.js';
import { PREVIEW_TOKEN_PREFIX, type PreviewSessionContext } from '../mcp/preview.js';
import { resolveBrandGrants } from '../mcp/tools/authorization.js';
import { createError } from './errorHandler.js';
import type { AuthRequest } from './auth.js';

/**
 * Trava da sessão de navegador do agente (`designer.preview`), aplicada pelo `requireAuth` a todo token `mcpv_...`.
 *
 * Em vez de confiar que cada rota lembre de se proteger, a sessão é tratada como um usuário de PRIVILÉGIO MÍNIMO por
 * LISTA PERMITIDA: só passa o que está em `READ_ROUTES` abaixo, e só por GET/HEAD. Rota nova nasce proibida para a
 * sessão — para o agente ver uma tela nova é preciso listá-la aqui, de propósito. Isso cobre, de uma vez, escrita
 * (PUT/POST/PATCH/DELETE), exportação (GET /posts/:id/export*), integrações (Google/Canva/Asana), equipe, cobrança,
 * gasto de IA, notificações, a API de consentimento/conexões do próprio MCP e o WebSocket (que nem aceita este token).
 *
 * Marcas: para a rota com `brand: 'slug' | 'post'`, a marca precisa estar entre as da CONEXÃO (aprovadas ∩ associação
 * de agora). Fora delas a resposta é 404, igual a "não existe". A listagem `GET /api/brands` filtra no próprio handler
 * por `req.preview.brandIds`.
 */

export interface PreviewAuthenticator {
  authenticate(token: string): Promise<PreviewSessionContext | null>;
}

/** O que `requireAuth` deixa em `req.preview` para uma sessão do agente. */
export interface PreviewRequestInfo {
  sessionRef: string;
  expiresAt: number;
  familyId: string;
  /** Ids das marcas que a sessão enxerga AGORA (aprovadas na conexão ∩ associação atual). */
  brandIds: string[];
}

export const PREVIEW_ROLE = 'MCP_PREVIEW';

let authenticator: PreviewAuthenticator | null = null;

/** `mountMcp` registra o serviço aqui. Com o MCP desligado ninguém registra e todo `mcpv_` é recusado (401). */
export function setPreviewAuthenticator(next: PreviewAuthenticator | null): void {
  authenticator = next;
}

export function isPreviewToken(token: string): boolean {
  return token.startsWith(PREVIEW_TOKEN_PREFIX);
}

type BrandCheck = 'none' | 'list' | 'slug' | 'post';

const SEG = '([^/%?#\\s]+)';
const READ_ROUTES: Array<{ pattern: RegExp; brand: BrandCheck }> = [
  { pattern: /^\/api\/auth\/me$/i, brand: 'none' },
  { pattern: /^\/api\/brands$/i, brand: 'list' },
  { pattern: new RegExp(`^/api/brands/${SEG}$`, 'i'), brand: 'slug' },
  { pattern: new RegExp(`^/api/brands/${SEG}/(posts|profile|memory|assets)$`, 'i'), brand: 'slug' },
  { pattern: new RegExp(`^/api/settings/${SEG}/config$`, 'i'), brand: 'slug' },
  { pattern: new RegExp(`^/api/folders/${SEG}$`, 'i'), brand: 'slug' },
  { pattern: new RegExp(`^/api/posts/${SEG}$`, 'i'), brand: 'post' },
  { pattern: new RegExp(`^/api/posts/${SEG}/versions$`, 'i'), brand: 'post' },
  { pattern: new RegExp(`^/api/posts/${SEG}/slides/\\d{1,4}/photo-slots$`, 'i'), brand: 'post' },
];

const FORBIDDEN_MESSAGE = 'Sessão de visualização do agente: somente leitura. Esta ação não é permitida.';

/** Valida o token `mcpv_`, a lista permitida e a marca. Em caso de sucesso preenche `req.user` e `req.preview`. */
export async function authenticatePreviewRequest(req: AuthRequest, token: string): Promise<void> {
  if (!authenticator) throw createError(401, 'Unauthorized — Invalid Token');
  const session = await authenticator.authenticate(token);
  if (!session) throw createError(401, 'Sessão de visualização encerrada ou expirada.', 'MCP_PREVIEW_ENDED');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    throw createError(403, FORBIDDEN_MESSAGE, 'MCP_PREVIEW_READ_ONLY');
  }

  const path = (req.originalUrl ?? req.url).split('?')[0] ?? '';
  let route: (typeof READ_ROUTES)[number] | undefined;
  let match: RegExpMatchArray | null = null;
  for (const candidate of READ_ROUTES) {
    match = path.match(candidate.pattern);
    if (match) {
      route = candidate;
      break;
    }
  }
  if (!route || !match) throw createError(403, FORBIDDEN_MESSAGE, 'MCP_PREVIEW_READ_ONLY');

  const grants = await resolveBrandGrants({
    userId: session.userId,
    brandIds: session.brandIds,
    brandMode: session.brandMode,
    scope: READ_SCOPE,
  });
  const allowedIds = new Set(grants.map((g) => g.id));

  if (route.brand === 'slug') {
    const slug = decodeURIComponent(match[1] ?? '');
    if (!grants.some((g) => g.slug === slug)) throw createError(404, 'Marca não encontrada.', 'MCP_PREVIEW_BRAND');
  } else if (route.brand === 'post') {
    const post = await prisma.post.findUnique({ where: { id: decodeURIComponent(match[1] ?? '') }, select: { brandId: true } });
    // Post inexistente segue para a rota (que responde 404); post de outra marca é 404 aqui, igual.
    if (post && !allowedIds.has(post.brandId)) throw createError(404, 'Post not found', 'MCP_PREVIEW_BRAND');
  }

  // Papel PRÓPRIO: nunca herda o papel global do usuário (um `rootSystem`/ADMIN conectado não vira admin pelo cookie).
  req.user = { userId: session.userId, role: PREVIEW_ROLE };
  req.preview = {
    sessionRef: session.sessionRef,
    expiresAt: session.expiresAt,
    familyId: session.familyId,
    brandIds: [...allowedIds],
  };
  enrichAiContext({ userId: session.userId });
}
