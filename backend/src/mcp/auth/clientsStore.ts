import { logger } from '../../lib/logger.js';
import { randomUUID } from 'node:crypto';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import {
  CustomOAuthError,
  InvalidClientMetadataError,
  TemporarilyUnavailableError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { RedirectPolicy } from './redirectUris.js';
import type { McpOAuthStore } from '../store.js';
import { cleanUntrustedText } from './crypto.js';

/**
 * Clientes OAuth do conector, registrados por DCR (RFC 7591).
 *
 * O /register é PÚBLICO — qualquer um na internet pode chamar. Por isso esta classe é
 * a primeira linha de defesa e valida tudo NO REGISTRO, não só no uso:
 *  - redirect_uris contra a allowlist (ChatGPT; loopback só em dev) — é o que impede
 *    um cliente do atacante de receber códigos de autorização;
 *  - só clientes PÚBLICOS (`token_endpoint_auth_method: none`) com PKCE: o ChatGPT
 *    usa exatamente isso, e assim não existe client_secret para vazar nem comparar
 *    (o `authenticateClient` do SDK compara segredo com `!==`, sem tempo constante);
 *  - grant_types/response_types dentro do que o servidor implementa;
 *  - teto de clientes ativos (cada um ocupa Redis por 180 dias);
 *  - `client_name` é texto NÃO CONFIÁVEL: limpo de caracteres de controle/bidi e
 *    cortado. Ele é exibido na tela de consentimento, o ponto onde o usuário decide
 *    confiar — por isso nunca é interpretado, e o consentimento o devolve escapado.
 */

const ALLOWED_GRANT_TYPES = ['authorization_code', 'refresh_token'];
const MAX_REDIRECT_URIS = 5;
const MAX_CLIENT_NAME = 100;

export class DesignerClientsStore implements OAuthRegisteredClientsStore {
  constructor(
    private readonly store: McpOAuthStore,
    private readonly redirectPolicy: RedirectPolicy,
    private readonly maxClients: number,
  ) {}

  getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return this.store.getClient(clientId);
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>,
  ): Promise<OAuthClientInformationFull> {
    const redirectUris = client.redirect_uris ?? [];
    if (redirectUris.length === 0 || redirectUris.length > MAX_REDIRECT_URIS) {
      throw new InvalidClientMetadataError(`Informe de 1 a ${MAX_REDIRECT_URIS} redirect_uris.`);
    }
    for (const uri of redirectUris) {
      if (!this.redirectPolicy.isAllowed(String(uri))) {
        // Para o operador liberar um agente novo: o HOST de retorno (nunca a URI inteira nem o nome
        // cru, que são de um cliente não confiável) vai para o log, não para a resposta.
        let redirectHost = 'inválido';
        try {
          redirectHost = new URL(String(uri)).host.slice(0, 120);
        } catch {
          /* mantém "inválido" */
        }
        logger.warn('mcp.register_refused', { reason: 'redirect_uri_fora_da_allowlist', redirectHost });
        // Não ecoa a URI: ela é do atacante e o erro vai para um cliente não confiável.
        throw new CustomOAuthError('invalid_redirect_uri', 'redirect_uri fora da lista de redirecionamentos permitidos.');
      }
    }

    // Ausente = público (o que o ChatGPT envia). Qualquer método com segredo é recusado.
    if (client.token_endpoint_auth_method !== undefined && client.token_endpoint_auth_method !== 'none') {
      throw new InvalidClientMetadataError('Só clientes públicos são aceitos: token_endpoint_auth_method deve ser "none" (PKCE S256).');
    }

    const grantTypes = client.grant_types ?? ALLOWED_GRANT_TYPES;
    if (grantTypes.length === 0 || grantTypes.some((g) => !ALLOWED_GRANT_TYPES.includes(g))) {
      throw new InvalidClientMetadataError('grant_types aceitos: authorization_code e refresh_token.');
    }
    const responseTypes = client.response_types ?? ['code'];
    if (responseTypes.length === 0 || responseTypes.some((r) => r !== 'code')) {
      throw new InvalidClientMetadataError('response_types aceito: code.');
    }

    // O SDK gera client_id/client_id_issued_at antes de chamar aqui; o cast reflete isso.
    const generated = client as Partial<OAuthClientInformationFull>;
    const registered: OAuthClientInformationFull = {
      client_id: generated.client_id ?? randomUUID(),
      client_id_issued_at: generated.client_id_issued_at ?? Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      client_name: cleanUntrustedText(client.client_name, MAX_CLIENT_NAME) || 'Cliente sem nome',
      grant_types: grantTypes,
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      // Propositalmente SEM client_secret: cliente público.
    };

    const saved = await this.store.saveClient(registered, this.maxClients);
    if (saved === 'limit') {
      throw new TemporarilyUnavailableError('Limite de clientes registrados atingido. Tente novamente mais tarde.');
    }
    return registered;
  }
}
