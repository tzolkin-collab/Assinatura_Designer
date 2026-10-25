import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { config as appConfig } from '../config.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { requireAuth } from '../middleware/auth.js';
import { setPreviewAuthenticator } from '../middleware/previewSession.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { createError } from '../middleware/errorHandler.js';
import { loadMcpConfig, READ_SCOPE, type McpConfigLoad } from './config.js';
import { resolveBrandGrants } from './tools/authorization.js';
import { mcpApiErrorHandler } from './auth/apiErrors.js';
import { createConsentRouter } from './auth/consent.js';
import { DEFAULT_LIMITS, type McpLimits } from './limits.js';
import { createMcpRuntime } from './routes.js';
import { RedisMcpStore, type McpCallLog, type McpOAuthStore, type RedisLike } from './store.js';

/**
 * Ponto único de entrada do conector MCP (ChatGPT) no app.
 *
 * `app.ts` chama `mountMcp(app, ...)` UMA vez. Com MCP_ENABLED != true (o padrão) esta
 * função não monta rota nenhuma — a feature pode ir ao ar desligada e ligar por env.
 * Com MCP_ENABLED=true e configuração inválida (ex.: sem PUBLIC_BASE_URL em produção)
 * também NÃO monta, e loga o motivo: falhar fechado é melhor que subir um servidor
 * OAuth com issuer derivado de onde não deve.
 */

export interface MountMcpOptions {
  /** O CORS do app, reaproveitado para a API do usuário (/api/mcp). */
  apiCors: RequestHandler;
  /** Injeções para teste/fumaça; em produção ficam todas nos padrões. */
  env?: NodeJS.ProcessEnv;
  config?: McpConfigLoad;
  store?: McpOAuthStore & McpCallLog;
  limits?: Partial<McpLimits>;
  now?: () => number;
  /** Catálogo de ferramentas (padrão: MCP_TOOLS). Só testes trocam — ver tools/index.ts. */
  tools?: Parameters<typeof createMcpRuntime>[0]['tools'];
}

export function mountMcp(app: Express, options: MountMcpOptions): { mounted: boolean } {
  const loaded =
    options.config ??
    loadMcpConfig(options.env ?? process.env, {
      corsOrigin: appConfig.corsOrigin,
      isProduction: appConfig.nodeEnv === 'production',
      port: appConfig.port,
    });

  if (!loaded.enabled) {
    // Desligado: nenhum token `mcpv_` vale, mesmo que um módulo anterior tenha registrado o serviço (testes).
    setPreviewAuthenticator(null);
    if (loaded.misconfigured) {
      logger.error('MCP: módulo NÃO montado — configuração inválida', { reason: loaded.reason });
    } else {
      logger.debug('MCP desligado', { reason: loaded.reason });
    }
    return { mounted: false };
  }

  const { config } = loaded;
  if (config.allowLocalhost && appConfig.nodeEnv === 'production') {
    logger.warn('MCP: MCP_ALLOW_LOCALHOST_REDIRECT=true em produção — qualquer app local pode registrar um cliente de loopback. Use só para testar com o Inspector.');
  }

  const store: McpOAuthStore & McpCallLog = options.store ?? new RedisMcpStore(redis as unknown as RedisLike, options.now);
  const limits: McpLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const runtime = createMcpRuntime({ config, store, callLog: store, limits, now: options.now, tools: options.tools });

  setPreviewAuthenticator(runtime.preview);

  // Troca do código de entrada da sessão de navegador (designer.preview) pelo token de sessão. É a ÚNICA rota do conector
  // sem JWT: a credencial é o próprio código (256 bits, uso único, ~60 s). Vem ANTES do mount autenticado de /api/mcp.
  const exchangePreview: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const code = (req.body as { code?: unknown } | undefined)?.code;
      // Mesma resposta para código ausente, malformado, usado, vencido ou de sessão substituída.
      const invalid = () => createError(401, 'Código inválido, já usado ou vencido. Peça um novo link ao agente.', 'MCP_PREVIEW_CODE_INVALID');
      if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(code)) throw invalid();
      const session = await runtime.preview.exchange(code);
      if (!session) throw invalid();
      const info = await runtime.preview.authenticate(session.token);
      const grants = info
        ? await resolveBrandGrants({ userId: info.userId, brandIds: info.brandIds, brandMode: info.brandMode, scope: READ_SCOPE })
        : [];
      res.json({
        data: {
          token: session.token,
          expiresAt: new Date(session.expiresAt).toISOString(),
          brands: grants.map((g) => ({ slug: g.slug, name: g.name })),
        },
      });
    } catch (error) {
      next(error);
    }
  };
  app.post(
    '/api/mcp/preview/exchange',
    options.apiCors,
    express.json({ limit: '2kb' }),
    rateLimit({ windowSec: 10 * 60, max: 30, keyPrefix: `${limits.keyPrefix}-preview-exchange` }),
    exchangePreview,
    mcpApiErrorHandler,
  );

  // Protocolo na raiz (metadados .well-known, /authorize, /token, /register, /revoke, /mcp).
  app.use(runtime.protocolRouter);
  // API do usuário (consentimento e conexões): JWT do app no header, como o resto da API.
  app.use(
    '/api/mcp',
    options.apiCors,
    express.json({ limit: '100kb' }),
    requireAuth,
    createConsentRouter({ store, config, provider: runtime.provider, limits, preview: runtime.preview, now: options.now }),
    // Depois do roteador: falha de infra (Redis, Prisma) vira mensagem genérica, sem eco do erro.
    mcpApiErrorHandler,
  );

  logger.info('MCP: conector montado', { issuer: config.issuer, resource: config.resourceUrl.href });
  return { mounted: true };
}
