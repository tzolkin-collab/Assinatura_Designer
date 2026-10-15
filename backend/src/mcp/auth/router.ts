import express, { Router, type RequestHandler } from 'express';
import { metadataHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/metadata.js';
import { createOAuthMetadata, mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { MCP_SCOPES, type McpConfig } from '../config.js';
import type { McpLimits } from '../limits.js';
import { PKCE_VERIFIER_PATTERN } from './crypto.js';
import type { DesignerOAuthProvider } from './provider.js';

/**
 * Monta o servidor de autorização: o `mcpAuthRouter` do SDK (protocolo) + o que o
 * ChatGPT exige e o SDK não faz sozinho.
 *
 * O que o SDK entrega pronto: /authorize, /token, /register, /revoke, validação de
 * parâmetros, PKCE S256 obrigatório (rejeita `plain` e ausência), formato de erro OAuth.
 *
 * O que acrescentamos por cima, e por quê:
 *  - metadados próprios: o SDK anuncia `issuer` COM barra final (`URL.href`) e não
 *    conhece `authorization_response_iss_parameter_supported`. O ChatGPT compara o
 *    issuer por string exata e exige o `iss` (RFC 9207) em toda resposta de
 *    autorização. Servimos os metadados antes do router do SDK, que fica como
 *    retaguarda (as mesmas rotas, mais abaixo, nunca são alcançadas);
 *  - `iss` (e o `state`, que o SDK perde quando a validação falha) nas respostas de ERRO
 *    do /authorize — o SDK só monta o erro, sem `iss`;
 *  - rate limit do nosso `middleware/rateLimit.ts` (Redis, vale entre instâncias) no
 *    lugar do `express-rate-limit` em memória do SDK, desligado de propósito;
 *  - clientes públicos apenas: `token_endpoint_auth_methods_supported: ['none']`;
 *  - formato do `code_verifier` (RFC 7636 §4.1: 43–128 caracteres unreserved), que o
 *    SDK não confere.
 */

/**
 * Resposta de erro do /authorize que vai para o redirect_uri do cliente: acrescenta o
 * `iss` (RFC 9207 — prometido em `authorization_response_iss_parameter_supported`) e,
 * quando o SDK não o fez, o `state` do pedido (RFC 6749 §4.1.2.1: obrigatório se veio).
 * O SDK perde o `state` justamente quando a validação dos parâmetros falha, que é o
 * caso mais comum de erro (ex.: PKCE `plain`).
 */
function completeErrorRedirects(issuer: string): RequestHandler {
  return (req, res, next) => {
    const original = res.redirect.bind(res) as (status: number, url: string) => void;
    const params = (req.method === 'POST' ? req.body : req.query) as Record<string, unknown> | undefined;
    const requestState = typeof params?.state === 'string' ? params.state : undefined;

    res.redirect = ((statusOrUrl: number | string, maybeUrl?: string) => {
      const status = typeof statusOrUrl === 'number' ? statusOrUrl : 302;
      const target = typeof statusOrUrl === 'number' ? (maybeUrl as string) : statusOrUrl;
      const url = new URL(target);
      // O redirect de sucesso do /authorize vai para a tela de consentimento (sem `error`).
      if (url.searchParams.has('error')) {
        if (!url.searchParams.has('iss')) url.searchParams.set('iss', issuer);
        if (requestState && !url.searchParams.has('state')) url.searchParams.set('state', requestState);
      }
      original(status, url.href);
    }) as typeof res.redirect;
    next();
  };
}

const enforceVerifierFormat: RequestHandler = (req, res, next) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (req.method === 'POST' && body.grant_type === 'authorization_code') {
    const verifier = typeof body.code_verifier === 'string' ? body.code_verifier : '';
    if (!PKCE_VERIFIER_PATTERN.test(verifier)) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'code_verifier invalido: use de 43 a 128 caracteres entre A-Z a-z 0-9 - . _ ~',
      });
      return;
    }
  }
  next();
};

export function createOAuthRouter(deps: { config: McpConfig; provider: DesignerOAuthProvider; limits: McpLimits }): Router {
  const { config, provider, limits } = deps;
  const router = Router();
  const limiter = (name: string, policy: { windowSec: number; max: number }) =>
    rateLimit({ ...policy, keyPrefix: `${limits.keyPrefix}-${name}` });

  const scopesSupported = [...MCP_SCOPES];

  const baseMetadata = createOAuthMetadata({ provider, issuerUrl: new URL(config.issuer), scopesSupported });
  const authorizationServerMetadata = {
    ...baseMetadata,
    issuer: config.issuer,
    // Só clientes públicos com PKCE (o ChatGPT usa `none`). Não existe segredo de cliente.
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    // Prometemos o `iss` em TODA resposta de autorização (sucesso, negação e erro).
    authorization_response_iss_parameter_supported: true,
    // CIMD não implementado (ver docs/MCP-DESIGNER.md): não anunciamos o que não fazemos.
  };
  const protectedResourceMetadata = {
    resource: config.resourceUrl.href,
    authorization_servers: [config.issuer],
    scopes_supported: scopesSupported,
    resource_name: 'Designer IA',
    bearer_methods_supported: ['header'],
  };

  // RFC 9728 §3: recurso com path → metadata em /.well-known/oauth-protected-resource/<path>.
  // Servimos também a URL na raiz, que é a que o doc do ChatGPT cita; o conteúdo é o mesmo.
  router.use('/.well-known/oauth-protected-resource/mcp', metadataHandler(protectedResourceMetadata));
  router.use('/.well-known/oauth-protected-resource', metadataHandler(protectedResourceMetadata));
  router.use('/.well-known/oauth-authorization-server', metadataHandler(authorizationServerMetadata));

  router.use('/authorize', limiter('authorize', limits.authorize), completeErrorRedirects(config.issuer));
  router.use('/token', limiter('token', limits.token), express.urlencoded({ extended: false }), enforceVerifierFormat);
  router.use('/register', limiter('register', limits.register));
  router.use('/revoke', limiter('revoke', limits.revoke));

  router.use(
    mcpAuthRouter({
      provider,
      issuerUrl: new URL(config.issuer),
      resourceServerUrl: config.resourceUrl,
      scopesSupported,
      resourceName: 'Designer IA',
      // Rate limit é nosso (acima). `false` desliga o do SDK, que é por processo, em memória.
      authorizationOptions: { rateLimit: false },
      tokenOptions: { rateLimit: false },
      // Sem segredo de cliente, não há o que expirar: 0 = nunca (o DCR só emite públicos).
      clientRegistrationOptions: { rateLimit: false, clientSecretExpirySeconds: 0 },
      revocationOptions: { rateLimit: false },
    }),
  );

  return router;
}
