import { z } from 'zod';
import { createError } from '../middleware/errorHandler.js';

/**
 * Valida `body` contra um schema zod e devolve o dado tipado, ou lança um
 * createError(400) com detalhe por campo. Padrão único de validação de corpo das
 * rotas — antes cada handler fazia `req.body as X` e checava campo a campo à mão,
 * deixando input malformado virar erro obscuro (ou default silencioso) lá adiante.
 *
 * A mensagem inclui o caminho do campo (`slideCount: Expected number...`) para que
 * o cliente saiba exatamente o que veio errado.
 */
export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const detail = parsed.error.issues
    .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
    .join('; ');
  throw createError(400, detail);
}

import dns from 'dns/promises';

// Um IP (v4 ou v6 literal) é público? Bloqueia loopback, privado, CGNAT e
// link-local (inclui a metadata 169.254.169.254) e ULA/link-local IPv6.
export function isPublicIp(ip: string): boolean {
  // `new URL('http://[::1]/').hostname` devolve "[::1]", com colchetes: sem tirá-los, '::1' e
  // 'fe80…' nunca casavam e todo IPv6 literal passava como público.
  const host = ip.toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((n) => n > 255)) return false;
    const [a, b] = o as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;              // link-local + metadata
    if (a === 172 && b >= 16 && b <= 31) return false;     // privado
    if (a === 192 && b === 168) return false;              // privado
    if (a === 100 && b >= 64 && b <= 127) return false;    // CGNAT
    return true;
  }
  if (host.includes(':')) { // IPv6
    if (host === '::' || host === '::1') return false;
    if (host.startsWith('fe80')) return false;             // link-local
    if (host.startsWith('fc') || host.startsWith('fd')) return false; // ULA
    if (host.startsWith('::ffff:')) {                      // IPv4-mapped → valida o v4 embutido
      const resto = host.slice('::ffff:'.length);
      // O parser de URL normaliza ::ffff:127.0.0.1 para a forma hex ::ffff:7f00:1.
      const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(resto);
      if (hex) {
        const hi = parseInt(hex[1]!, 16), lo = parseInt(hex[2]!, 16);
        return isPublicIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
      }
      return isPublicIp(resto);
    }
    return true;
  }
  return true;
}

// Guard SSRF síncrono (protocolo + host). Rejeita localhost e IPs privados
// literais. Usado na validação de entrada; o fetch real usa a variante que
// também resolve o DNS (contra rebinding).
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  const isLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
  if (isLiteral) return isPublicIp(host);
  return true;
}

// Variante para o momento do fetch: além do guard síncrono, resolve o hostname e
// exige que TODOS os IPs resolvidos sejam públicos — fecha o DNS rebinding
// (hostname público apontando para IP interno). Resíduo: janela TOCTOU entre a
// resolução e a conexão (mitigável só com pinning do IP na conexão).
export async function isPublicHttpUrlResolved(raw: string): Promise<boolean> {
  if (!isPublicHttpUrl(raw)) return false;
  let host: string;
  try { host = new URL(raw).hostname.toLowerCase(); } catch { return false; }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return true; // literal já validado
  try {
    const results = await dns.lookup(host, { all: true });
    return results.length > 0 && results.every((r) => isPublicIp(r.address));
  } catch {
    return false;
  }
}
