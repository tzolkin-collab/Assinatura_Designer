// Bordas do OAuth que clientes reais exercitam: escopo vazio, `offline_access`, resource como
// origem, state gigante, e a paridade de papéis com o app web.
import '../client'; // mocka prisma e redis do processo de teste (precisa vir antes do resto)
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { ANY_MEMBER, EDITORS } from '../../middleware/brandAccess';
import { DesignerClientsStore } from '../../mcp/auth/clientsStore';
import { sha256Hex } from '../../mcp/auth/crypto';
import { DesignerOAuthProvider } from '../../mcp/auth/provider';
import { ROLES_FOR_SCOPE } from '../../mcp/config';
import {
  CHATGPT_REDIRECT,
  ISSUER,
  callTool,
  mcpPost,
  RESOURCE,
  authorize,
  authorizeQuery,
  buildHarness,
  decide,
  exchange,
  pkcePair,
  registerClient,
  requestIdFromLocation,
  type Harness,
} from './harness';

let h: Harness;

beforeEach(() => {
  h = buildHarness();
  h.addMember('user-1', 'brand-a', 'EDITOR');
});

async function newClientId() {
  return (await registerClient(h.app)).body.client_id as string;
}

describe('escopos pedidos no /authorize', () => {
  it('scope vazio (scope=) vale como "sem escopo": o pedido cobre todos os escopos suportados, nunca com zero escopos', async () => {
    const { challenge } = pkcePair();
    const res = await authorize(h.app, authorizeQuery(await newClientId(), challenge, { scope: '' }));
    const requestId = requestIdFromLocation(res.headers.location);
    const view = await request(h.app).get(`/api/mcp/consent/${requestId}`).set(h.asUser('user-1'));
    expect(view.body.data.scopes).toEqual(['designer.read', 'designer.write', 'designer.edit_all']);
  });

  it('espaços extras no scope não viram escopo inválido', async () => {
    const { challenge } = pkcePair();
    const res = await authorize(h.app, authorizeQuery(await newClientId(), challenge, { scope: ' designer.read  designer.write ' }));
    const view = await request(h.app).get(`/api/mcp/consent/${requestIdFromLocation(res.headers.location)}`).set(h.asUser('user-1'));
    expect(view.body.data.scopes).toEqual(['designer.read', 'designer.write']);
  });

  it('offline_access é ignorado (sempre emitimos refresh), mas escopo realmente desconhecido continua sendo erro', async () => {
    const { challenge } = pkcePair();
    const ok = await authorize(h.app, authorizeQuery(await newClientId(), challenge, { scope: 'designer.read offline_access' }));
    const view = await request(h.app).get(`/api/mcp/consent/${requestIdFromLocation(ok.headers.location)}`).set(h.asUser('user-1'));
    expect(view.body.data.scopes).toEqual(['designer.read']);

    const bad = await authorize(h.app, authorizeQuery(await newClientId(), challenge, { scope: 'designer.read admin' }));
    expect(new URL(bad.headers.location).searchParams.get('error')).toBe('invalid_scope');
  });

  it('só offline_access (sem escopo do Designer) cai no padrão (todos os escopos suportados)', async () => {
    const { challenge } = pkcePair();
    const res = await authorize(h.app, authorizeQuery(await newClientId(), challenge, { scope: 'offline_access' }));
    const view = await request(h.app).get(`/api/mcp/consent/${requestIdFromLocation(res.headers.location)}`).set(h.asUser('user-1'));
    expect(view.body.data.scopes).toEqual(['designer.read', 'designer.write', 'designer.edit_all']);
  });
});

describe('resource', () => {
  it('a origem do servidor (sem /mcp) também é "o nosso" — e o token sai com a audiência canônica', async () => {
    const clientId = await newClientId();
    const pkce = pkcePair();
    const res = await authorize(h.app, authorizeQuery(clientId, pkce.challenge, { resource: ISSUER }));
    expect(res.status).toBe(302);
    expect(new URL(res.headers.location).searchParams.get('error')).toBeNull();

    const requestId = requestIdFromLocation(res.headers.location);
    const approve = await decide(h, requestId, 'user-1', { decision: 'approve', brandSlugs: ['marca-a'] });
    const code = new URL(approve.body.data.redirectUrl).searchParams.get('code')!;
    const token = await exchange(h.app, {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: pkce.verifier,
      redirect_uri: CHATGPT_REDIRECT,
      resource: `${ISSUER}/`,
    });
    expect(token.status).toBe(200);

    const families = await h.store.listFamiliesByUser('user-1');
    expect(families[0].resource).toBe(RESOURCE); // sempre o canônico, qualquer que seja o alias enviado
  });

  it.each([
    'https://outro.example.net',
    'https://api.example.test.evil.net/mcp',
    'https://api.example.test/outro',
    'https://api.example.test:8443/mcp',
    'http://api.example.test/mcp',
  ])('resource %s continua sendo recusado', async (resource) => {
    const { challenge } = pkcePair();
    const res = await authorize(h.app, authorizeQuery(await newClientId(), challenge, { resource }));
    expect(new URL(res.headers.location).searchParams.get('error')).toBe('invalid_target');
  });
});

describe('state', () => {
  it('state gigante é recusado (não vira armazenamento nem URL de redirect sem limite)', async () => {
    const { challenge } = pkcePair();
    const res = await authorize(h.app, authorizeQuery(await newClientId(), challenge, { state: 's'.repeat(2000) }));
    const url = new URL(res.headers.location);
    expect(url.searchParams.get('error')).toBe('invalid_request');
  });

  it('state de tamanho normal passa intacto até o redirect de aprovação', async () => {
    const { challenge } = pkcePair();
    const state = 'x'.repeat(400);
    const res = await authorize(h.app, authorizeQuery(await newClientId(), challenge, { state }));
    const approve = await decide(h, requestIdFromLocation(res.headers.location), 'user-1', { decision: 'approve', brandSlugs: ['marca-a'] });
    expect(new URL(approve.body.data.redirectUrl).searchParams.get('state')).toBe(state);
  });
});

describe('papéis do conector = papéis do app web', () => {
  it('leitura = ANY_MEMBER e escrita = EDITORS (se brandAccess mudar, este teste obriga a revisar o conector)', () => {
    expect([...ROLES_FOR_SCOPE['designer.read']].sort()).toEqual([...ANY_MEMBER].sort());
    expect([...ROLES_FOR_SCOPE['designer.write']].sort()).toEqual([...EDITORS].sort());
  });
});

describe('reuso de código na CORRIDA (o caminho do exchange, que o challenge não cobre)', () => {
  // O SDK chama challengeForAuthorizationCode antes de trocar o código; um reuso comum morre
  // lá. Mas duas trocas simultâneas passam as duas pelo challenge — e só o consumo atômico do
  // exchange as distingue. Aqui o exchange é chamado direto, como o segundo da corrida.
  it('o segundo consumo derruba a família que o primeiro acabou de criar', async () => {
    const clientId = await newClientId();
    const pkce = pkcePair();
    const auth = await authorize(h.app, authorizeQuery(clientId, pkce.challenge));
    const approve = await decide(h, requestIdFromLocation(auth.headers.location), 'user-1', { decision: 'approve', brandSlugs: ['marca-a'] });
    const code = new URL(approve.body.data.redirectUrl).searchParams.get('code')!;

    const first = await exchange(h.app, {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: pkce.verifier,
      redirect_uri: CHATGPT_REDIRECT,
    });
    expect(first.status).toBe(200);
    expect((await mcpPost(h.app, first.body.access_token, callTool('list_brands'))).status).toBe(200);

    const provider = new DesignerOAuthProvider({
      store: h.store,
      config: h.config,
      clientsStore: new DesignerClientsStore(h.store, h.config.redirectPolicy, 10),
      now: h.clock.now,
    });
    const client = (await h.store.getClient(clientId))!;
    await expect(provider.exchangeAuthorizationCode(client, code, undefined, CHATGPT_REDIRECT)).rejects.toBeInstanceOf(InvalidGrantError);

    // A conexão criada pelo primeiro consumo foi revogada junto.
    expect((await mcpPost(h.app, first.body.access_token, callTool('list_brands'))).status).toBe(401);
    expect(await h.store.listFamiliesByUser('user-1')).toEqual([]);
  });

  it('o exchange confere o dono do código por conta própria (não depende de o challenge ter rodado antes)', async () => {
    const clientId = await newClientId();
    const outroId = await newClientId();
    const pkce = pkcePair();
    const auth = await authorize(h.app, authorizeQuery(clientId, pkce.challenge));
    const approve = await decide(h, requestIdFromLocation(auth.headers.location), 'user-1', { decision: 'approve', brandSlugs: ['marca-a'] });
    const code = new URL(approve.body.data.redirectUrl).searchParams.get('code')!;

    const provider = new DesignerOAuthProvider({
      store: h.store,
      config: h.config,
      clientsStore: new DesignerClientsStore(h.store, h.config.redirectPolicy, 10),
      now: h.clock.now,
    });
    const outro = (await h.store.getClient(outroId))!;
    await expect(provider.exchangeAuthorizationCode(outro, code, undefined, CHATGPT_REDIRECT)).rejects.toBeInstanceOf(InvalidGrantError);
    expect(await h.store.listFamiliesByUser('user-1')).toEqual([]); // nenhuma conexão nasceu
  });
});

describe('verifyAccessToken sozinho (as camadas do SDK no /mcp não mascaram o provider)', () => {
  // No /mcp o `requireBearerAuth` do SDK repete a checagem de expiração e de audiência, então
  // um bug aqui seria encoberto no teste HTTP. Chamando o verifier direto, cada regra é provada
  // pelo que ELE faz.
  function newProvider() {
    return new DesignerOAuthProvider({
      store: h.store,
      config: h.config,
      clientsStore: new DesignerClientsStore(h.store, h.config.redirectPolicy, 10),
      now: h.clock.now,
    });
  }

  async function family(resource = RESOURCE) {
    const id = `fam-${Math.random().toString(36).slice(2)}`;
    await h.store.createFamily({
      id,
      userId: 'user-1',
      clientId: 'c1',
      clientName: 'ChatGPT',
      scopes: ['designer.read'],
      brandIds: ['brand-a'],
      resource,
      createdAt: h.clock.now(),
    });
    return id;
  }

  it('aceita um token vivo e devolve usuário, escopo, audiência e marcas — mas não o token em claro', async () => {
    const familyId = await family();
    await h.store.saveAccessToken(sha256Hex('dsg_at_vivo'), { familyId, scopes: ['designer.read'], expiresAt: h.clock.now() + 60_000 });
    const info = await newProvider().verifyAccessToken('dsg_at_vivo');
    expect(info.extra).toEqual({ userId: 'user-1', familyId, brandIds: ['brand-a'], brandMode: 'selected' });
    expect(info.resource?.href).toBe(RESOURCE);
    expect(info.scopes).toEqual(['designer.read']);
    expect(info.token).not.toContain('dsg_at_vivo');
  });

  it('recusa expiresAt vencido mesmo com a chave ainda no store', async () => {
    const familyId = await family();
    await h.store.saveAccessToken(sha256Hex('dsg_at_velho'), { familyId, scopes: ['designer.read'], expiresAt: h.clock.now() - 1 });
    await expect(newProvider().verifyAccessToken('dsg_at_velho')).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('recusa token de outro recurso (audiência)', async () => {
    const familyId = await family('https://outro.example.net/mcp');
    await h.store.saveAccessToken(sha256Hex('dsg_at_outro'), { familyId, scopes: ['designer.read'], expiresAt: h.clock.now() + 60_000 });
    await expect(newProvider().verifyAccessToken('dsg_at_outro')).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('recusa token cuja família foi revogada', async () => {
    const familyId = await family();
    await h.store.saveAccessToken(sha256Hex('dsg_at_rev'), { familyId, scopes: ['designer.read'], expiresAt: h.clock.now() + 60_000 });
    await h.store.revokeFamily(familyId);
    await expect(newProvider().verifyAccessToken('dsg_at_rev')).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('recusa token desconhecido', async () => {
    await expect(newProvider().verifyAccessToken('dsg_at_nunca_existiu')).rejects.toBeInstanceOf(InvalidTokenError);
  });
});
