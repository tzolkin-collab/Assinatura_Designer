/**
 * Allowlist de redirect_uri para o registro de clientes OAuth (DCR) do conector MCP.
 *
 * Por que existe: o /register é público (qualquer um pode chamar). Sem allowlist, um
 * atacante registra um cliente com `redirect_uri` dele e usa o link de consentimento
 * para receber o código de autorização de outra pessoa. A defesa é só aceitar
 * redirects que sabemos serem do ChatGPT (ou, em dev, do loopback do MCP Inspector).
 *
 * Regras de propósito RESTRITAS — match exato, sem prefixo nem curinga solto:
 *  - cada entrada da allowlist é uma URL https absoluta, sem query/fragmento/userinfo;
 *  - o único "curinga" aceito é o segmento literal `{id}`, que casa EXATAMENTE UM
 *    segmento de path de `[A-Za-z0-9_-]{1,128}` (o `callback_id` do ChatGPT);
 *  - a URI candidata precisa estar em forma canônica (`new URL(x).href === x`): isso
 *    rejeita porta padrão explícita, `..`, host em maiúsculas, `%2f` e afins, onde a
 *    string que validamos poderia diferir da que o navegador de fato abre.
 */

const ID_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

interface CompiledPattern {
  origin: string;
  segments: string[];
}

export interface RedirectPolicy {
  /** `true` se a URI candidata é permitida pela allowlist (ou pelo loopback de dev). */
  isAllowed(uri: string): boolean;
}

function compilePattern(raw: string): CompiledPattern {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`MCP_ALLOWED_REDIRECT_URIS: URL inválida "${raw}"`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`MCP_ALLOWED_REDIRECT_URIS: só https é aceito ("${raw}")`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`MCP_ALLOWED_REDIRECT_URIS: sem userinfo, query ou fragmento ("${raw}")`);
  }
  // `{id}` vira %7Bid%7D depois do parse da URL, então o path vem da string original.
  const rawPath = /^https:\/\/[^/]+(\/.*)?$/i.exec(raw.trim())?.[1] ?? '/';
  return { origin: url.origin, segments: rawPath.split('/') };
}

function matchesPattern(candidate: URL, pattern: CompiledPattern): boolean {
  if (candidate.origin !== pattern.origin) return false;
  const segments = candidate.pathname.split('/');
  if (segments.length !== pattern.segments.length) return false;
  return pattern.segments.every((expected, i) =>
    expected === '{id}' ? ID_SEGMENT.test(segments[i]) : expected === segments[i],
  );
}

function isLoopbackUri(candidate: URL): boolean {
  return (
    candidate.protocol === 'http:' &&
    LOOPBACK_HOSTS.has(candidate.hostname) &&
    !candidate.search &&
    !candidate.hash &&
    !candidate.username &&
    !candidate.password
  );
}

export function compileRedirectPolicy(patterns: string[], allowLocalhost: boolean): RedirectPolicy {
  const compiled = patterns.map(compilePattern);

  return {
    isAllowed(uri: string): boolean {
      if (typeof uri !== 'string' || uri.length === 0 || uri.length > 512) return false;
      let candidate: URL;
      try {
        candidate = new URL(uri);
      } catch {
        return false;
      }
      // Forma canônica: o que validamos tem que ser byte a byte o que o navegador abre.
      if (candidate.href !== uri) return false;
      if (candidate.hash || candidate.username || candidate.password) return false;

      if (allowLocalhost && isLoopbackUri(candidate)) return true;
      if (candidate.protocol !== 'https:' || candidate.search) return false;
      return compiled.some((pattern) => matchesPattern(candidate, pattern));
    },
  };
}
