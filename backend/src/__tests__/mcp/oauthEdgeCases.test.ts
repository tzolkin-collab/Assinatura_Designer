// Bordas do OAuth que clientes reais exercitam: escopo vazio, `offline_access`, resource como
// origem, state gigante, e a paridade de papéis com o app web.
import '../client'; // mocka prisma e redis do processo de teste (precisa vir antes do resto)
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ANY_MEMBER, EDITORS } from '../../middleware/brandAccess';
import { ROLES_FOR_SCOPE } from '../../mcp/config';
import {
  CHATGPT_REDIRECT,
  ISSUER,
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
  it('scope vazio (scope=) vale como "sem escopo": o pedido nasce com leitura, nunca com zero escopos', async () => {
    const { challenge } = pkcePair();
    const res = await authorize(h.app, authorizeQuery(await newClientId(), challenge, { scope: '' }));
    const requestId = requestIdFromLocation(res.headers.location);
    const view = await request(h.app).get(`/api/mcp/consent/${requestId}`).set(h.asUser('user-1'));
    expect(view.body.data.scopes).toEqual(['designer.read']);
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

  it('só offline_access (sem escopo do Designer) cai no padrão de leitura', async () => {
    const { challenge } = pkcePair();
    const res = await authorize(h.app, authorizeQuery(await newClientId(), challenge, { scope: 'offline_access' }));
    const view = await request(h.app).get(`/api/mcp/consent/${requestIdFromLocation(res.headers.location)}`).set(h.asUser('user-1'));
    expect(view.body.data.scopes).toEqual(['designer.read']);
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
