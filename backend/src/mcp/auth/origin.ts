import type { RequestHandler } from 'express';
import type { McpConfig } from '../config.js';

/**
 * Validação do header Origin em /mcp — proteção contra DNS rebinding e contra páginas
 * de terceiros falando com o servidor pelo navegador do usuário (exigência da spec
 * Streamable HTTP do MCP).
 *
 * O ChatGPT chama de servidor para servidor e NÃO envia Origin: ausência é normal e
 * passa (quem não é navegador não tem o que o rebinding explore). Se há Origin, é um
 * navegador falando, e ele precisa estar na allowlist.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isAllowedOrigin(origin: unknown, config: Pick<McpConfig, 'allowedOrigins' | 'allowLocalhost'>): boolean {
  if (typeof origin !== 'string' || origin.length === 0) return false;
  if (config.allowedOrigins.includes(origin)) return true;

  if (config.allowLocalhost) {
    try {
      const url = new URL(origin);
      // `new URL(origin).origin === origin` descarta "http://localhost:3000/qualquer-coisa".
      return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname) && url.origin === origin;
    } catch {
      return false;
    }
  }
  return false;
}

export function createOriginGuard(config: McpConfig): RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin === undefined) return next();
    if (isAllowedOrigin(origin, config)) return next();
    res.status(403).json({ error: 'forbidden_origin', error_description: 'Origin nao permitida para este servidor MCP.' });
  };
}
