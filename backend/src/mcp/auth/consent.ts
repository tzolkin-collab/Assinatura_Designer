import { Router, type NextFunction, type Response } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { parseBody } from '../../lib/validate.js';
import { createError } from '../../middleware/errorHandler.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import {
  isMcpScope,
  normalizeScopes,
  ROLES_FOR_SCOPE,
  WRITE_SCOPE,
  type McpConfig,
  type McpScope,
} from '../config.js';
import type { McpOAuthStore } from '../store.js';
import { TTL } from './constants.js';
import { escapeHtml, randomSecret, sha256Hex } from './crypto.js';
import type { DesignerOAuthProvider } from './provider.js';
import type { McpLimits } from '../limits.js';

/**
 * Consentimento do usuário e gestão das conexões — a API que a tela do frontend usa.
 *
 * É AQUI que o conector deixa de ser anônimo: o /authorize só estaciona o pedido;
 * quem emite o código é o POST abaixo, e só para um usuário autenticado (JWT no header
 * Authorization, via `requireAuth` no ponto de montagem).
 *
 * CSRF: o JWT do app vai em header `Authorization` (frontend/src/lib/api.ts), nunca em
 * cookie, então o navegador não anexa credencial sozinho a um POST forjado por outro
 * site — não há "ambient authority" para o CSRF explorar. O id do pedido (256 bits,
 * uso único, 10 min) amarra a decisão ao /authorize que a originou.
 *
 * Risco residual conhecido (consent phishing): um atacante com conta própria no ChatGPT
 * pode iniciar o fluxo e mandar o link de consentimento a um membro da equipe. A
 * mitigação é a própria tela — que mostra QUEM pede (nome + host do redirect) e QUAIS
 * marcas/escopos serão liberados — e o fato de só membros logados conseguirem aprovar.
 */

const NOT_FOUND = 'Pedido de autorização inexistente ou expirado. Volte ao ChatGPT e conecte de novo.';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

const decisionSchema = z.object({
  decision: z.enum(['approve', 'deny']),
  brandSlugs: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  scopes: z.array(z.string().max(40)).max(10).optional(),
});

interface ConsentDeps {
  store: McpOAuthStore;
  config: McpConfig;
  provider: DesignerOAuthProvider;
  limits: McpLimits;
  now?: () => number;
}

function redirectWith(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(name, value);
  }
  return url.href;
}

function requestHash(rawId: string): string {
  if (!REQUEST_ID_PATTERN.test(rawId)) throw createError(404, NOT_FOUND, 'MCP_REQUEST_NOT_FOUND');
  return sha256Hex(rawId);
}

export function createConsentRouter(deps: ConsentDeps): Router {
  const { store, config, provider } = deps;
  const now = deps.now ?? Date.now;
  const router = Router();

  // Resposta com credencial/decisão nunca pode ficar em cache de proxy ou navegador.
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  /** O que a tela mostra: quem pede, o que pede e o que o usuário pode liberar. */
  router.get(
    '/consent/:requestId',
    rateLimit({ ...deps.limits.consent, keyPrefix: `${deps.limits.keyPrefix}-consent-view`, keyBy: 'user' }),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const userId = req.user!.userId;
        const pending = await store.getPendingRequest(requestHash(req.params.requestId as string));
        if (!pending) throw createError(404, NOT_FOUND, 'MCP_REQUEST_NOT_FOUND');
        const client = await store.getClient(pending.clientId);
        if (!client) throw createError(404, NOT_FOUND, 'MCP_REQUEST_NOT_FOUND');

        const memberships = await prisma.brandMember.findMany({
          where: { userId },
          select: { role: true, brand: { select: { id: true, slug: true, name: true } } },
          orderBy: { brand: { name: 'asc' } },
        });
        const wantsWrite = pending.scopes.includes(WRITE_SCOPE);

        res.json({
          data: {
            requestId: req.params.requestId,
            client: {
              id: client.client_id,
              // `client_name` veio de um cliente NÃO confiável (DCR é público). Sai escapado
              // para HTML: use como texto/innerHTML seguro e NÃO escape de novo.
              name: escapeHtml(client.client_name ?? ''),
              redirectHost: new URL(pending.redirectUri).host,
            },
            scopes: pending.scopes,
            expiresInSeconds: Math.max(0, TTL.authRequest - Math.floor((now() - pending.createdAt) / 1000)),
            brands: memberships.map((m) => ({
              slug: m.brand.slug,
              name: m.brand.name,
              role: m.role,
              canRead: ROLES_FOR_SCOPE['designer.read'].includes(m.role),
              // A tela usa para desabilitar a marca quando o pedido inclui escrita e o papel não permite.
              canWrite: ROLES_FOR_SCOPE[WRITE_SCOPE].includes(m.role),
              selectable: !wantsWrite || ROLES_FOR_SCOPE[WRITE_SCOPE].includes(m.role),
            })),
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /** A decisão. Única porta por onde um código de autorização nasce. */
  router.post(
    '/consent/:requestId',
    rateLimit({ ...deps.limits.consent, keyPrefix: `${deps.limits.keyPrefix}-consent-decide`, keyBy: 'user' }),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const userId = req.user!.userId;
        const idHash = requestHash(req.params.requestId as string);
        const body = parseBody(decisionSchema, req.body);

        const pending = await store.getPendingRequest(idHash);
        if (!pending) throw createError(404, NOT_FOUND, 'MCP_REQUEST_NOT_FOUND');

        if (body.decision === 'deny') {
          // Consumo atômico: se outra decisão chegou primeiro, esta perde (404).
          const consumed = await store.consumePendingRequest(idHash);
          if (!consumed) throw createError(404, NOT_FOUND, 'MCP_REQUEST_NOT_FOUND');
          logger.info('mcp.consent.denied', { userId, clientId: consumed.clientId });
          res.json({
            data: {
              redirectUrl: redirectWith(consumed.redirectUri, {
                error: 'access_denied',
                error_description: 'O usuário negou o acesso.',
                state: consumed.state,
                iss: config.issuer,
              }),
            },
          });
          return;
        }

        // ── approve ──
        // Escopos: por padrão o que o cliente pediu; o usuário pode reduzir, nunca ampliar.
        let granted: McpScope[] = pending.scopes;
        if (body.scopes) {
          const wanted = body.scopes.filter(isMcpScope);
          if (wanted.length !== body.scopes.length || wanted.some((s) => !pending.scopes.includes(s))) {
            throw createError(400, 'scopes inclui escopo que o pedido não solicitou.', 'MCP_BAD_SCOPE');
          }
          if (wanted.length === 0) throw createError(400, 'Selecione ao menos um escopo.', 'MCP_BAD_SCOPE');
          granted = normalizeScopes(wanted);
        }

        const slugs = [...new Set(body.brandSlugs ?? [])];
        if (slugs.length === 0) throw createError(400, 'Selecione ao menos uma marca.', 'MCP_NO_BRAND');

        const memberships = await prisma.brandMember.findMany({
          where: { userId, brand: { slug: { in: slugs } } },
          select: { role: true, brand: { select: { id: true, slug: true, name: true } } },
        });
        // Marca inexistente e marca da qual o usuário não é membro respondem igual (403):
        // não confirmamos a existência de marcas alheias.
        if (memberships.length !== slugs.length) {
          throw createError(403, 'Você não tem acesso a uma das marcas selecionadas.', 'MCP_BRAND_FORBIDDEN');
        }
        // Vale para escrita (EDITOR+) e leitura (qualquer membro): o conector nunca
        // concede mais do que o papel do usuário na marca já concede no app.
        const needed = granted.includes(WRITE_SCOPE) ? ROLES_FOR_SCOPE[WRITE_SCOPE] : ROLES_FOR_SCOPE['designer.read'];
        const insufficient = memberships.find((m) => !needed.includes(m.role));
        if (insufficient) {
          throw createError(
            403,
            `Seu papel em "${insufficient.brand.name}" não permite o escopo de escrita. Escolha só leitura ou outra marca.`,
            'MCP_ROLE_INSUFFICIENT',
          );
        }

        // Consumo atômico do pedido: de dois POSTs simultâneos, só um emite código.
        const consumed = await store.consumePendingRequest(idHash);
        if (!consumed) throw createError(404, NOT_FOUND, 'MCP_REQUEST_NOT_FOUND');

        const code = randomSecret(32);
        await store.saveAuthCode(sha256Hex(code), {
          clientId: consumed.clientId,
          redirectUri: consumed.redirectUri,
          codeChallenge: consumed.codeChallenge,
          resource: consumed.resource,
          scopes: granted,
          userId,
          brandIds: memberships.map((m) => m.brand.id),
          createdAt: now(),
        });
        logger.info('mcp.consent.approved', {
          userId,
          clientId: consumed.clientId,
          scopes: granted,
          brandCount: memberships.length,
        });

        res.json({
          data: {
            redirectUrl: redirectWith(consumed.redirectUri, { code, state: consumed.state, iss: config.issuer }),
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /** Conexões ativas do usuário (a UI vem depois; a API e o teste vêm agora). */
  router.get('/connections', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const families = await store.listFamiliesByUser(userId);
      const allBrandIds = [...new Set(families.flatMap((f) => f.brandIds))];
      // Só marcas que o usuário AINDA integra: não vazamos nome de marca de que ele saiu.
      const memberships = allBrandIds.length
        ? await prisma.brandMember.findMany({
            where: { userId, brandId: { in: allBrandIds } },
            select: { brand: { select: { id: true, slug: true, name: true } } },
          })
        : [];
      const brandById = new Map(memberships.map((m) => [m.brand.id, m.brand]));

      res.json({
        data: families.map((f) => ({
          id: f.id,
          clientName: escapeHtml(f.clientName),
          scopes: f.scopes,
          createdAt: new Date(f.createdAt).toISOString(),
          brands: f.brandIds.flatMap((id) => {
            const brand = brandById.get(id);
            return brand ? [{ slug: brand.slug, name: brand.name }] : [];
          }),
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/connections/:familyId', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const revoked = await provider.revokeFamilyOfUser(req.params.familyId as string, req.user!.userId);
      // Conexão inexistente e conexão de outro usuário respondem igual.
      if (!revoked) throw createError(404, 'Conexão não encontrada.', 'MCP_CONNECTION_NOT_FOUND');
      res.json({ data: { revoked: true } });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
