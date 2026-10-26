// Compatibilidade de protocolo com um CLIENTE MCP REAL: o Client + StreamableHTTPClientTransport
// do próprio SDK falando com o nosso servidor numa porta efêmera (HTTP de verdade, não supertest).
//
// Dois cenários:
//  1. token estático: initialize, tools/list e tools/call pelo cliente oficial;
//  2. OAuth COMPLETO conduzido pelo próprio SDK (descoberta via WWW-Authenticate →
//     protected-resource → authorization-server, DCR, PKCE S256, resource, token, refresh).
//     Só o "navegador" é simulado: o consentimento é um POST autenticado na nossa API.
import '../client'; // mocka prisma e redis do processo de teste (precisa vir antes do resto)
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { newAccessToken, sha256Hex } from '../../mcp/auth/crypto';
import { buildHarness, type Harness } from './harness';

let server: http.Server;
let h: Harness;
let baseUrl: string;
const toClose: Array<() => Promise<void>> = [];

beforeEach(async () => {
  // A porta só existe depois do listen, e issuer/resource derivam de PUBLIC_BASE_URL:
  // sobe o servidor HTTP vazio, descobre a porta e SÓ ENTÃO monta o app com ela.
  server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;
  h = buildHarness({ env: { PUBLIC_BASE_URL: baseUrl, MCP_ALLOW_LOCALHOST_REDIRECT: 'true' } });
  h.addMember('user-1', 'brand-a', 'EDITOR');
  h.addMember('user-1', 'brand-b', 'EDITOR');
  server.on('request', h.app);
});

afterEach(async () => {
  for (const close of toClose.splice(0)) await close().catch(() => undefined);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function newClient() {
  const client = new Client({ name: 'cliente-de-teste', version: '1.0.0' });
  toClose.push(() => client.close());
  return client;
}

/** Emite uma conexão direto no store (atalho para o cenário 1, que não testa o OAuth). */
async function mintToken(brandIds: string[], scopes: Array<'designer.read' | 'designer.write'> = ['designer.read']) {
  const familyId = `fam-${Math.random().toString(36).slice(2)}`;
  await h.store.createFamily({
    id: familyId,
    userId: 'user-1',
    clientId: 'cliente-fixo',
    clientName: 'Cliente fixo',
    scopes,
    brandIds,
    resource: `${baseUrl}/mcp`,
    createdAt: h.clock.now(),
  });
  const token = newAccessToken();
  await h.store.saveAccessToken(sha256Hex(token), { familyId, scopes, expiresAt: h.clock.now() + 3600_000 });
  return token;
}

describe('cliente MCP oficial com token', () => {
  it('initialize + tools/list + tools/call funcionam de ponta a ponta', async () => {
    const token = await mintToken(['brand-a']);
    const client = newClient();
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);

    expect(client.getServerVersion()?.name).toBe('designer-ia');
    expect(client.getInstructions()).toMatch(/list_brands/);
    expect(client.getServerCapabilities()?.tools).toBeDefined();

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'create_version', 'end_frontend_session', 'export_file', 'export_to_canva', 'get_brand_kit', 'get_brand_profile', 'get_canva_export_status',
      'get_design', 'get_designer_brief', 'get_export_status', 'get_integrations_status', 'get_photo_slots', 'list_assets',
      'list_brands', 'list_designs', 'list_versions', 'restore_version', 'save_presentation', 'set_slide_photo', 'start_frontend_session', 'update_brand_profile', 'update_slide',
      'upload_asset',
    ]);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: !['save_presentation', 'update_slide', 'create_version', 'restore_version', 'set_slide_photo', 'upload_asset', 'update_brand_profile', 'export_file', 'export_to_canva', 'start_frontend_session', 'end_frontend_session'].includes(tool.name),
        destructiveHint: tool.name === 'restore_version' || tool.name === 'update_brand_profile',
        openWorldHint: tool.name.includes('export'),
      });
      expect(tool.outputSchema?.type).toBe('object');
    }

    const brands = await client.callTool({ name: 'list_brands', arguments: {} });
    expect(brands.isError).toBeFalsy();
    expect(brands.structuredContent).toEqual({ brands: [{ slug: 'marca-a', name: 'Marca A', role: 'EDITOR' }] });

    const kit = await client.callTool({ name: 'get_brand_kit', arguments: { brandSlug: 'marca-a' } });
    expect(kit.isError).toBeFalsy();
    expect(kit.structuredContent).toMatchObject({ slug: 'marca-a', colors: ['#112233', '#ffffff'], fonts: ['Inter', 'Lora'] });
  });

  it('o cliente oficial valida o structuredContent contra o outputSchema sem reclamar', async () => {
    const token = await mintToken(['brand-a', 'brand-b']);
    const client = newClient();
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
    );
    // callTool do SDK lança se o resultado não casa com o outputSchema anunciado.
    await expect(client.callTool({ name: 'list_brands', arguments: {} })).resolves.toBeDefined();
    await expect(client.callTool({ name: 'get_brand_kit', arguments: { brandSlug: 'marca-b' } })).resolves.toBeDefined();
  });

  it('marca fora do token → erro de ferramenta (isError), não exceção de protocolo', async () => {
    const token = await mintToken(['brand-a']);
    const client = newClient();
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
    );
    const res = await client.callTool({ name: 'get_brand_kit', arguments: { brandSlug: 'marca-b' } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res)).not.toContain('CONFIDENCIAL-DA-MARCA-B');
  });

  it('sem token (e sem authProvider), connect falha com HTTP 401', async () => {
    const client = newClient();
    await expect(client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)))).rejects.toMatchObject({ code: 401 });
  });
});

/** "Aplicativo" do cliente OAuth: guarda registro/tokens/verifier em memória e simula o navegador. */
class SdkTestOAuthProvider implements OAuthClientProvider {
  readonly redirectUrl = 'http://localhost:19999/callback';
  clientInfo?: OAuthClientInformationMixed;
  savedTokens?: OAuthTokens;
  verifier = '';
  authorizationCode?: string;
  issSeen?: string | null;
  stateSeen?: { sent: string | null; got: string | null };
  authorizeUrl?: URL;

  constructor(
    private readonly harness: Harness,
    private readonly origin: string,
  ) {}

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Cliente SDK de teste',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }
  clientInformation() {
    return this.clientInfo;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.clientInfo = info;
  }
  tokens() {
    return this.savedTokens;
  }
  saveTokens(tokens: OAuthTokens) {
    this.savedTokens = tokens;
  }
  saveCodeVerifier(v: string) {
    this.verifier = v;
  }
  codeVerifier() {
    return this.verifier;
  }
  state() {
    return 'estado-do-sdk-client';
  }

  /** O "navegador": abre /authorize, cai na tela de consentimento e aprova com o JWT do usuário. */
  async redirectToAuthorization(url: URL) {
    this.authorizeUrl = url;
    const authorize = await fetch(url, { redirect: 'manual' });
    const consentUrl = new URL(authorize.headers.get('location')!);
    const requestId = consentUrl.searchParams.get('request')!;

    const approve = await fetch(`${this.origin}/api/mcp/consent/${requestId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.harness.asUser('user-1') },
      body: JSON.stringify({ decision: 'approve', brandSlugs: ['marca-a'] }),
    });
    const { data } = (await approve.json()) as { data: { redirectUrl: string } };
    const redirect = new URL(data.redirectUrl);
    this.authorizationCode = redirect.searchParams.get('code') ?? undefined;
    this.issSeen = redirect.searchParams.get('iss');
    this.stateSeen = { sent: url.searchParams.get('state'), got: redirect.searchParams.get('state') };
  }
}

describe('OAuth completo conduzido pelo cliente oficial do SDK', () => {
  it('descoberta → DCR → PKCE → consentimento → token → chamada de ferramenta → refresh transparente', async () => {
    const provider = new SdkTestOAuthProvider(h, baseUrl);
    const mcpUrl = new URL(`${baseUrl}/mcp`);

    // 1ª tentativa: 401 → descoberta → DCR → redirectToAuthorization → UnauthorizedError.
    const first = newClient();
    await expect(first.connect(new StreamableHTTPClientTransport(mcpUrl, { authProvider: provider }))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );

    // O que o SDK mandou no /authorize prova S256 + resource + escopo vindos do nosso metadata.
    expect(provider.authorizeUrl?.searchParams.get('code_challenge_method')).toBe('S256');
    expect(provider.authorizeUrl?.searchParams.get('resource')).toBe(`${baseUrl}/mcp`);
    expect(provider.authorizeUrl?.searchParams.get('scope')).toBe('designer.read designer.write designer.edit_all designer.export designer.preview designer.brand');
    expect(provider.clientInfo?.client_id).toBeTruthy();
    expect((provider.clientInfo as { client_secret?: string }).client_secret).toBeUndefined();
    // iss e state voltam na resposta de autorização.
    expect(provider.issSeen).toBe(baseUrl);
    expect(provider.stateSeen?.got).toBe(provider.stateSeen?.sent);

    // O "navegador" voltou ao app com o código: o SDK troca por tokens.
    const transport = new StreamableHTTPClientTransport(mcpUrl, { authProvider: provider });
    await transport.finishAuth(provider.authorizationCode!);
    expect(provider.savedTokens?.access_token).toMatch(/^dsg_at_/);
    expect(provider.savedTokens?.refresh_token).toMatch(/^dsg_rt_/);
    expect(provider.savedTokens?.scope).toBe('designer.read designer.write designer.edit_all designer.export');

    // Nova conexão, agora autenticada.
    const client = newClient();
    await client.connect(transport);
    const brands = await client.callTool({ name: 'list_brands', arguments: {} });
    expect(brands.structuredContent).toEqual({ brands: [{ slug: 'marca-a', name: 'Marca A', role: 'EDITOR' }] });
    // A marca B NÃO foi aprovada no consentimento: o usuário é membro, o token não.
    const blocked = await client.callTool({ name: 'get_brand_kit', arguments: { brandSlug: 'marca-b' } });
    expect(blocked.isError).toBe(true);

    // Access token expira → o cliente do SDK recebe 401, usa o refresh token e segue sem o usuário perceber.
    const before = provider.savedTokens!.access_token;
    h.clock.advance(61 * 60 * 1000);
    const afterExpiry = await client.callTool({ name: 'list_brands', arguments: {} });
    expect(afterExpiry.isError).toBeFalsy();
    expect(provider.savedTokens!.access_token).not.toBe(before);
    expect(provider.savedTokens!.refresh_token).not.toBe(undefined);
  });
});
