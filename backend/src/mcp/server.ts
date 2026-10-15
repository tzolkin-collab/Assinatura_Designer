import express, { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { InsufficientScopeError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { logger } from '../lib/logger.js';
import { enrichAiContext } from '../lib/aiContext.js';
import { rateLimit } from '../middleware/rateLimit.js';
import type { AuthRequest } from '../middleware/auth.js';
import { READ_SCOPE, type McpConfig } from './config.js';
import { createOriginGuard, isAllowedOrigin } from './auth/origin.js';
import type { DesignerOAuthProvider } from './auth/provider.js';
import type { McpLimits } from './limits.js';
import type { McpCallLog } from './store.js';
import { MCP_TOOLS } from './tools/index.js';
import { registerTools, toolScopeIndex } from './tools/registry.js';
import type { McpToolDefinition } from './tools/types.js';

/**
 * Transporte MCP: Streamable HTTP em modo STATELESS.
 *
 * Stateless = um `McpServer` + um transport NOVOS por requisição, sem `Mcp-Session-Id`.
 * Escolhido porque (1) não há estado de sessão para perder num redeploy nem para
 * sincronizar entre instâncias; (2) cada requisição carrega seu próprio token, então a
 * autorização é por requisição de qualquer forma; (3) as ferramentas atuais são
 * request/response — não precisam de notificações servidor→cliente. O custo é recriar
 * o servidor a cada chamada (alguns objetos e 2 `registerTool`), desprezível.
 *
 * GET e DELETE (stream SSE standalone e encerramento de sessão) respondem 405: sem
 * sessão não há o que escutar nem encerrar, e a spec permite 405 para GET.
 */

const SERVER_INSTRUCTIONS =
  'Designer IA: estúdio de design de apresentações e carrosséis, onde VOCÊ é o diretor de arte e o artista. ' +
  'Fluxo: (1) list_brands para descobrir o slug da marca; (2) get_designer_brief com o slug: devolve as regras ' +
  'da marca, o contrato do HTML, fontes, paleta, logo e os arquivos de imagem reais que você pode usar; ' +
  '(3) escreva cada slide em HTML/CSS seguindo o brief e envie com save_presentation, junto do texto aprovado ' +
  'de cada slide; (4) leia as verificações devolvidas (texto, estrutura) e, se houver problema, corrija e envie ' +
  'de novo com o postId. O texto aprovado vale literalmente: nunca invente, troque nem resuma palavras. ' +
  'Nunca gere pessoas nem fotos: onde faltar foto real, deixe a área reservada. ' +
  'list_designs e get_design leem o que já existe. O usuário acompanha o resultado no link do editor.';

type AnyTool = McpToolDefinition<never, never> | McpToolDefinition;

export function createMcpServer(deps: {
  callLog: McpCallLog;
  resourceMetadataUrl: string;
  frontendOrigin?: string;
  tools?: readonly AnyTool[];
}): McpServer {
  const server = new McpServer(
    { name: 'designer-ia', version: '0.1.0' },
    {
      instructions: SERVER_INSTRUCTIONS,
      // Teto de elementos no `arguments` de um tools/call: sem isto um cliente manda um
      // array de milhões de itens e o zod gasta CPU validando.
      maxToolInputElements: 200,
    },
  );
  registerTools(server, deps.tools ?? MCP_TOOLS, {
    callLog: deps.callLog,
    resourceMetadataUrl: deps.resourceMetadataUrl,
    frontendOrigin: deps.frontendOrigin,
  });
  return server;
}

const JSON_RPC_ERRORS = {
  methodNotAllowed: { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null },
  internal: { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null },
};

export function createMcpEndpointRouter(deps: {
  config: McpConfig;
  provider: DesignerOAuthProvider;
  callLog: McpCallLog;
  limits: McpLimits;
  tools?: readonly AnyTool[];
}): Router {
  const { config, provider, callLog, limits } = deps;
  const tools = deps.tools ?? MCP_TOOLS;
  const scopeByTool = toolScopeIndex(tools);
  const router = Router();

  // CORS só para os navegadores da allowlist (ex.: MCP Inspector em dev). Servidor a
  // servidor (ChatGPT) não depende disto. `WWW-Authenticate` precisa estar exposto para
  // um cliente de navegador conseguir ler o `resource_metadata` do 401.
  const corsMiddleware = cors({
    origin: (origin, callback) => callback(null, !origin || isAllowedOrigin(origin, config)),
    exposedHeaders: ['WWW-Authenticate', 'Mcp-Session-Id'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'Mcp-Protocol-Version', 'Mcp-Session-Id', 'Last-Event-ID'],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  });

  // `requiredScopes: [READ_SCOPE]` põe `scope="designer.read"` no WWW-Authenticate do 401
  // (formato do doc do ChatGPT) e recusa token sem leitura. O escopo de CADA ferramenta
  // é conferido depois (pré-check abaixo + registro central).
  const bearer = requireBearerAuth({
    verifier: provider,
    requiredScopes: [READ_SCOPE],
    resourceMetadataUrl: config.resourceMetadataUrl,
    // Audiência: token emitido para outro recurso é 401 aqui mesmo que o verifier o aceitasse.
    expectedResource: config.resourceUrl,
  });

  /**
   * Sem NENHUMA credencial, o desafio é exatamente o do doc de auth do ChatGPT:
   * `Bearer resource_metadata="…", scope="…"` — sem `error` (RFC 6750 §3.1: quem não mandou
   * credencial não errou nada). O `requireBearerAuth` do SDK põe `error="invalid_token"`
   * mesmo nesse caso, e um parser mais estrito do lado do ChatGPT não deveria tropeçar nisso.
   * Token PRESENTE e inválido continua sendo respondido pelo bearer do SDK (com `error`).
   */
  const challengeWithoutCredentials: RequestHandler = (req, res, next) => {
    if (req.headers.authorization) return next();
    res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${config.resourceMetadataUrl}", scope="${READ_SCOPE}"`);
    res.status(401).json({ error: 'invalid_token', error_description: 'Missing Authorization header' });
  };

  /** Identifica o usuário para o rate limit por conta e para os logs. */
  const attachUser: RequestHandler = (req: AuthRequest, _res, next) => {
    const userId = req.auth?.extra?.userId;
    if (typeof userId === 'string') {
      req.user = { userId, role: 'MCP' };
      enrichAiContext({ userId });
    }
    next();
  };

  const methodGate: RequestHandler = (req, res, next) => {
    if (req.method === 'POST') return next();
    res.setHeader('Allow', 'POST');
    res.status(405).json(JSON_RPC_ERRORS.methodNotAllowed);
  };

  /**
   * Escopo por ferramenta no nível HTTP: `tools/call` de uma ferramenta que o token não
   * cobre recebe 403 + `WWW-Authenticate: ... error="insufficient_scope"` (spec MCP),
   * antes de qualquer trabalho. O registro central repete a checagem (defesa em
   * profundidade) para o que escapar daqui.
   */
  const scopePrecheck: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    const messages: unknown[] = Array.isArray(req.body) ? req.body : [req.body];
    const granted = req.auth?.scopes ?? [];
    for (const message of messages) {
      const m = message as { method?: unknown; params?: { name?: unknown } } | null;
      if (m?.method !== 'tools/call' || typeof m.params?.name !== 'string') continue;
      const required = scopeByTool.get(m.params.name);
      if (required && !granted.includes(required)) {
        const error = new InsufficientScopeError(`Esta ferramenta exige o escopo ${required}.`);
        res.setHeader(
          'WWW-Authenticate',
          `Bearer error="insufficient_scope", error_description="Escopo insuficiente", scope="${required}", resource_metadata="${config.resourceMetadataUrl}"`,
        );
        res.status(403).json(error.toResponseObject());
        return;
      }
    }
    next();
  };

  const handle: RequestHandler = async (req, res) => {
    const mcp = createMcpServer({
      callLog,
      resourceMetadataUrl: config.resourceMetadataUrl,
      frontendOrigin: config.frontendUrl.origin,
      tools,
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void mcp.close();
    });
    try {
      await mcp.connect(transport);
      // `req.auth` (AuthInfo do bearer) é lido pelo transport e vira `extra.authInfo` nos handlers.
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error('mcp.transport_error', { error: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) res.status(500).json(JSON_RPC_ERRORS.internal);
    }
  };

  router.all(
    '/mcp',
    corsMiddleware,
    createOriginGuard(config),
    rateLimit({ ...limits.mcpIp, keyPrefix: `${limits.keyPrefix}-mcp-ip` }),
    challengeWithoutCredentials,
    bearer,
    attachUser,
    methodGate,
    // Corpo só é lido DEPOIS da autenticação: anônimo não faz o servidor parsear JSON.
    express.json({ limit: '1mb' }),
    rateLimit({ ...limits.mcpUser, keyPrefix: `${limits.keyPrefix}-mcp-user`, keyBy: 'user' }),
    scopePrecheck,
    handle,
  );

  return router;
}
