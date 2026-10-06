import type { BrandRole } from '@prisma/client';
import { compileRedirectPolicy, type RedirectPolicy } from './auth/redirectUris.js';

/**
 * Configuração do módulo MCP (conector do ChatGPT).
 *
 * Fica FORA de `src/config.ts` de propósito: o módulo é opcional (MCP_ENABLED=false por
 * padrão) e precisa ser testável com um env falso, coisa que o `config` global — um
 * objeto congelado na importação — não permite. Aqui `loadMcpConfig(env)` é uma função
 * pura sobre o env que recebe.
 *
 * Regra central: issuer e resource derivam de PUBLIC_BASE_URL, NUNCA do header Host da
 * requisição. Se derivassem do Host, quem controlasse o header (host-header injection)
 * faria o servidor anunciar um issuer/resource do atacante nos metadados.
 */

/** Escopos OAuth do Designer. `designer.write` INCLUI leitura (ver `normalizeScopes`). */
export const MCP_SCOPES = ['designer.read', 'designer.write'] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const READ_SCOPE: McpScope = 'designer.read';
export const WRITE_SCOPE: McpScope = 'designer.write';

/**
 * Papéis da marca que satisfazem cada escopo: leitura = qualquer membro, escrita =
 * OWNER/ADMIN/EDITOR — a MESMA hierarquia de `middleware/brandAccess.ts` (ANY_MEMBER /
 * EDITORS). Fica espelhada aqui, e não importada, para este módulo de configuração não
 * puxar o Prisma; `__tests__/mcp/oauthEdgeCases.test.ts` falha se as duas divergirem.
 */
export const ROLES_FOR_SCOPE: Record<McpScope, BrandRole[]> = {
  'designer.read': ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'],
  'designer.write': ['OWNER', 'ADMIN', 'EDITOR'],
};

export function isMcpScope(value: string): value is McpScope {
  return (MCP_SCOPES as readonly string[]).includes(value);
}

/**
 * `designer.write` implica `designer.read`: uma ferramenta de leitura nunca deveria
 * falhar para quem tem escrita. Normalizar na EMISSÃO (e não na checagem) mantém o
 * token autoexplicativo — o que está no escopo dele é o que ele pode.
 */
export function normalizeScopes(scopes: Iterable<McpScope>): McpScope[] {
  const set = new Set<McpScope>(scopes);
  if (set.has(WRITE_SCOPE)) set.add(READ_SCOPE);
  return MCP_SCOPES.filter((s) => set.has(s));
}

/** Os dois redirects que o ChatGPT usa (doc "Authentication" do Apps SDK). */
export const DEFAULT_ALLOWED_REDIRECT_URIS = [
  // Com issuer identification (RFC 9207) — o modo preferido.
  'https://chatgpt.com/connector_platform_oauth_redirect',
  // Legado, por callback_id. `{id}` casa UM segmento `[A-Za-z0-9_-]{1,128}`.
  'https://chatgpt.com/connector/oauth/{id}',
];

export interface McpConfig {
  /** Origem pública SEM barra final — é o `issuer` exato dos metadados e do parâmetro `iss`. */
  issuer: string;
  /** URL canônica do recurso MCP (`<issuer>/mcp`) — a audiência dos tokens. */
  resourceUrl: URL;
  /** URL do protected-resource metadata, a que vai no WWW-Authenticate. */
  resourceMetadataUrl: string;
  /** Origem do frontend onde fica a tela de consentimento (`/mcp/consent`). */
  frontendUrl: URL;
  redirectPolicy: RedirectPolicy;
  /** Libera redirect/Origin de loopback (MCP Inspector em dev). */
  allowLocalhost: boolean;
  /** Origens exatas aceitas no header Origin de /mcp (anti DNS-rebinding). */
  allowedOrigins: string[];
  /** Teto de clientes DCR registrados ao mesmo tempo. */
  maxClients: number;
}

export type McpConfigLoad =
  | { enabled: true; config: McpConfig }
  | { enabled: false; reason: string; misconfigured: boolean };

export interface McpConfigOptions {
  /** CORS_ORIGIN do app (fallback do FRONTEND_URL). */
  corsOrigin?: string;
  /** Em produção PUBLIC_BASE_URL é obrigatório; fora dela cai em localhost. */
  isProduction?: boolean;
  /** Porta local, só para o default de dev do PUBLIC_BASE_URL. */
  port?: number;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function splitList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function fail(reason: string): McpConfigLoad {
  return { enabled: false, reason, misconfigured: true };
}

export function loadMcpConfig(env: NodeJS.ProcessEnv, opts: McpConfigOptions = {}): McpConfigLoad {
  if (env.MCP_ENABLED !== 'true') {
    return { enabled: false, reason: 'MCP_ENABLED não é "true" (módulo desligado por padrão)', misconfigured: false };
  }

  const isProduction = opts.isProduction ?? env.NODE_ENV === 'production';
  const rawBase = env.PUBLIC_BASE_URL?.trim() || (isProduction ? '' : `http://localhost:${opts.port ?? 4000}`);
  if (!rawBase) {
    return fail('MCP_ENABLED=true mas PUBLIC_BASE_URL está ausente (ex.: https://api.exemplo.com). Sem ela o issuer/resource não são derivados com segurança.');
  }

  let base: URL;
  try {
    base = new URL(rawBase);
  } catch {
    return fail(`PUBLIC_BASE_URL inválida: "${rawBase}"`);
  }
  const loopback = LOOPBACK.has(base.hostname);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) {
    return fail('PUBLIC_BASE_URL precisa ser https (http só é aceito em localhost, para desenvolvimento).');
  }
  if ((base.pathname !== '/' && base.pathname !== '') || base.search || base.hash || base.username || base.password) {
    return fail('PUBLIC_BASE_URL deve ser só a origem (sem path, query, fragmento ou credenciais). O issuer fica na raiz do host.');
  }

  const allowLocalhost = env.MCP_ALLOW_LOCALHOST_REDIRECT === 'true';

  const frontendRaw = env.FRONTEND_URL?.trim() || splitList(opts.corsOrigin)[0] || 'http://localhost:3000';
  let frontendUrl: URL;
  try {
    frontendUrl = new URL(frontendRaw);
  } catch {
    return fail(`FRONTEND_URL inválida: "${frontendRaw}"`);
  }

  const redirectPatterns = splitList(env.MCP_ALLOWED_REDIRECT_URIS);
  let redirectPolicy: RedirectPolicy;
  try {
    redirectPolicy = compileRedirectPolicy(
      redirectPatterns.length > 0 ? redirectPatterns : DEFAULT_ALLOWED_REDIRECT_URIS,
      allowLocalhost,
    );
  } catch (err) {
    return fail((err as Error).message);
  }

  const issuer = base.origin;
  const resourceUrl = new URL('/mcp', issuer);
  const origins = new Set<string>([issuer, frontendUrl.origin, ...splitList(env.MCP_ALLOWED_ORIGINS)]);

  const maxClients = Number.parseInt(env.MCP_MAX_CLIENTS ?? '', 10);

  return {
    enabled: true,
    config: {
      issuer,
      resourceUrl,
      // RFC 9728 §3: o metadata de um recurso com path vive em /.well-known/oauth-protected-resource<path>.
      resourceMetadataUrl: new URL('/.well-known/oauth-protected-resource/mcp', issuer).href,
      frontendUrl: new URL(frontendUrl.origin),
      redirectPolicy,
      allowLocalhost,
      allowedOrigins: [...origins],
      maxClients: Number.isFinite(maxClients) && maxClients > 0 ? maxClients : 500,
    },
  };
}
