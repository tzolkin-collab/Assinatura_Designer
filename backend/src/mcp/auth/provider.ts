import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import {
  InvalidGrantError,
  InvalidRequestError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { logger } from '../../lib/logger.js';
import { isMcpScope, normalizeScopes, READ_SCOPE, type McpConfig, type McpScope } from '../config.js';
import type { GrantFamily, McpOAuthStore } from '../store.js';
import { TTL } from './constants.js';
import {
  newAccessToken,
  newRefreshToken,
  PKCE_CHALLENGE_PATTERN,
  randomSecret,
  sameResource,
  sha256Hex,
} from './crypto.js';

/**
 * Provedor OAuth do conector MCP, ligado aos NOSSOS usuários.
 *
 * O SDK (`mcpAuthRouter`) cuida do protocolo HTTP: parse e validação dos parâmetros,
 * PKCE S256 obrigatório, formato dos erros, /authorize, /token, /register, /revoke e os
 * metadados. Esta classe só responde às perguntas que dependem do nosso domínio:
 *  - quem é o usuário (não sabemos em /authorize — por isso delegamos ao consentimento);
 *  - quais marcas ele liberou;
 *  - onde guardar códigos e tokens.
 *
 * Invariantes que NÃO dependem de o SDK fazer certo (o SDK é genérico; nós somos o
 * dono do risco):
 *  - audiência: todo token carrega o `resource` e só emitimos para o NOSSO recurso;
 *  - código: uso único, vinculado a client_id + redirect_uri + code_challenge;
 *  - reuso de código/refresh derruba a família inteira de tokens;
 *  - só guardamos o hash dos tokens.
 */

export interface ProviderDeps {
  store: McpOAuthStore;
  config: McpConfig;
  clientsStore: OAuthRegisteredClientsStore;
  /** Relógio em ms — injetável para testar expiração sem esperar. */
  now?: () => number;
}

/** `state` é opaco para nós; 512 caracteres sobra para qualquer cliente real. */
const MAX_STATE_LENGTH = 512;

/**
 * Escopos que clientes OAuth genéricos mandam por hábito e que não significam nada aqui:
 * sempre emitimos refresh token, então `offline_access` é redundante. Ignorar (em vez de
 * `invalid_scope`) evita derrubar a conexão por um detalhe sem efeito.
 */
const IGNORED_SCOPES = new Set(['offline_access']);

/** Mensagem única para "código inexistente, expirado, de outro cliente ou reusado". */
const BAD_CODE = 'Código de autorização inválido, expirado ou já utilizado.';
const BAD_REFRESH = 'Refresh token inválido, expirado ou já utilizado.';

export class DesignerOAuthProvider implements OAuthServerProvider {
  private readonly store: McpOAuthStore;
  private readonly config: McpConfig;
  private readonly now: () => number;
  readonly clientsStore: OAuthRegisteredClientsStore;

  constructor(deps: ProviderDeps) {
    this.store = deps.store;
    this.config = deps.config;
    this.clientsStore = deps.clientsStore;
    this.now = deps.now ?? Date.now;
  }

  /**
   * /authorize NÃO autentica ninguém: aqui só chega um navegador anônimo com os
   * parâmetros do cliente. Guardamos o pedido já validado sob um id aleatório e
   * mandamos o navegador para a tela de consentimento do frontend, onde o usuário
   * faz login (se ainda não fez) e decide. Nenhum código é emitido neste passo.
   */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    // O SDK já exigiu S256, mas não valida o FORMATO do challenge. Um challenge curto/frouxo
    // enfraquece o PKCE (o verifier equivalente fica fácil de adivinhar).
    if (!PKCE_CHALLENGE_PATTERN.test(params.codeChallenge)) {
      throw new InvalidRequestError('code_challenge inválido: esperado SHA-256 em base64url (43 caracteres).');
    }

    // Servidor com UM recurso: se o cliente informou `resource`, tem de ser o nosso.
    // Se omitiu, a audiência é o nosso recurso de qualquer forma (não há outro).
    if (params.resource && !this.isOwnResource(params.resource)) {
      throw new InvalidTargetError('resource desconhecido: este servidor só emite tokens para o recurso MCP do Designer.');
    }

    // O `state` é gravado no Redis e devolvido numa URL de redirect: precisa ser finito.
    if (params.state !== undefined && params.state.length > MAX_STATE_LENGTH) {
      throw new InvalidRequestError(`state grande demais (máximo de ${MAX_STATE_LENGTH} caracteres).`);
    }

    // `scope` chega como "a b  c" quebrado em espaço: descarta vazios (scope= ou espaços
    // sobrando) e os escopos padrão que ignoramos de propósito.
    const requested = (params.scopes ?? []).map((s) => s.trim()).filter((s) => s && !IGNORED_SCOPES.has(s));
    const unknown = requested.filter((s) => !isMcpScope(s));
    if (unknown.length > 0) {
      throw new InvalidScopeError(`Escopo(s) desconhecido(s): ${unknown.slice(0, 5).join(', ')}`);
    }
    // Sem escopo pedido, o menor privilégio útil: leitura. Quem quer escrever precisa pedir.
    const scopes = normalizeScopes(requested.length > 0 ? (requested as McpScope[]) : [READ_SCOPE]);

    const requestId = randomSecret(32);
    await this.store.savePendingRequest(sha256Hex(requestId), {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state,
      resource: this.config.resourceUrl.href,
      scopes,
      createdAt: this.now(),
    });

    const consentUrl = new URL('/mcp/consent', this.config.frontendUrl);
    consentUrl.searchParams.set('request', requestId);
    res.redirect(302, consentUrl.href);
  }

  /** O SDK chama isto para checar o PKCE ANTES de trocar o código (sem consumi-lo). */
  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const codeHash = sha256Hex(authorizationCode);
    const record = await this.store.getAuthCode(codeHash);

    if (!record) {
      // Código inexistente pode ser lixo — ou um código JÁ USADO sendo reapresentado.
      // No segundo caso o OAuth 2.1 manda revogar o que foi emitido com ele.
      const familyId = await this.store.findConsumedCodeFamily(codeHash);
      if (familyId) {
        await this.store.revokeFamily(familyId);
        logger.warn('mcp.oauth.code_reuse', { clientId: client.client_id, familyId });
      }
      throw new InvalidGrantError(BAD_CODE);
    }
    // Código de outro cliente: mesma resposta de "inexistente", para não confirmar nada.
    if (record.clientId !== client.client_id) throw new InvalidGrantError(BAD_CODE);
    return record.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    // O PKCE já foi verificado pelo SDK (skipLocalPkceValidation não está ligado).
    // O consumo é a PORTA ATÔMICA: duas trocas simultâneas do mesmo código, só uma passa.
    const familyId = randomUUID();
    const consumed = await this.store.consumeAuthCode(sha256Hex(authorizationCode), familyId);

    if (consumed.status === 'reused') {
      await this.store.revokeFamily(consumed.familyId);
      logger.warn('mcp.oauth.code_reuse', { clientId: client.client_id, familyId: consumed.familyId });
      throw new InvalidGrantError(BAD_CODE);
    }
    if (consumed.status === 'missing') throw new InvalidGrantError(BAD_CODE);

    const code = consumed.record;
    if (code.clientId !== client.client_id) throw new InvalidGrantError(BAD_CODE);
    if (this.now() > code.createdAt + TTL.authCode * 1000) throw new InvalidGrantError(BAD_CODE);

    // redirect_uri do token PRECISA ser idêntica à do /authorize (OAuth 2.1 §4.1.3).
    // Exigimos a presença: nosso /authorize sempre a resolve, então um cliente legítimo
    // sempre tem o que enviar.
    if (!redirectUri || redirectUri !== code.redirectUri) {
      throw new InvalidGrantError('redirect_uri não confere com a do pedido de autorização.');
    }
    if (resource && !this.isOwnResource(resource)) {
      throw new InvalidTargetError('resource não confere com o do pedido de autorização.');
    }

    const family: GrantFamily = {
      id: familyId,
      userId: code.userId,
      clientId: client.client_id,
      clientName: client.client_name ?? 'Cliente sem nome',
      scopes: code.scopes,
      brandIds: code.brandIds,
      brandMode: code.brandMode ?? 'selected',
      resource: code.resource,
      createdAt: this.now(),
    };
    await this.store.createFamily(family);
    await this.store.touchClient(client.client_id);
    logger.info('mcp.oauth.connected', { clientId: client.client_id, familyId, userId: code.userId, scopes: code.scopes });
    return this.issueTokens(family, family.scopes);
  }

  /**
   * Refresh ROTATIVO de uso único. Cada troca invalida o refresh apresentado e emite
   * um novo; reapresentar um já consumido indica cópia vazada e revoga a família toda
   * (o dono legítimo perde a sessão e reconecta — custo aceitável contra um vazamento).
   */
  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    // Validações que NÃO dependem do registro vêm antes de consumir: um pedido malformado
    // do cliente (resource errado, escopo inventado) não pode queimar o refresh dele.
    if (resource && !this.isOwnResource(resource)) {
      throw new InvalidTargetError('resource desconhecido: este servidor só emite tokens para o recurso MCP do Designer.');
    }
    const tokenHash = sha256Hex(refreshToken);
    const peek = await this.store.getRefreshToken(tokenHash);
    const requested = (scopes ?? []).filter(Boolean);
    if (peek && requested.length > 0) {
      const family = await this.store.getFamily(peek.familyId);
      const allowed = new Set(family?.scopes ?? []);
      if (requested.some((s) => !isMcpScope(s) || !allowed.has(s))) {
        throw new InvalidScopeError('Escopo pedido excede o que foi autorizado na conexão.');
      }
    }

    const consumed = await this.store.consumeRefreshToken(tokenHash);
    if (consumed.status === 'reused') {
      await this.store.revokeFamily(consumed.familyId);
      logger.warn('mcp.oauth.refresh_reuse', { clientId: client.client_id, familyId: consumed.familyId });
      throw new InvalidGrantError(BAD_REFRESH);
    }
    if (consumed.status === 'missing') throw new InvalidGrantError(BAD_REFRESH);

    const record = consumed.record;
    if (record.clientId !== client.client_id) {
      // Outro cliente apresentando o refresh: tratamos como roubo e derrubamos a família.
      await this.store.revokeFamily(record.familyId);
      logger.warn('mcp.oauth.refresh_wrong_client', { clientId: client.client_id, familyId: record.familyId });
      throw new InvalidGrantError(BAD_REFRESH);
    }
    const family = await this.store.getFamily(record.familyId);
    if (!family) throw new InvalidGrantError(BAD_REFRESH); // família revogada

    await this.store.extendFamily(family.id);
    await this.store.touchClient(client.client_id);
    const granted = requested.length > 0 ? normalizeScopes(requested.filter(isMcpScope) as McpScope[]) : family.scopes;
    return this.issueTokens(family, granted);
  }

  /**
   * Token inválido/expirado/revogado → InvalidTokenError (o SDK transforma em 401 + WWW-Authenticate).
   * As mensagens aqui vão para um HEADER (`error_description`), então ficam em ASCII puro:
   * sem acento, sem aspas — header com caractere fora do Latin-1 derruba o `res.set`.
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const tokenHash = sha256Hex(token);
    const record = await this.store.getAccessToken(tokenHash);
    if (!record) throw new InvalidTokenError('Token invalido ou expirado.');
    if (record.expiresAt <= this.now()) throw new InvalidTokenError('Token expirado.');

    // A família precisa estar VIVA: é assim que revogar (usuário, reuso, /revoke) vale
    // na hora, mesmo com o access token ainda dentro do prazo.
    const family = await this.store.getFamily(record.familyId);
    if (!family) throw new InvalidTokenError('Token revogado.');

    // Audiência (RFC 8707): defesa em profundidade. O store só contém tokens emitidos
    // para o nosso recurso, mas a checagem é barata e é o que impede um token de outro
    // recurso (ou um registro adulterado) de passar. O SDK repete via `expectedResource`.
    if (!sameResource(family.resource, this.config.resourceUrl)) {
      throw new InvalidTokenError('Token nao foi emitido para este recurso.');
    }

    return {
      // O token em claro NÃO fica em req.auth: o hash identifica sem permitir reuso
      // (nada no caminho consegue repassar um "token passthrough" por engano).
      token: tokenHash,
      clientId: family.clientId,
      scopes: record.scopes,
      expiresAt: Math.floor(record.expiresAt / 1000),
      resource: new URL(family.resource),
      extra: {
        userId: family.userId,
        familyId: family.id,
        brandIds: family.brandIds,
        brandMode: family.brandMode ?? 'selected',
      },
    };
  }

  /** RFC 7009. Token desconhecido ou de outro cliente: responde ok sem revelar nada. */
  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const tokenHash = sha256Hex(request.token);
    const access = await this.store.getAccessToken(tokenHash);
    const familyId = access?.familyId ?? (await this.store.getRefreshToken(tokenHash))?.familyId;
    if (!familyId) return;

    const family = await this.store.getFamily(familyId);
    if (!family || family.clientId !== client.client_id) return;
    // Revogar qualquer um dos tokens derruba a conexão inteira: um refresh sobrevivente
    // ressuscitaria o acesso que o dono acabou de cortar.
    await this.store.revokeFamily(familyId);
    logger.info('mcp.oauth.revoked', { clientId: client.client_id, familyId });
  }

  /** Usado pela API do usuário (DELETE /api/mcp/connections/:id). */
  async revokeFamilyOfUser(familyId: string, userId: string): Promise<boolean> {
    const family = await this.store.getFamily(familyId);
    if (!family || family.userId !== userId) return false;
    await this.store.revokeFamily(familyId);
    logger.info('mcp.oauth.revoked_by_user', { clientId: family.clientId, familyId, userId });
    return true;
  }

  /**
   * O recurso que o cliente nomeia é "o nosso"? Aceita a URL do MCP (`<origem>/mcp`, a
   * forma canônica e a que o doc do ChatGPT manda) e a origem do servidor — alguns clientes
   * usam a origem como identificador do servidor. Não abre nada: este servidor só TEM um
   * recurso, e o token sai SEMPRE com a audiência canônica (`config.resourceUrl`),
   * qualquer que seja o apelido que o cliente tenha usado.
   */
  private isOwnResource(value: string | URL): boolean {
    return sameResource(value, this.config.resourceUrl) || sameResource(value, this.config.issuer);
  }

  private async issueTokens(family: GrantFamily, scopes: McpScope[]): Promise<OAuthTokens> {
    const accessToken = newAccessToken();
    const refreshToken = newRefreshToken();
    const expiresAt = this.now() + TTL.accessToken * 1000;

    await this.store.saveAccessToken(sha256Hex(accessToken), { familyId: family.id, scopes, expiresAt });
    await this.store.saveRefreshToken(sha256Hex(refreshToken), { familyId: family.id, clientId: family.clientId });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: TTL.accessToken,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    };
  }
}
