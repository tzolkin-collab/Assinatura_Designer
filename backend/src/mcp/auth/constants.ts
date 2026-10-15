/**
 * Tempos de vida do OAuth do conector MCP, em SEGUNDOS.
 *
 * Os valores seguem o equilíbrio de sempre: credenciais que viajam em URL ou header
 * vivem pouco; o que sustenta a conexão (refresh) vive mais, mas é rotativo.
 */
export const TTL = {
  /**
   * Pedido de autorização esperando o usuário decidir na tela de consentimento. 5 min:
   * é o tempo de LER a tela e decidir. Mais que isso só amplia a janela de quem recebe o
   * link de consentimento por um terceiro (consent phishing) — e expirar custa pouco, o
   * usuário volta ao ChatGPT e conecta de novo.
   */
  authRequest: 5 * 60,
  /** Código de autorização: uso único e curto (OAuth 2.1 recomenda ≤ 10 min; usamos 5). */
  authCode: 5 * 60,
  /** Access token. Curto: se vazar, a janela é de uma hora. */
  accessToken: 60 * 60,
  /** Refresh token (deslizante: cada rotação ganha mais 30 dias — até o teto absoluto da conexão). */
  refreshToken: 30 * 24 * 60 * 60,
  /** Cliente registrado por DCR que JÁ emitiu token. Renovado a cada emissão de token. */
  client: 180 * 24 * 60 * 60,
  /**
   * Cliente registrado por DCR que NUNCA emitiu token. O /register é público: sem isto,
   * um anônimo ocuparia o cadastro por 180 dias com registros descartáveis. 24 h cobre o
   * uso legítimo (o conector é criado e o consentimento termina no mesmo dia, mesmo que
   * o usuário se distraia) e é o tempo que um registro abandonado ocupa vaga. A defesa
   * contra esgotamento NÃO depende deste número — ela é o teto de "não utilizados" com
   * descarte dos mais antigos (ver store.saveClient); o TTL só faz a limpeza natural.
   * Promovido a `client` (180 d) na PRIMEIRA emissão de token.
   */
  clientUnused: 24 * 60 * 60,
  /**
   * Quanto tempo lembramos que um código/refresh JÁ foi consumido, para detectar reuso.
   * O código só vale 5 min, mas a tombstone dura mais: o reuso malicioso costuma vir
   * depois. O refresh usa o próprio TTL do refresh (a tombstone nunca expira antes dele).
   */
  codeTombstone: 60 * 60,
  /** Histórico de chamadas de ferramenta (as listas também são limitadas em tamanho). */
  callLog: 90 * 24 * 60 * 60,
} as const;

/**
 * Janela de tolerância ("leeway") para reapresentar um refresh/código JÁ consumido: o
 * mesmo cliente que repete a troca dentro dela (retry após resposta perdida, duas
 * requisições concorrentes) recebe o MESMO par de tokens em vez de derrubar a conexão.
 * Mesma ideia do "reuse interval" da Auth0. Fora dela, ou vindo de outro cliente, é reuso
 * de verdade e revoga a família. 15 s cobre timeout + retry de qualquer cliente HTTP
 * razoável sem dar tempo útil a quem copiou um token vazado.
 */
export const REUSE_LEEWAY_SEC = 15;

/**
 * Quanto um cliente DCR recém-registrado e ainda sem token fica PROTEGIDO de descarte.
 * É o tempo máximo de um fluxo legítimo: pedido de consentimento (5 min) + código (5 min).
 * Dentro dele o cliente nunca é descartado para dar vaga a outro registro.
 */
export const CLIENT_UNUSED_PROTECT_SEC = TTL.authRequest + TTL.authCode;

/** Tamanho máximo da lista de chamadas POR USUÁRIO (todas as marcas). */
export const CALL_LOG_MAX_ENTRIES = 500;

/**
 * Tamanho máximo da lista de chamadas de UM usuário DENTRO de UMA marca. Cada par
 * (marca, usuário) tem a própria lista: assim um usuário que dispara milhares de
 * chamadas só expulsa o PRÓPRIO histórico, nunca o dos colegas. A leitura da marca
 * mescla as listas dos usuários por data.
 */
export const CALL_LOG_MAX_PER_BRAND_USER = 200;

/** Quantos clientes DCR por padrão (sobrescrevível por MCP_MAX_CLIENTS). */
export const DEFAULT_MAX_CLIENTS = 500;

/** Teto de clientes registrados que nunca emitiram token (MCP_MAX_UNUSED_CLIENTS). */
export const DEFAULT_MAX_UNUSED_CLIENTS = 100;

/** Conexões ativas por usuário (MCP_MAX_CONNECTIONS_PER_USER). */
export const DEFAULT_MAX_CONNECTIONS_PER_USER = 10;

/** Vida ABSOLUTA da conexão, a partir do consentimento (MCP_CONNECTION_MAX_AGE_DAYS). */
export const DEFAULT_CONNECTION_MAX_AGE_DAYS = 90;
