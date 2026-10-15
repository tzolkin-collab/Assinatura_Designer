// Contrato do RedisMcpStore sobre a emulação em memória (sem Redis real): uso único
// atômico, detecção de reuso, expiração, teto de clientes e limite do registro de chamadas.
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRedis } from '../../mcp/memoryRedis';
import { RedisMcpStore, type AuthCodeRecord, type GrantFamily } from '../../mcp/store';
import { CALL_LOG_MAX_ENTRIES, TTL } from '../../mcp/auth/constants';

function createClock(start = Date.now()) {
  let current = start;
  return { now: () => current, advance: (ms: number) => void (current += ms) };
}

const code: AuthCodeRecord = {
  clientId: 'c1',
  redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect',
  codeChallenge: 'x'.repeat(43),
  resource: 'https://api.example.test/mcp',
  scopes: ['designer.read'],
  userId: 'u1',
  brandIds: ['b1'],
  createdAt: 0,
};

const family = (id: string, userId = 'u1'): GrantFamily => ({
  id,
  userId,
  clientId: 'c1',
  clientName: 'ChatGPT',
  scopes: ['designer.read'],
  brandIds: ['b1'],
  resource: 'https://api.example.test/mcp',
  createdAt: 1000 + Number(id.replace(/\D/g, '') || 0),
});

let clock: ReturnType<typeof createClock>;
let redis: MemoryRedis;
let store: RedisMcpStore;

beforeEach(() => {
  clock = createClock();
  redis = new MemoryRedis(clock.now);
  store = new RedisMcpStore(redis, clock.now);
});

describe('códigos de autorização', () => {
  it('consome UMA vez: o segundo consumo vira "reused" apontando a família', async () => {
    await store.saveAuthCode('h1', code);
    const first = await store.consumeAuthCode('h1', 'fam-1');
    expect(first).toEqual({ status: 'ok', record: code });
    const second = await store.consumeAuthCode('h1', 'fam-2');
    expect(second).toEqual({ status: 'reused', familyId: 'fam-1' });
    expect(await store.findConsumedCodeFamily('h1')).toBe('fam-1');
  });

  it('sob concorrência, exatamente um consumo recebe o registro', async () => {
    await store.saveAuthCode('h1', code);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => store.consumeAuthCode('h1', `fam-${i}`)));
    expect(results.filter((r) => r.status === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'reused')).toHaveLength(19);
  });

  it('código inexistente é "missing" e NÃO deixa tombstone de lixo', async () => {
    expect(await store.consumeAuthCode('nao-existe', 'fam-x')).toEqual({ status: 'missing' });
    expect(redis.keys().filter((k) => k.includes('code-used'))).toEqual([]);
  });

  it('código expira em 5 minutos', async () => {
    await store.saveAuthCode('h1', code);
    clock.advance((TTL.authCode + 1) * 1000);
    expect(await store.getAuthCode('h1')).toBeUndefined();
    expect(await store.consumeAuthCode('h1', 'fam-1')).toEqual({ status: 'missing' });
  });
});

describe('refresh tokens', () => {
  it('rotação: o segundo consumo vira "reused" com a família', async () => {
    await store.saveRefreshToken('r1', { familyId: 'fam-1', clientId: 'c1' });
    expect(await store.consumeRefreshToken('r1')).toEqual({ status: 'ok', record: { familyId: 'fam-1', clientId: 'c1' } });
    expect(await store.consumeRefreshToken('r1')).toEqual({ status: 'reused', familyId: 'fam-1' });
  });

  it('desconhecido é "missing"', async () => {
    expect(await store.consumeRefreshToken('nada')).toEqual({ status: 'missing' });
  });
});

describe('pedidos de autorização', () => {
  const pending = {
    clientId: 'c1',
    redirectUri: code.redirectUri,
    codeChallenge: code.codeChallenge,
    resource: code.resource,
    scopes: ['designer.read'] as ['designer.read'],
    createdAt: 0,
  };

  it('uso único, com expiração em 10 minutos', async () => {
    await store.savePendingRequest('p1', pending);
    expect(await store.getPendingRequest('p1')).toEqual(pending);
    expect(await store.consumePendingRequest('p1')).toEqual(pending);
    expect(await store.consumePendingRequest('p1')).toBeUndefined();

    await store.savePendingRequest('p2', pending);
    clock.advance((TTL.authRequest + 1) * 1000);
    expect(await store.getPendingRequest('p2')).toBeUndefined();
  });
});

describe('famílias', () => {
  it('lista por usuário, mais novas primeiro, e some depois de revogada', async () => {
    await store.createFamily(family('f1'));
    await store.createFamily(family('f2'));
    await store.createFamily(family('f3', 'outro'));
    expect((await store.listFamiliesByUser('u1')).map((f) => f.id)).toEqual(['f2', 'f1']);

    await store.revokeFamily('f1');
    expect(await store.getFamily('f1')).toBeUndefined();
    expect((await store.listFamiliesByUser('u1')).map((f) => f.id)).toEqual(['f2']);
  });

  it('família expirada some da lista e limpa o índice', async () => {
    await store.createFamily(family('f1'));
    clock.advance((TTL.refreshToken + 1) * 1000);
    expect(await store.listFamiliesByUser('u1')).toEqual([]);
  });

  it('extendFamily renova o prazo', async () => {
    await store.createFamily(family('f1'));
    clock.advance((TTL.refreshToken - 10) * 1000);
    await store.extendFamily('f1');
    clock.advance(20 * 1000);
    expect(await store.getFamily('f1')).toBeDefined();
  });
});

describe('tokens de acesso', () => {
  it('expiram com o TTL', async () => {
    await store.saveAccessToken('a1', { familyId: 'f1', scopes: ['designer.read'], expiresAt: clock.now() + 1000 });
    expect(await store.getAccessToken('a1')).toBeDefined();
    clock.advance((TTL.accessToken + 1) * 1000);
    expect(await store.getAccessToken('a1')).toBeUndefined();
  });
});

describe('clientes (DCR)', () => {
  const client = (id: string) => ({ client_id: id, redirect_uris: [code.redirectUri] });

  it('respeita o teto e libera vaga quando um cliente expira', async () => {
    expect(await store.saveClient(client('c1'), 2)).toBe('ok');
    expect(await store.saveClient(client('c2'), 2)).toBe('ok');
    expect(await store.saveClient(client('c3'), 2)).toBe('limit');
    clock.advance((TTL.client + 1) * 1000);
    expect(await store.saveClient(client('c3'), 2)).toBe('ok');
  });

  it('touchClient renova a validade', async () => {
    await store.saveClient(client('c1'), 5);
    clock.advance((TTL.client - 10) * 1000);
    await store.touchClient('c1');
    clock.advance(20 * 1000);
    expect(await store.getClient('c1')).toBeDefined();
  });

  it('client_id absurdo não vira chave de Redis', async () => {
    expect(await store.getClient('x'.repeat(500))).toBeUndefined();
    expect(await store.getClient('')).toBeUndefined();
  });
});

describe('registro de chamadas', () => {
  it('guarda o mais novo primeiro e corta em ~500 (LTRIM)', async () => {
    for (let i = 0; i < CALL_LOG_MAX_ENTRIES + 25; i++) {
      await store.appendCall('brand-a', { ts: String(i), userId: 'u', clientId: 'c', tool: 't', ok: true, durationMs: i });
    }
    const all = await store.listCalls('brand-a', 10_000);
    expect(all).toHaveLength(CALL_LOG_MAX_ENTRIES);
    expect(all[0].ts).toBe(String(CALL_LOG_MAX_ENTRIES + 24)); // o mais recente
    expect(all[all.length - 1].ts).toBe('25'); // os 25 mais antigos saíram
  });

  it('listas de marcas diferentes não se misturam', async () => {
    await store.appendCall('brand-a', { ts: '1', userId: 'u', clientId: 'c', tool: 't', ok: true, durationMs: 1 });
    expect(await store.listCalls('brand-b')).toEqual([]);
  });
});

describe('o que vai para o Redis', () => {
  it('toda chave é prefixada com "mcp:"', async () => {
    await store.saveAuthCode('h1', code);
    await store.createFamily(family('f1'));
    await store.saveAccessToken('a1', { familyId: 'f1', scopes: ['designer.read'], expiresAt: 1 });
    await store.appendCall('brand-a', { ts: '1', userId: 'u', clientId: 'c', tool: 't', ok: true, durationMs: 1 });
    expect(redis.keys().every((k) => k.startsWith('mcp:'))).toBe(true);
  });
});
