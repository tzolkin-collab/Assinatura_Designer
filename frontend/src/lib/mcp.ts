import { api, API_BASE } from './api';

// Conexão de agentes de IA (MCP): tipos e chamadas da API do usuário (JWT do app).
// O servidor MCP em si (OAuth + /mcp) vive em backend/src/mcp; aqui só o que as telas precisam.

export interface McpConnection {
  id: string;
  /** Nome que o próprio agente informou ao se registrar. Chega escapado para HTML: use `plainText`. */
  clientName: string;
  scopes: string[];
  createdAt: string;
  /** Conexão em modo "todas as minhas marcas": `brands` é o conjunto de agora, não uma lista fixa. */
  allBrands?: boolean;
  brands: Array<{ slug: string; name: string }>;
}

export interface ConsentBrand {
  slug: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
  canRead: boolean;
  canWrite: boolean;
  selectable: boolean;
}

export interface ConsentRequest {
  requestId: string;
  client: { id: string; name: string; redirectHost: string };
  scopes: string[];
  expiresInSeconds: number;
  brands: ConsentBrand[];
}

export const READ_SCOPE = 'designer.read';
export const WRITE_SCOPE = 'designer.write';
export const EDIT_ALL_SCOPE = 'designer.edit_all';
export const EXPORT_SCOPE = 'designer.export';
export const PREVIEW_SCOPE = 'designer.preview';

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" };

/**
 * O servidor devolve nomes de cliente JÁ escapados para HTML (para quem injeta em innerHTML). O React
 * escapa texto sozinho, então exibir o valor cru mostraria "&amp;" literal. Desfaz só as 5 entidades
 * que o servidor produz, e o resultado só vai para nó de texto, nunca para HTML.
 */
export function plainText(escaped: string): string {
  return escaped.replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, (m) => ENTITIES[m] ?? m);
}

/** Endereço do servidor MCP: a origem da API + /mcp (o servidor MCP fica na raiz do host, fora de /api). */
export function mcpServerUrl(apiBase: string = API_BASE): string {
  try {
    return `${new URL(apiBase).origin}/mcp`;
  } catch {
    return '/mcp';
  }
}

/** O endereço é local? O ChatGPT e o Claude só alcançam HTTPS público. */
export function isLocalServerUrl(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    return protocol !== 'https:' || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return true;
  }
}

export function canWrite(scopes: readonly string[]): boolean {
  return scopes.includes(WRITE_SCOPE) || scopes.includes(EDIT_ALL_SCOPE);
}

export function canEditAll(scopes: readonly string[]): boolean {
  return scopes.includes(EDIT_ALL_SCOPE);
}

/** Exportar é independente de ler e escrever: só o escopo próprio vale. */
export function canExport(scopes: readonly string[]): boolean {
  return scopes.includes(EXPORT_SCOPE);
}

/** Sessão de navegador do agente (só leitura): escopo à parte, desligado por padrão. */
export function canPreview(scopes: readonly string[]): boolean {
  return scopes.includes(PREVIEW_SCOPE);
}

/** "Só ver", "Ver e salvar peças" ou "Ver e editar todas as peças", com " · pode exportar" quando vale: o que o agente pode fazer, em palavras. */
export function describeAccess(scopes: readonly string[]): string {
  const base = canEditAll(scopes) ? 'Ver e editar todas as peças' : canWrite(scopes) ? 'Ver e salvar peças' : 'Só ver';
  const withExport = canExport(scopes) ? `${base} · pode exportar` : base;
  return canPreview(scopes) ? `${withExport} · abre o Designer no navegador (só leitura)` : withExport;
}

const ROLE_LABEL: Record<ConsentBrand['role'], string> = {
  OWNER: 'Dono',
  ADMIN: 'Administrador',
  EDITOR: 'Editor',
  VIEWER: 'Leitor',
};
export const roleLabel = (role: ConsentBrand['role']): string => ROLE_LABEL[role] ?? role;

/** Segundos restantes em "9 min" / "40 s". */
export function formatRemaining(seconds: number): string {
  if (seconds <= 0) return 'expirado';
  if (seconds < 60) return `${Math.floor(seconds)} s`;
  return `${Math.ceil(seconds / 60)} min`;
}

export const mcpApi = {
  getConsent: (requestId: string) => api.get<ConsentRequest>(`/mcp/consent/${encodeURIComponent(requestId)}`),

  decideConsent: (
    requestId: string,
    body: { decision: 'approve' | 'deny'; brandSlugs?: string[]; allBrands?: boolean; scopes?: string[] },
  ) => api.post<{ redirectUrl: string }>(`/mcp/consent/${encodeURIComponent(requestId)}`, body),

  listConnections: () => api.get<McpConnection[]>('/mcp/connections'),

  revokeConnection: (id: string) => api.delete<{ revoked: boolean }>(`/mcp/connections/${encodeURIComponent(id)}`),
};
