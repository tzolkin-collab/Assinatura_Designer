import { Router, type ErrorRequestHandler } from 'express';
import { logger } from '../lib/logger.js';
import { requestContext } from '../middleware/requestContext.js';
import type { McpConfig } from './config.js';
import { DesignerClientsStore } from './auth/clientsStore.js';
import { DesignerOAuthProvider } from './auth/provider.js';
import { createOAuthRouter } from './auth/router.js';
import { createMcpEndpointRouter } from './server.js';
import type { McpLimits } from './limits.js';
import type { McpCallLog, McpOAuthStore } from './store.js';
import type { McpToolDefinition } from './tools/types.js';
import { PreviewService } from './preview.js';

/**
 * Rotas de PROTOCOLO do conector: metadados .well-known, /authorize, /token,
 * /register, /revoke e /mcp. São montadas na raiz do app (o OAuth exige paths fixos na
 * raiz do host) e ANTES do cors/json globais — cada rota carrega o CORS e o limite de
 * corpo que lhe cabem (o /mcp lê no máximo 1 MB, não os 25 MB do resto da API).
 */

// Erros neste roteador não passam pelo `errorHandler` global: ele responde no formato
// `{ error: { message } }` do app, e clientes OAuth/MCP esperam `{ error, error_description }`.
const protocolErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  const status: number = err?.statusCode ?? err?.status ?? 500;

  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'invalid_request', error_description: 'Corpo da requisicao grande demais.' });
    return;
  }
  if (status === 429) {
    res.status(429).json({ error: 'too_many_requests', error_description: 'Muitas requisicoes. Tente novamente em instantes.' });
    return;
  }
  logger.error('mcp.protocol_error', { status, error: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ error: 'server_error', error_description: 'Erro interno.' });
};

export interface McpRuntime {
  provider: DesignerOAuthProvider;
  preview: PreviewService;
  protocolRouter: Router;
}

export function createMcpRuntime(deps: {
  config: McpConfig;
  store: McpOAuthStore;
  callLog: McpCallLog;
  limits: McpLimits;
  now?: () => number;
  tools?: readonly McpToolDefinition<never, never>[] | readonly McpToolDefinition[];
}): McpRuntime {
  const { config, store, callLog, limits } = deps;

  const clientsStore = new DesignerClientsStore(store, config.redirectPolicy, config.maxClients);
  const provider = new DesignerOAuthProvider({ store, config, clientsStore, now: deps.now });
  const preview = new PreviewService(store, callLog, deps.now);

  const protocolRouter = Router();
  // O request context (id de correlação + log de acesso) só nas rotas do conector. Montado
  // na raiz inteira ele rodaria duas vezes nas demais rotas (o app tem o próprio).
  protocolRouter.use(['/mcp', '/authorize', '/token', '/register', '/revoke', '/.well-known'], requestContext);
  protocolRouter.use(createOAuthRouter({ config, provider, limits }));
  protocolRouter.use(createMcpEndpointRouter({ config, provider, callLog, limits, preview, tools: deps.tools }));
  protocolRouter.use(protocolErrorHandler);

  return { provider, preview, protocolRouter };
}
