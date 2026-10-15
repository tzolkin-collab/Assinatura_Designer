/**
 * Procedência de uma peça criada por agente (conector MCP).
 *
 * O dono da peça mora em `content.mcp` (quem criou por MCP, por qual cliente). O editor web
 * regrava o `content` inteiro em `PUT /posts/:id`, então esse campo é, na prática, controlado
 * pelo cliente: sem este filtro um EDITOR forja `mcp.userId` para tomar uma peça, e uma
 * regravação que o omita tira o agente da própria peça.
 *
 * Regra: o que o servidor já guardou em `content.mcp` é o único valor válido. O corpo
 * recebido nunca cria, altera nem remove o marcador.
 */
export function withServerOwnedMcp<T>(incoming: T, stored: unknown): T {
  if (typeof incoming !== 'object' || incoming === null || Array.isArray(incoming)) return incoming;

  const serverMcp =
    typeof stored === 'object' && stored !== null && !Array.isArray(stored)
      ? (stored as { mcp?: unknown }).mcp
      : undefined;

  const { mcp: _clientMcp, ...rest } = incoming as Record<string, unknown>;
  return (serverMcp === undefined ? rest : { ...rest, mcp: serverMcp }) as T;
}
