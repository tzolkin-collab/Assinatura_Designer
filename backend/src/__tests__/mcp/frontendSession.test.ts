// Sessão de navegador somente leitura do agente (escopo designer.preview): start_frontend_session / end_frontend_session,
// troca do código de uso único por token de sessão (cookie auth_token no front) e a trava dentro do requireAuth.
// Um teste (ou mais) por item do "Aceite testável" de docs/po/brief-sessao-de-navegador-mcp.md.
//
// Nada aqui toca infraestrutura real: Redis = MemoryRedis sob o RedisMcpStore verdadeiro, Prisma = mock com banco em memória,
// relógio controlável. As rotas do app (brands, posts...) são as REAIS (`app`), com o Prisma mockado.
import '../client'; // mocka prisma e redis do processo de teste (precisa vir antes do resto)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Response } from 'express';
import { prismaMock } from '../client';
import { app as realApp } from '../../app';
import { requireAuth, type AuthRequest } from '../../middleware/auth';
import { setPreviewAuthenticator } from '../../middleware/previewSession';
import { PREVIEW_CODE_TTL_SEC, PREVIEW_SESSION_TTL_SEC } from '../../mcp/preview';
import { buildHarness, callTool, captureConsole, connect, mcpPost, type Harness } from './harness';

const POST_A = '11111111-1111-4111-8111-111111111111';
const POST_B = '22222222-2222-4222-8222-222222222222';
const SECOND = 1000;
const HOUR = 60 * 60 * SECOND;

let h: Harness;

const toolResult = (res: request.Response) =>
  res.body.result as { isError?: boolean; content: Array<{ type: string; text: string }>; structuredContent?: Record<string, any> };

/** Conexão com leitura + navegador (o usuário marcou o quadro novo na tela de consentimento). */
const connectWithPreview = (opts: { brandSlugs?: string[]; userId?: string } = {}) =>
  connect(h, {
    userId: opts.userId,
    scope: 'designer.read designer.preview',
    scopes: ['designer.read', 'designer.preview'],
    brandSlugs: opts.brandSlugs ?? ['marca-a'],
  });

async function start(accessToken: string) {
  const res = await mcpPost(h.app, accessToken, callTool('start_frontend_session'));
  const r = toolResult(res);
  const url = r.structuredContent?.url as string | undefined;
  const code = url ? new URL(url).hash.replace(/^#code=/, '') : '';
  return { res, r, url, code };
}

const exchange = (code: unknown) => request(h.app).post('/api/mcp/preview/exchange').send({ code });

/** start + troca: devolve o token de sessão (o que o front guarda como cookie auth_token). */
async function openSession(opts: Parameters<typeof connectWithPreview>[0] = {}) {
  const flow = await connectWithPreview(opts);
  const s = await start(flow.accessToken);
  const ex = await exchange(s.code);
  const token = ex.body.data?.token as string;
  return { flow, ...s, ex, token };
}

const asSession = (token: string) => ({ Authorization: `Bearer ${token}` });
const getApi = (token: string, path: string) => request(realApp).get(path).set(asSession(token));

beforeEach(() => {
  h = buildHarness();
  h.addMember('user-1', 'brand-a', 'EDITOR');
  h.addMember('user-1', 'brand-b', 'EDITOR');

  // Dados que as rotas REAIS do app leem.
  const members = [{ userId: 'user-1', role: 'EDITOR', user: { id: 'user-1', name: 'U', email: 'u@example.test' } }];
  const fullBrand = (b: { id: string; slug: string; name: string }) => ({ ...b, config: {}, _count: { posts: 0 }, members });
  prismaMock.brand.findFirst.mockImplementation((async (args: { where: { slug: string } }) => {
    const b = h.db.brands.find((x) => x.slug === args.where.slug);
    return b ? fullBrand(b) : null;
  }) as never);
  prismaMock.brand.findMany = vi.fn(async (args: { where: { id?: { in: string[] } } }) =>
    h.db.brands.filter((b) => !args.where.id?.in || args.where.id.in.includes(b.id)).map(fullBrand),
  ) as never;
  const posts: Record<string, { id: string; brandId: string }> = {
    [POST_A]: { id: POST_A, brandId: 'brand-a' },
    [POST_B]: { id: POST_B, brandId: 'brand-b' },
  };
  prismaMock.post.findUnique.mockImplementation((async (args: { where: { id: string } }) => posts[args.where.id] ?? null) as never);
  prismaMock.post.findFirst.mockImplementation((async (args: { where: { id: string } }) => {
    const p = posts[args.where.id];
    return p ? { ...p, name: 'Deck', type: 'PRESENTATION', content: {}, slides: [], brand: {} } : null;
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('aceite 1: escopo designer.preview, desligado por padrão', () => {
  it('sem o escopo no consentimento, start_frontend_session e end_frontend_session são recusadas com 403 insufficient_scope', async () => {
    const flow = await connect(h, { brandSlugs: ['marca-a'] }); // só leitura
    for (const name of ['start_frontend_session', 'end_frontend_session']) {
      const res = await mcpPost(h.app, flow.accessToken, callTool(name));
      expect(res.status).toBe(403);
      expect(res.headers['www-authenticate']).toContain('error="insufficient_scope"');
      expect(res.headers['www-authenticate']).toContain('scope="designer.preview"');
    }
  });

  it('um cliente que pede todos os escopos (sem scope) e é aprovado SEM lista de escopos não ganha designer.preview', async () => {
    const flow = await connect(h, { clientName: 'Agente', scope: '' });
    expect(flow.token.body.scope).not.toContain('designer.preview');
    const res = await mcpPost(h.app, flow.accessToken, callTool('start_frontend_session'));
    expect(res.status).toBe(403);
  });

  it('a tela de consentimento recebe o escopo na lista oferecida e, marcado, ele vira escopo do token', async () => {
    const flow = await connectWithPreview();
    expect(flow.token.body.scope.split(' ')).toContain('designer.preview');
    const { r } = await start(flow.accessToken);
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ readOnly: true, expiresInSeconds: PREVIEW_SESSION_TTL_SEC, codeValidForSeconds: PREVIEW_CODE_TTL_SEC });
    expect(r.structuredContent!.brands).toEqual([{ slug: 'marca-a', name: 'Marca A' }]);
  });

  it('a URL leva o código no fragmento (#code=), nunca em query string, e aponta para o front', async () => {
    const flow = await connectWithPreview();
    const { url, code } = await start(flow.accessToken);
    const parsed = new URL(url!);
    expect(parsed.origin).toBe('https://app.example.test');
    expect(parsed.pathname).toBe('/mcp/entrar');
    expect(parsed.search).toBe('');
    expect(code.length).toBeGreaterThanOrEqual(32);
  });
});

describe('aceite 2: código de uso único com vida de 60 s', () => {
  it('a primeira troca devolve o token; a segunda falha', async () => {
    const flow = await connectWithPreview();
    const { code } = await start(flow.accessToken);
    const first = await exchange(code);
    expect(first.status).toBe(200);
    expect(first.body.data.token).toMatch(/^mcpv_/);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.body.data.brands).toEqual([{ slug: 'marca-a', name: 'Marca A' }]);

    const second = await exchange(code);
    expect(second.status).toBe(401);
    expect(second.body.error.code).toBe('MCP_PREVIEW_CODE_INVALID');
  });

  it('código com mais de 60 s falha; com 59 s ainda vale', async () => {
    const flow = await connectWithPreview();
    const early = await start(flow.accessToken);
    h.clock.advance(59 * SECOND);
    expect((await exchange(early.code)).status).toBe(200);

    const late = await start(flow.accessToken);
    h.clock.advance(61 * SECOND);
    const res = await exchange(late.code);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MCP_PREVIEW_CODE_INVALID');
  });

  it('em corrida, o mesmo código é trocado UMA vez só', async () => {
    const flow = await connectWithPreview();
    const { code } = await start(flow.accessToken);
    const results = await Promise.all(Array.from({ length: 8 }, () => exchange(code)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(7);
  });

  it('código inventado, malformado ou ausente recebe a MESMA resposta (não revela nada)', async () => {
    const flow = await connectWithPreview();
    await start(flow.accessToken);
    const bodies = [];
    for (const code of ['x'.repeat(43), 'curto', 12345, undefined, null, { $ne: 1 }]) {
      const res = await exchange(code);
      expect(res.status).toBe(401);
      bodies.push(JSON.stringify(res.body));
    }
    expect(new Set(bodies).size).toBe(1);
  });
});

describe('aceite 3: a sessão não escreve', () => {
  it('PUT, POST, PATCH e DELETE no app com o token da sessão recebem 403', async () => {
    const { token } = await openSession();
    const calls: Array<[string, string]> = [
      ['put', `/api/posts/${POST_A}`],
      ['post', '/api/posts'],
      ['patch', `/api/posts/${POST_A}`],
      ['delete', `/api/posts/${POST_A}`],
      ['put', `/api/posts/${POST_A}/slides/0/code`],
      ['post', `/api/posts/${POST_A}/versions`],
      ['post', '/api/brands'],
      ['delete', '/api/brands/marca-a'],
      ['put', '/api/settings/marca-a/config'],
      ['post', '/api/ai/marca-a/extract-from-logo'],
      ['post', '/api/upload/logo'],
    ];
    for (const [method, path] of calls) {
      const res = await (request(realApp) as any)[method](path).set(asSession(token)).send({});
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(403);
      expect(res.body.error.code, `${method.toUpperCase()} ${path}`).toBe('MCP_PREVIEW_READ_ONLY');
    }
    expect(prismaMock.post.update).not.toHaveBeenCalled();
    expect(prismaMock.post.create).not.toHaveBeenCalled();
    expect(prismaMock.brand.create).not.toHaveBeenCalled();
  });

  it('também não exporta, não usa integrações, equipe, cobrança, notificações nem a API de consentimento/conexões', async () => {
    const { token, flow } = await openSession();
    const forbidden = [
      `/api/posts/${POST_A}/export`,
      `/api/posts/${POST_A}/export-file/job1/download`,
      `/api/posts/${POST_A}/cost`,
      '/api/google/files',
      '/api/canva/auth-url',
      '/api/asana/projects',
      '/api/settings/billing',
      '/api/settings/perfil',
      '/api/brands/marca-a/members',
      '/api/brands/marca-a/ai-usage',
      '/api/notifications',
    ];
    for (const path of forbidden) {
      expect((await getApi(token, path)).status, path).toBe(403);
    }
    // /brands/discover cairia na regra de marca por slug ("discover" não é marca da conexão): 404, igualmente fechado.
    expect((await getApi(token, '/api/brands/discover')).status).toBe(404);
    // API do usuário do conector (consentimento e conexões) é do dono, não da sessão do agente.
    expect((await request(h.app).get('/api/mcp/connections').set(asSession(token))).status).toBe(403);
    // Revogar a conexão pela API do usuário com o token da sessão também é recusado: a conexão segue viva.
    const families = await h.store.listFamiliesByUser('user-1');
    const del = await request(h.app).delete(`/api/mcp/connections/${families[0]!.id}`).set(asSession(token));
    expect(del.status).toBe(403);
    expect((await h.store.listFamiliesByUser('user-1')).length).toBe(1);
    expect(flow.accessToken).toBeTruthy();
  });

  it('leitura permitida funciona e a tela se comporta como Leitor (myRole VIEWER)', async () => {
    const { token } = await openSession();
    const brand = await getApi(token, '/api/brands/marca-a');
    expect(brand.status).toBe(200);
    expect(brand.body.data.myRole).toBe('VIEWER');
    const list = await getApi(token, '/api/brands');
    expect(list.status).toBe(200);
    expect(list.body.data.map((b: { slug: string }) => b.slug)).toEqual(['marca-a']);
    expect(list.body.data[0].myRole).toBe('VIEWER');
    const post = await getApi(token, `/api/posts/${POST_A}`);
    expect(post.status).toBe(200);
  });

  it('o token da sessão NÃO herda o papel global do usuário (nem rootSystem/ADMIN)', async () => {
    const { token } = await openSession();
    const req = { headers: { authorization: `Bearer ${token}` }, method: 'GET', originalUrl: '/api/auth/me', url: '/api/auth/me' } as unknown as AuthRequest;
    await new Promise<void>((resolve, reject) => {
      requireAuth(req, {} as Response, (err?: unknown) => (err ? reject(err) : resolve()));
    });
    expect(req.user).toEqual({ userId: 'user-1', role: 'MCP_PREVIEW' });
    expect(req.preview?.brandIds).toEqual(['brand-a']);
  });
});

describe('aceite 4: só as marcas da conexão', () => {
  it('outra marca (mesmo sendo membro) é 404 em marca, listas, pastas, config e posts', async () => {
    const { token } = await openSession(); // conexão só com marca-a; o usuário também é membro da marca-b
    for (const path of [
      '/api/brands/marca-b',
      '/api/brands/marca-b/posts',
      '/api/brands/marca-b/profile',
      '/api/brands/marca-b/assets',
      '/api/settings/marca-b/config',
      '/api/folders/marca-b',
      `/api/posts/${POST_B}`,
      `/api/posts/${POST_B}/versions`,
    ]) {
      const res = await getApi(token, path);
      expect(res.status, path).toBe(404);
    }
    expect((await getApi(token, '/api/brands/marca-a')).status).toBe(200);
    expect((await getApi(token, `/api/posts/${POST_A}`)).status).toBe(200);
  });

  it('a listagem de marcas é filtrada pelas marcas da conexão', async () => {
    const { token } = await openSession();
    await getApi(token, '/api/brands');
    const where = (prismaMock.brand.findMany as any).mock.calls.at(-1)[0].where;
    expect(where.id).toEqual({ in: ['brand-a'] });
  });

  it('perder a marca depois de abrir a sessão derruba o acesso na requisição seguinte', async () => {
    const { token } = await openSession();
    expect((await getApi(token, '/api/brands/marca-a')).status).toBe(200);
    h.removeMember('user-1', 'brand-a');
    expect((await getApi(token, '/api/brands/marca-a')).status).toBe(404);
  });

  it('conexão no modo "todas as marcas" enxerga as marcas de agora (e só as do usuário)', async () => {
    const flow = await connect(h, { scope: 'designer.read designer.preview', scopes: ['designer.read', 'designer.preview'], allBrands: true });
    const { code } = await start(flow.accessToken);
    const token = (await exchange(code)).body.data.token as string;
    expect((await getApi(token, '/api/brands/marca-a')).status).toBe(200);
    expect((await getApi(token, '/api/brands/marca-b')).status).toBe(200);
  });
});

describe('aceite 5: quando o cookie deixa de valer', () => {
  it('depois de 2 h FIXAS (sem renovação por uso)', async () => {
    const { token } = await openSession();
    h.clock.advance(HOUR + 59 * 60 * SECOND);
    expect((await getApi(token, '/api/brands/marca-a')).status).toBe(200); // usar não renova
    h.clock.advance(2 * 60 * SECOND);
    const res = await getApi(token, '/api/brands/marca-a');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MCP_PREVIEW_ENDED');
  });

  it('o expiresAt devolvido pela ferramenta e pela troca é o mesmo e fica 2 h à frente do pedido', async () => {
    const flow = await connectWithPreview();
    const t0 = h.clock.now();
    const { r, code } = await start(flow.accessToken);
    h.clock.advance(40 * SECOND);
    const ex = await exchange(code);
    expect(Date.parse(r.structuredContent!.expiresAt)).toBe(t0 + 2 * HOUR);
    expect(ex.body.data.expiresAt).toBe(r.structuredContent!.expiresAt);
  });

  it('depois de end_frontend_session', async () => {
    const { token, flow } = await openSession();
    expect((await getApi(token, '/api/brands/marca-a')).status).toBe(200);
    const end = toolResult(await mcpPost(h.app, flow.accessToken, callTool('end_frontend_session')));
    expect(end.structuredContent).toEqual({ ended: true });
    const res = await getApi(token, '/api/brands/marca-a');
    expect(res.status).toBe(401);
    // Idempotente: sem sessão aberta, devolve ended=false e não falha.
    const again = toolResult(await mcpPost(h.app, flow.accessToken, callTool('end_frontend_session')));
    expect(again.isError).toBeFalsy();
    expect(again.structuredContent).toEqual({ ended: false });
  });

  it('end_frontend_session também invalida um código ainda não trocado', async () => {
    const flow = await connectWithPreview();
    const { code } = await start(flow.accessToken);
    await mcpPost(h.app, flow.accessToken, callTool('end_frontend_session'));
    expect((await exchange(code)).status).toBe(401);
  });

  it('ao revogar a conexão em /api/mcp/connections, a sessão aberta morre e o rastro registra o motivo', async () => {
    const { token, flow } = await openSession();
    expect((await getApi(token, '/api/brands/marca-a')).status).toBe(200);
    const family = (await h.store.listFamiliesByUser('user-1'))[0]!;
    const del = await request(h.app).delete(`/api/mcp/connections/${family.id}`).set(h.asUser('user-1'));
    expect(del.status).toBe(200);

    expect((await getApi(token, '/api/brands/marca-a')).status).toBe(401);
    // O próprio access token do conector também morreu.
    expect((await mcpPost(h.app, flow.accessToken, callTool('list_brands'))).status).toBe(401);
    const events = await h.store.listCalls('user:user-1');
    expect(events.find((e) => e.tool === 'frontend_session.ended')).toMatchObject({ errorCode: 'revoked', familyId: family.id });
  });

  it('revogar também invalida um código ainda não trocado', async () => {
    const flow = await connectWithPreview();
    const { code } = await start(flow.accessToken);
    const family = (await h.store.listFamiliesByUser('user-1'))[0]!;
    await request(h.app).delete(`/api/mcp/connections/${family.id}`).set(h.asUser('user-1'));
    expect((await exchange(code)).status).toBe(401);
  });

  it('o token da sessão não vale se o módulo estiver desligado (nenhum autenticador registrado)', async () => {
    const { token } = await openSession();
    setPreviewAuthenticator(null);
    expect((await getApi(token, '/api/brands/marca-a')).status).toBe(401);
  });

  it('um token mcpv_ inventado é 401, como qualquer token inválido', async () => {
    await openSession();
    expect((await getApi('mcpv_' + 'a'.repeat(43), '/api/brands/marca-a')).status).toBe(401);
  });
});

describe('aceite 6: nenhum segredo em log, em erro, no Redis em claro nem na URL depois da troca', () => {
  it('token do conector, código e token da sessão não aparecem em log nem em resposta de erro', async () => {
    const lines = captureConsole();
    const flow = await connectWithPreview();
    const { code, url } = await start(flow.accessToken);
    const ex = await exchange(code);
    const token = ex.body.data.token as string;
    // Erros: código reusado, token inválido, escrita recusada, leitura de outra marca.
    const errors = [
      await exchange(code),
      await getApi('mcpv_' + 'b'.repeat(43), '/api/brands/marca-a'),
      await request(realApp).put(`/api/posts/${POST_A}`).set(asSession(token)).send({}),
      await getApi(token, '/api/brands/marca-b'),
    ];
    await mcpPost(h.app, flow.accessToken, callTool('end_frontend_session'));

    const everything = lines.join('\n');
    for (const secret of [code, token, flow.accessToken, flow.refreshToken, url!]) {
      expect(everything).not.toContain(secret);
      for (const res of errors) {
        expect(JSON.stringify(res.body)).not.toContain(secret);
        expect(JSON.stringify(res.headers)).not.toContain(secret);
      }
    }
  });

  it('o Redis só guarda hash: nem o código nem o token da sessão existem em claro', async () => {
    const { code, token } = await openSession();
    const dump = h.redis.dump();
    expect(dump).not.toContain(code);
    expect(dump).not.toContain(token);
    expect(dump).toMatch(/mcp:pvs:[0-9a-f]{64}/);
  });

  it('o rastro (tool calls e eventos da sessão) não carrega segredo', async () => {
    const { code, token } = await openSession();
    const events = JSON.stringify(await h.store.listCalls('user:user-1'));
    expect(events).not.toContain(code);
    expect(events).not.toContain(token);
  });
});

describe('aceite 7: segunda chamada de start_frontend_session na mesma conexão', () => {
  it('ENCERRA a anterior: o token antigo cai, o código antigo não troca, o novo vale', async () => {
    const flow = await connectWithPreview();
    const first = await start(flow.accessToken);
    const token1 = (await exchange(first.code)).body.data.token as string;
    const pending = await start(flow.accessToken); // 2ª chamada: encerra a 1ª sessão
    expect((await getApi(token1, '/api/brands/marca-a')).status).toBe(401);

    const third = await start(flow.accessToken); // 3ª chamada: encerra o código pendente da 2ª
    expect((await exchange(pending.code)).status).toBe(401);
    const token3 = (await exchange(third.code)).body.data.token as string;
    expect((await getApi(token3, '/api/brands/marca-a')).status).toBe(200);
  });

  it('em corrida, só UMA geração fica válida', async () => {
    const flow = await connectWithPreview();
    const starts = await Promise.all([start(flow.accessToken), start(flow.accessToken), start(flow.accessToken)]);
    const exchanged = await Promise.all(starts.map((s) => exchange(s.code)));
    expect(exchanged.filter((e) => e.status === 200)).toHaveLength(1);
  });

  it('conexões diferentes têm sessões independentes (encerrar uma não derruba a outra)', async () => {
    const a = await openSession();
    const b = await openSession();
    await mcpPost(h.app, a.flow.accessToken, callTool('end_frontend_session'));
    expect((await getApi(a.token, '/api/brands/marca-a')).status).toBe(401);
    expect((await getApi(b.token, '/api/brands/marca-a')).status).toBe(200);
  });
});

describe('rastro e limite de taxa', () => {
  it('registra quem pediu, de qual conexão, quando foi usada e quando foi encerrada', async () => {
    const { flow } = await openSession();
    await mcpPost(h.app, flow.accessToken, callTool('end_frontend_session'));
    const family = (await h.store.listFamiliesByUser('user-1'))[0]!;
    const events = await h.store.listCalls('user:user-1');
    const tools = events.map((e) => e.tool);
    expect(tools).toEqual(expect.arrayContaining(['start_frontend_session', 'frontend_session.started', 'frontend_session.used', 'frontend_session.ended', 'end_frontend_session']));
    for (const name of ['frontend_session.started', 'frontend_session.used', 'frontend_session.ended']) {
      expect(events.find((e) => e.tool === name)).toMatchObject({ userId: 'user-1', clientId: flow.clientId, familyId: family.id, ok: true });
    }
    expect(events.find((e) => e.tool === 'frontend_session.ended')!.errorCode).toBe('ended_by_agent');
    const call = events.find((e) => e.tool === 'start_frontend_session')!;
    expect(call).toMatchObject({ userId: 'user-1', clientId: flow.clientId, ok: true });
    expect(Date.parse(call.ts)).not.toBeNaN();
  });

  it('a sessão que vence sozinha é registrada como expired na primeira requisição depois do prazo', async () => {
    const { token } = await openSession();
    h.clock.advance(2 * HOUR + SECOND);
    await getApi(token, '/api/brands/marca-a');
    const ended = (await h.store.listCalls('user:user-1')).find((e) => e.tool === 'frontend_session.ended');
    expect(ended?.errorCode).toBe('expired');
  });

  it('limite de taxa: a 7ª chamada em 10 min na mesma conexão é recusada com rate_limited', async () => {
    const flow = await connectWithPreview();
    const outcomes: boolean[] = [];
    for (let i = 0; i < 7; i++) outcomes.push(Boolean(toolResult(await mcpPost(h.app, flow.accessToken, callTool('start_frontend_session'))).isError));
    expect(outcomes).toEqual([false, false, false, false, false, false, true]);
    const last = toolResult(await mcpPost(h.app, flow.accessToken, callTool('start_frontend_session')));
    expect(last.content[0]!.text).toMatch(/Muitos pedidos/);
  });

  it('sem nenhuma marca disponível, a ferramenta recusa em vez de abrir uma sessão vazia', async () => {
    const flow = await connectWithPreview();
    h.removeMember('user-1', 'brand-a');
    const r = toolResult(await mcpPost(h.app, flow.accessToken, callTool('start_frontend_session')));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/Nenhuma marca/);
  });
});

describe('rota de troca: higiene', () => {
  it('é limitada por IP (429 depois do teto)', async () => {
    // O teto é 30 a cada 10 min por IP; o mock de Redis do processo conta de verdade.
    let last = 200;
    for (let i = 0; i < 35; i++) last = (await exchange('x'.repeat(43))).status;
    expect(last).toBe(429);
  });
});
