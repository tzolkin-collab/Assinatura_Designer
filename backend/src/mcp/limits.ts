/**
 * Limites de taxa do módulo MCP. Reaproveitam `middleware/rateLimit.ts` (janela fixa
 * no Redis, fail-open) — nada de contador em memória do SDK, que não funciona entre
 * instâncias e não conversa com o resto da infra.
 *
 * Os números abaixo são deliberados; cada um diz por quê.
 */
export interface RateLimitPolicy {
  windowSec: number;
  max: number;
}

export interface McpLimits {
  /** Prefixo das chaves no Redis (os testes usam um aleatório para isolar contadores). */
  keyPrefix: string;
  /** /authorize — fluxo humano no navegador; 60 a cada 15 min por IP sobra. */
  authorize: RateLimitPolicy;
  /**
   * /token — o ChatGPT troca código/refresh. O egress do ChatGPT é COMPARTILHADO (vários
   * usuários saem pelos mesmos IPs), então o teto é o dobro do padrão do SDK (50). Não
   * serve contra adivinhação (segredos têm 256 bits): serve contra abuso e carga.
   */
  token: RateLimitPolicy;
  /** /register — público e persiste dados; o uso legítimo é uma vez por conexão. Igual ao SDK. */
  register: RateLimitPolicy;
  /** /revoke — mesmo perfil do /token, só que menos frequente. */
  revoke: RateLimitPolicy;
  /** /mcp antes da autenticação, por IP: freia inundação sem identidade. */
  mcpIp: RateLimitPolicy;
  /**
   * /mcp depois da autenticação, por USUÁRIO: um turno do ChatGPT dispara ~4-6 POSTs
   * (initialize, initialized, tools/list, tools/call...). 240/min = 4/s sustentado, dá
   * folga a uma conversa intensa e ainda impede um loop descontrolado de martelar o banco.
   */
  mcpUser: RateLimitPolicy;
  /** Telas de consentimento, por usuário. */
  consent: RateLimitPolicy;
}

export const DEFAULT_LIMITS: McpLimits = {
  keyPrefix: 'mcp',
  authorize: { windowSec: 15 * 60, max: 60 },
  token: { windowSec: 15 * 60, max: 100 },
  register: { windowSec: 60 * 60, max: 20 },
  revoke: { windowSec: 15 * 60, max: 60 },
  mcpIp: { windowSec: 60, max: 600 },
  mcpUser: { windowSec: 60, max: 240 },
  consent: { windowSec: 10 * 60, max: 60 },
};
