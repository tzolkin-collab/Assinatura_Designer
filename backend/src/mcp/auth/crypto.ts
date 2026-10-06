import { createHash, randomBytes } from 'node:crypto';

/**
 * Primitivas de segredo do módulo MCP.
 *
 * Tudo que é credencial (código de autorização, access token, refresh token, id do
 * pedido de consentimento) é gerado aqui, com `crypto.randomBytes` (CSPRNG), e SÓ o
 * hash SHA-256 vai para o Redis. Assim um dump do Redis (backup, `MONITOR`, log de
 * infraestrutura) não entrega nenhum token utilizável. SHA-256 simples basta — e é
 * melhor que bcrypt/scrypt aqui — porque a entrada tem 256 bits de entropia: não há
 * dicionário para atacar, só força bruta de 2^256.
 */

/** 32 bytes = 256 bits, em base64url (43 caracteres, seguro em URL e header). */
export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// Prefixos tornam o vazamento detectável: scanners de segredo (GitHub, trufflehog) e um
// simples grep nos logs reconhecem o formato. Não carregam significado de segurança.
export const ACCESS_TOKEN_PREFIX = 'dsg_at_';
export const REFRESH_TOKEN_PREFIX = 'dsg_rt_';

export function newAccessToken(): string {
  return ACCESS_TOKEN_PREFIX + randomSecret(32);
}

export function newRefreshToken(): string {
  return REFRESH_TOKEN_PREFIX + randomSecret(32);
}

/**
 * Compara dois identificadores de recurso (RFC 8707). Tolera só o que a RFC tolera na
 * prática: fragmento (que nem deveria vir) e UMA barra final — o ChatGPT é quem digita
 * a URL do conector, e `https://x/mcp/` vs `https://x/mcp` é erro humano comum. Qualquer
 * outra diferença (host, porta, path, esquema) é recurso diferente e é recusada.
 */
export function sameResource(a: string | URL, b: string | URL): boolean {
  const norm = (v: string | URL) => {
    const text = String(v);
    const hash = text.indexOf('#');
    return (hash === -1 ? text : text.slice(0, hash)).replace(/\/$/, '');
  };
  return norm(a) === norm(b);
}

/** S256 sempre tem 43 caracteres base64url (SHA-256 = 32 bytes). Rejeita challenge frouxo. */
export const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** RFC 7636 §4.1: o verifier tem de 43 a 128 caracteres do alfabeto unreserved. */
export const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Caracteres que não deveriam existir num nome exibido: controle, invisíveis e de inversão (bidi). */
function isInvisibleOrControl(codePoint: number): boolean {
  return (
    codePoint <= 0x1f || // C0 (inclui NUL, quebras de linha)
    (codePoint >= 0x7f && codePoint <= 0x9f) || // DEL e C1
    (codePoint >= 0x200b && codePoint <= 0x200f) || // zero-width, LRM, RLM
    (codePoint >= 0x2028 && codePoint <= 0x202e) || // separadores de linha/parágrafo e overrides bidi
    (codePoint >= 0x2066 && codePoint <= 0x2069) || // isolates bidi
    codePoint === 0xfeff // BOM / zero-width no-break space
  );
}

/** Texto vindo de cliente não confiável: sem caracteres de controle, aparado e com teto. */
export function cleanUntrustedText(value: string | undefined, maxLength: number): string {
  const visible = [...(value ?? '')].filter((ch) => !isInvisibleOrControl(ch.codePointAt(0) as number)).join('');
  return visible.trim().slice(0, maxLength);
}
