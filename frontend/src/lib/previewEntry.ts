/**
 * Entrada da sessão de navegador do agente (`/mcp/entrar`).
 *
 * O agente recebe do Designer (ferramenta MCP `start_frontend_session`) uma URL do tipo
 * `https://app/mcp/entrar#code=<código de uso único>`. O código vai no FRAGMENTO de propósito: o navegador não o
 * envia ao servidor (nem ao Vercel/CDN, nem ao Referer), então ele não cai em log de acesso. A página lê o fragmento,
 * APAGA da barra de endereço antes de qualquer chamada de rede, troca o código no backend e guarda o token da sessão
 * (somente leitura, 2 h) do mesmo jeito que o login guarda o JWT: localStorage + cookie `auth_token`.
 */

/** Formato do código que o backend emite (32 bytes em base64url = 43 caracteres). Qualquer outra coisa nem é enviada. */
const CODE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

/** Lê `#code=...` do fragmento. `null` se faltar ou estiver malformado. */
export function readPreviewCode(hash: string): string | null {
  if (hash.startsWith('?')) return null;
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const code = new URLSearchParams(raw).get('code');
  return code && CODE_PATTERN.test(code) ? code : null;
}

/**
 * Linha do cookie `auth_token` da sessão. Vale até o fim da sessão (nunca mais que isso), `SameSite=Strict` e `Secure`
 * em https. O backend NÃO usa este cookie para autorizar a API (a API lê o header Authorization, então não há CSRF
 * por cookie); ele só deixa o middleware do Next deixar a pessoa entrar nas telas.
 */
export function sessionCookie(token: string, expiresAtIso: string, opts: { secure: boolean; nowMs: number }): string {
  const seconds = Math.max(0, Math.floor((Date.parse(expiresAtIso) - opts.nowMs) / 1000));
  return `auth_token=${token}; path=/; max-age=${seconds}; SameSite=Strict${opts.secure ? '; Secure' : ''}`;
}
