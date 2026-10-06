/**
 * Tempos de vida do OAuth do conector MCP, em SEGUNDOS.
 *
 * Os valores seguem o equilíbrio de sempre: credenciais que viajam em URL ou header
 * vivem pouco; o que sustenta a conexão (refresh) vive mais, mas é rotativo.
 */
export const TTL = {
  /** Pedido de autorização esperando o usuário decidir na tela de consentimento. */
  authRequest: 10 * 60,
  /** Código de autorização: uso único e curto (OAuth 2.1 recomenda ≤ 10 min; usamos 5). */
  authCode: 5 * 60,
  /** Access token. Curto: se vazar, a janela é de uma hora. */
  accessToken: 60 * 60,
  /** Refresh token (deslizante: cada rotação ganha mais 30 dias). */
  refreshToken: 30 * 24 * 60 * 60,
  /** Cliente registrado por DCR. Renovado a cada emissão de token. */
  client: 180 * 24 * 60 * 60,
  /**
   * Quanto tempo lembramos que um código/refresh JÁ foi consumido, para detectar reuso.
   * O código só vale 5 min, mas a tombstone dura mais: o reuso malicioso costuma vir
   * depois. O refresh usa o próprio TTL do refresh (a tombstone nunca expira antes dele).
   */
  codeTombstone: 60 * 60,
  /** Histórico de chamadas de ferramenta por marca (a lista também é limitada em tamanho). */
  callLog: 90 * 24 * 60 * 60,
} as const;

/** Tamanho máximo do histórico de chamadas por marca (LTRIM). */
export const CALL_LOG_MAX_ENTRIES = 500;

/** Quantos clientes DCR por padrão (sobrescrevível por MCP_MAX_CLIENTS). */
export const DEFAULT_MAX_CLIENTS = 500;
