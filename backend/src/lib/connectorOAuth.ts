import crypto from 'crypto';

// Núcleo compartilhado dos três conectores por-usuário (Asana, Google Drive, Canva):
// mesmo handshake OAuth2 (auth-url → callback → troca de code por token), mesma
// necessidade de token criptografado em repouso e de state anti-CSRF com expiração.
// Antes cada rota reimplementava isso e divergia — Asana e Drive guardavam token em
// texto puro e usavam `state = userId` cru (qualquer um podia forjar o callback
// apontando pro userId de outra pessoa); só o Canva fazia certo. Ver docs/PLANO-CONSOLIDACAO.md §1.2/§3 Fase 1.

/** Nonce aleatório para o parâmetro `state` do OAuth2 — prova que o callback
 *  responde a um auth-url que nós geramos, não a um valor forjado pelo cliente. */
export function generateOAuthState(): string {
  return crypto.randomBytes(32).toString('base64url');
}

const DEFAULT_STATE_MAX_AGE_MS = 10 * 60 * 1000;

/** O state expira para mitigar replay de um link de autorização antigo/vazado. */
export function isStateFresh(stateAt: Date | null | undefined, maxAgeMs = DEFAULT_STATE_MAX_AGE_MS): boolean {
  if (!stateAt) return false;
  return Date.now() - stateAt.getTime() <= maxAgeMs;
}

const DEFAULT_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/** Verdadeiro quando o token expira dentro do buffer (ou já expirou / sem data). */
export function isTokenExpiringSoon(expiresAt: Date | null | undefined, bufferMs = DEFAULT_EXPIRY_BUFFER_MS): boolean {
  const expiresAtMs = expiresAt?.getTime() ?? 0;
  return expiresAtMs - bufferMs <= Date.now();
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  [key: string]: unknown;
}

/** Troca padrão `application/x-www-form-urlencoded` — cobre Asana e Google (Canva
 *  usa PKCE + Basic auth e mantém sua própria função em canvaClient.ts). */
export async function exchangeAuthorizationCode(
  tokenUrl: string,
  params: Record<string, string>,
): Promise<OAuthTokenResponse> {
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<OAuthTokenResponse>;
}

/** Mesma troca, para o grant `refresh_token`. */
export async function refreshOAuthToken(
  tokenUrl: string,
  params: Record<string, string>,
): Promise<OAuthTokenResponse> {
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, grant_type: 'refresh_token' }).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token refresh failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<OAuthTokenResponse>;
}
