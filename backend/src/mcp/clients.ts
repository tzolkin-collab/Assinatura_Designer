/**
 * Clientes (agentes) conhecidos do conector MCP e os redirects de OAuth de cada um.
 *
 * O servidor é agnóstico de agente: qualquer cliente MCP que fale OAuth 2.1 (descoberta RFC 9728
 * e 8414, registro dinâmico RFC 7591, PKCE S256) se conecta. O que muda de um agente para outro é só
 * a `redirect_uri` para onde o navegador volta com o código. Como o /register é público, aceitamos
 * apenas redirects conhecidos (allowlist), por padrão:
 *
 *  - `chatgpt`: ChatGPT (web e apps).
 *  - `claude`:  Claude (claude.ai e o app); a Anthropic avisa que o callback pode migrar de
 *               claude.ai para claude.com, então os dois entram.
 *  - CLIs (Claude Code, Codex, Gemini CLI) usam loopback `http://127.0.0.1:<porta>/…`: valem com
 *    `MCP_ALLOW_LOCALHOST_REDIRECT=true`.
 *  - Gemini Spark: faz DCR + PKCE (confirmado em material de terceiros), mas a documentação pública não
 *    fixa a `redirect_uri`. Use `MCP_ALLOWED_REDIRECT_URIS` com o valor que o Spark enviar no registro
 *    (ele aparece no log de recusa e na tela de consentimento) ou, em último caso,
 *    `MCP_ALLOW_ANY_HTTPS_REDIRECT=true` (modo aberto, com os cuidados descritos em docs/MCP-DESIGNER.md).
 */

export const CLIENT_PRESETS = {
  chatgpt: {
    label: 'ChatGPT',
    redirects: [
      // Com issuer identification (RFC 9207), o modo preferido.
      'https://chatgpt.com/connector_platform_oauth_redirect',
      // Legado, por callback_id. `{id}` casa UM segmento `[A-Za-z0-9_-]{1,128}`.
      'https://chatgpt.com/connector/oauth/{id}',
    ],
  },
  claude: {
    label: 'Claude',
    redirects: ['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'],
  },
} as const;

export type ClientPresetName = keyof typeof CLIENT_PRESETS;

/** Presets ligados por padrão. */
export const DEFAULT_CLIENT_PRESETS: ClientPresetName[] = ['chatgpt', 'claude'];

export function isClientPreset(name: string): name is ClientPresetName {
  return Object.prototype.hasOwnProperty.call(CLIENT_PRESETS, name);
}

export interface PresetResolution {
  patterns: string[];
  names: ClientPresetName[];
  unknown: string[];
}

/** Redirects dos presets pedidos, sem repetição. Nomes desconhecidos são devolvidos (a config falha com eles). */
export function resolveClientPresets(names: string[]): PresetResolution {
  const out: ClientPresetName[] = [];
  const unknown: string[] = [];
  for (const raw of names) {
    const name = raw.trim().toLowerCase();
    if (!name) continue;
    if (isClientPreset(name)) {
      if (!out.includes(name)) out.push(name);
    } else {
      unknown.push(raw.trim());
    }
  }
  const patterns = [...new Set(out.flatMap((n) => [...CLIENT_PRESETS[n].redirects]))];
  return { patterns, names: out, unknown };
}
