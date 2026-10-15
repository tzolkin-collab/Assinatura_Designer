import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  ListToolsRequestSchema,
  type CallToolResult,
  type ServerNotification,
  type ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../../lib/logger.js';
import { EDIT_ALL_SCOPE, type McpScope } from '../config.js';
import type { McpCallEvent, McpCallLog } from '../store.js';
import { resolveBrandGrants } from './authorization.js';
import { ToolUserError, type McpCallContext, type McpToolDefinition } from './types.js';

/**
 * Registro central das ferramentas: o ÚNICO ponto onde uma chamada `tools/call` passa
 * por escopo, autorização por marca, tratamento de erro e registro de auditoria.
 *
 * Ferramentas (tools/*.ts) são só definições; elas não repetem nem podem pular nada
 * disto. Para cada chamada, nesta ordem:
 *   1. escopo do token cobre o escopo da ferramenta? (senão: insufficient_scope);
 *   2. quais marcas este token × a associação ATUAL do usuário permitem;
 *   3. se a ferramenta usa `brandArg`, a marca pedida está nessa lista? (senão: recusa
 *      genérica — não confirmamos a existência de marcas fora do escopo);
 *   4. roda o handler; erro esperado vira mensagem ao modelo, erro inesperado vira
 *      mensagem genérica (o detalhe vai para o log, nunca para o ChatGPT);
 *   5. grava o evento da chamada (sem argumentos nem conteúdo) e loga.
 */

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;
type AnyTool = McpToolDefinition<never, never> | McpToolDefinition;

export interface RegistryDeps {
  callLog: McpCallLog;
  resourceMetadataUrl: string;
  /** Origem do frontend (para montar o link do preview/editor devolvido ao agente). */
  frontendOrigin?: string;
  now?: () => number;
}

/** Declaração `securitySchemes` do Apps SDK: oauth2 com os escopos da ferramenta. */
export function securitySchemesFor(scope: McpScope) {
  return [{ type: 'oauth2', scopes: [scope] }];
}

function toolError(message: string, extra: Partial<CallToolResult> = {}): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }], ...extra };
}

/**
 * Escopo insuficiente no nível da FERRAMENTA. O ChatGPT dispara o fluxo de (re)login
 * quando o resultado traz o desafio em `_meta["mcp/www_authenticate"]` (doc Apps SDK).
 * A mesma recusa existe no nível HTTP (403) em server.ts; esta é a rede de segurança
 * para o caso de a requisição chegar aqui mesmo assim (ex.: lote JSON-RPC).
 */
function insufficientScopeResult(scope: McpScope, resourceMetadataUrl: string): CallToolResult {
  const challenge =
    `Bearer resource_metadata="${resourceMetadataUrl}", error="insufficient_scope", ` +
    `error_description="Esta ação exige o escopo ${scope}", scope="${scope}"`;
  return toolError(`Permissão insuficiente: esta ferramenta exige o escopo ${scope}. Reconecte o Designer e autorize esse acesso.`, {
    _meta: { 'mcp/www_authenticate': [challenge] },
  });
}

async function runTool(tool: AnyTool, args: Record<string, unknown>, extra: Extra, deps: RegistryDeps): Promise<CallToolResult> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const auth = extra.authInfo;
  const userId = typeof auth?.extra?.userId === 'string' ? auth.extra.userId : undefined;
  if (!auth || !userId) {
    // Não deveria acontecer: o middleware de bearer roda antes. Falha fechada.
    return toolError('Conexão não autenticada.');
  }
  const brandIds = Array.isArray(auth.extra?.brandIds) ? (auth.extra.brandIds as string[]) : [];
  const brandMode = auth.extra?.brandMode === 'all' ? ('all' as const) : ('selected' as const);
  const familyId = String(auth.extra?.familyId ?? '');

  let errorCode: string | undefined;
  let brandId: string | undefined;
  let brandSlug: string | undefined;

  try {
    if (!auth.scopes.includes(tool.scope)) {
      errorCode = 'insufficient_scope';
      return insufficientScopeResult(tool.scope, deps.resourceMetadataUrl);
    }

    const grants = await resolveBrandGrants({ userId, brandIds, brandMode, scope: tool.scope });
    const ctx: McpCallContext = {
      userId,
      clientId: auth.clientId,
      familyId,
      grants,
      canEditAll: auth.scopes.includes(EDIT_ALL_SCOPE),
      frontendOrigin: deps.frontendOrigin,
    };

    if (tool.brandArg) {
      brandSlug = String((args as Record<string, unknown>)[tool.brandArg] ?? '');
      const brand = grants.find((g) => g.slug === brandSlug);
      if (!brand) {
        // Mesma resposta para "não existe", "não é sua" e "você não aprovou esta marca".
        throw new ToolUserError(
          'Marca indisponível para esta conexão. Use list_brands para ver as marcas liberadas.',
          'brand_unavailable',
        );
      }
      ctx.brand = brand;
      brandId = brand.id;
    }

    const output = await (tool as McpToolDefinition).handler(ctx, args as never);
    return { content: [{ type: 'text', text: output.text }], structuredContent: output.structured };
  } catch (error) {
    if (error instanceof ToolUserError) {
      errorCode = error.code;
      return toolError(error.message);
    }
    errorCode = 'internal_error';
    // Detalhe só no log. O texto devolvido ao ChatGPT nunca carrega stack nem mensagem interna.
    logger.error('mcp.tool_error', { tool: tool.name, userId, error: error instanceof Error ? error.message : String(error) });
    return toolError('Erro interno ao executar a ferramenta. Tente novamente em instantes.');
  } finally {
    const event: McpCallEvent = {
      ts: new Date(now()).toISOString(),
      userId,
      clientId: auth.clientId,
      tool: tool.name,
      brandSlug,
      ok: !errorCode,
      errorCode,
      durationMs: Math.max(0, now() - startedAt),
    };
    // Auditoria nunca derruba a chamada: falha de Redis aqui vira aviso e a vida segue.
    deps.callLog.appendCall(brandId ?? `user:${userId}`, event).catch((err: unknown) => {
      logger.warn('mcp.call_log_failed', { error: err instanceof Error ? err.message : String(err) });
    });
    logger.info('mcp.tool_call', { ...event });
  }
}

/** Escopo exigido por ferramenta — usado pelo pré-check HTTP (403) em server.ts. */
export function toolScopeIndex(tools: readonly AnyTool[]): Map<string, McpScope> {
  return new Map(tools.map((t) => [t.name, t.scope]));
}

export function registerTools(mcp: McpServer, tools: readonly AnyTool[], deps: RegistryDeps): void {
  for (const tool of tools) {
    mcp.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema as never,
        outputSchema: tool.outputSchema as never,
        annotations: tool.annotations,
        // Espelho em _meta: o doc do Apps SDK pede `securitySchemes` no descritor e uma
        // cópia em `_meta` para clientes que só leem metadados. O McpServer só repassa
        // `_meta`; o campo de topo é acrescentado em `exposeSecuritySchemes` abaixo.
        _meta: { securitySchemes: securitySchemesFor(tool.scope) },
      },
      (async (args: unknown, extra: Extra) => runTool(tool, (args ?? {}) as Record<string, unknown>, extra, deps)) as never,
    );
  }
  exposeSecuritySchemes(mcp, tools);
}

/**
 * Põe `securitySchemes` também no TOPO de cada descritor de `tools/list`.
 *
 * O `McpServer` monta o descritor com campos fixos (name, title, description, schemas,
 * annotations, _meta) e descarta qualquer outro, mas o Apps SDK define `securitySchemes`
 * no nível do descritor (com `_meta.securitySchemes` como espelho de compatibilidade).
 * Para não reescrever a listagem inteira (e o JSON Schema que o SDK já gera), embrulhamos
 * o handler que o próprio SDK registrou e só acrescentamos o campo.
 *
 * Isto lê o mapa interno `_requestHandlers` do SDK — não é API pública. É por isso que a
 * versão do SDK está FIXADA no package.json e que há teste lendo o JSON cru de
 * `tools/list`: se uma atualização mudar isso, o teste quebra (e esta função lança no
 * boot em vez de silenciosamente perder o campo).
 */
function exposeSecuritySchemes(mcp: McpServer, tools: readonly AnyTool[]): void {
  const internals = mcp.server as unknown as {
    _requestHandlers?: Map<string, (request: unknown, extra: unknown) => Promise<{ tools?: Array<Record<string, unknown>> }>>;
  };
  const original = internals._requestHandlers?.get('tools/list');
  if (!original) {
    throw new Error('MCP SDK: handler de tools/list não encontrado — o layout interno mudou; revise registry.ts.');
  }
  const schemes = new Map(tools.map((t) => [t.name, securitySchemesFor(t.scope)]));

  mcp.server.setRequestHandler(ListToolsRequestSchema, (async (request: unknown, extra: unknown) => {
    const result = await original(request, extra);
    return {
      ...result,
      tools: (result.tools ?? []).map((descriptor) => ({
        ...descriptor,
        securitySchemes: schemes.get(String(descriptor.name)),
      })),
    };
  }) as never);
}
