// Transporte MCP (POST /mcp) e autorização por requisição: 401/403 com WWW-Authenticate,
// audiência, expiração, revogação, escopo, isolamento entre marcas (cross-tenant) e queda
// de acesso quando a associação à marca muda DEPOIS da emissão do token.
import '../client'; // mocka prisma e redis do processo de teste (precisa vir antes do resto)
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { sha256Hex } from '../../mcp/auth/crypto';
import { WRITE_SCOPE } from '../../mcp/config';
import { createMcpServer } from '../../mcp/server';
import { getBrandKitTool } from '../../mcp/tools/getBrandKit';
import { listBrandsTool } from '../../mcp/tools/listBrands';
import type { McpToolDefinition } from '../../mcp/tools/types';
import {
  FRONTEND,
  RESOURCE,
  buildHarness,
  callTool,
  connect,
  exchange,
  mcpPost,
  rpc,
  type Harness,
} from './harness';

const METADATA_URL = 'https://api.example.test/.well-known/oauth-protected-resource/mcp';

// Ferramenta de ESCRITA fictícia: ainda não existe nenhuma real nesta etapa, e o
// comportamento de escopo/papel precisa de pelo menos uma para ser provado.
const writeInput = { brandSlug: z.string() };
const writeOutput = { ok: z.boolean() };
const pauseTool: McpToolDefinition<typeof writeInput, typeof writeOutput> = {
  name: 'pause_generation',
  title: 'Pausar geração',
  description: 'Ferramenta de escrita de teste.',
  scope: WRITE_SCOPE,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: writeInput,
  outputSchema: writeOutput,
  brandArg: 'brandSlug',
  async handler() {
    return { text: 'pausado', structured: { ok: true } };
  },
};

let h: Harness;

type HarnessTools = NonNullable<Parameters<typeof buildHarness>[0]>['tools'];

function setup(tools?: HarnessTools) {
  h = buildHarness({ tools });
  h.addMember('user-1', 'brand-a', 'EDITOR');
  h.addMember('user-1', 'brand-b', 'EDITOR');
}

/** O resultado de `tools/call` chega em `body.result` (modo JSON do transporte). */
const result = (res: request.Response) => res.body.result as {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

beforeEach(() => setup());

describe('autenticação (401 com WWW-Authenticate)', () => {
  it('sem token → 401 apontando o protected-resource metadata e o escopo', async () => {
    const res = await mcpPost(h.app, undefined, rpc('tools/list'));
    expect(res.status).toBe(401);
    const header = res.headers['www-authenticate'];
    // Formato EXATO do doc de auth do ChatGPT, e sem `error` (nenhuma credencial foi enviada).
    expect(header).toBe(`Bearer resource_metadata="${METADATA_URL}", scope="designer.read designer.write designer.edit_all designer.export designer.preview"`);
    // O metadata que o header aponta realmente existe e descreve o recurso certo.
    const meta = await request(h.app).get(new URL(METADATA_URL).pathname);
    expect(meta.body.resource).toBe(RESOURCE);
  });

  it('token lixo → 401 invalid_token', async () => {
    const res = await mcpPost(h.app, 'dsg_at_lixo', rpc('tools/list'));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
    expect(res.headers['www-authenticate']).toContain('error="invalid_token"');
  });

  it('esquema que não é Bearer → 401', async () => {
    const res = await request(h.app).post('/mcp').set('Authorization', 'Basic abc').send(rpc('tools/list'));
    expect(res.status).toBe(401);
  });

  it('token EXPIRADO → 401', async () => {
    const flow = await connect(h);
    expect((await mcpPost(h.app, flow.accessToken, rpc('tools/list'))).status).toBe(200);
    h.clock.advance(60 * 60 * 1000 + 1000);
    const res = await mcpPost(h.app, flow.accessToken, rpc('tools/list'));
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('invalid_token');
  });

  it('token com expiresAt vencido é recusado mesmo que o store ainda o devolva (não depende só do TTL do Redis)', async () => {
    // Num store sem TTL nativo (ex.: um Postgres futuro) ou com relógio fora de compasso, a
    // chave sobreviveria; o `expiresAt` gravado no próprio registro é o que vale.
    const flow = await connect(h);
    const families = await h.store.listFamiliesByUser('user-1');
    const stale = 'dsg_at_vencido_vencido_vencido_vencido_vencido_vencido';
    await h.store.saveAccessToken(sha256Hex(stale), {
      familyId: families[0].id,
      scopes: ['designer.read'],
      expiresAt: h.clock.now() - 1000,
    });
    const res = await mcpPost(h.app, stale, rpc('tools/list'));
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('invalid_token');
    expect((await mcpPost(h.app, flow.accessToken, rpc('tools/list'))).status).toBe(200);
  });

  it('token REVOGADO → 401', async () => {
    const flow = await connect(h);
    await request(h.app).post('/revoke').type('form').send({ client_id: flow.clientId, token: flow.accessToken });
    expect((await mcpPost(h.app, flow.accessToken, rpc('tools/list'))).status).toBe(401);
  });

  it('token com AUDIÊNCIA errada → 401 (mesmo existindo e sendo válido no store)', async () => {
    const flow = await connect(h);
    // Forja uma conexão cujo recurso é outro: o servidor não pode aceitá-la como sua.
    const families = await h.store.listFamiliesByUser('user-1');
    await h.store.createFamily({ ...families[0], id: 'fam-audiencia-errada', resource: 'https://outro.example.net/mcp' });
    const forged = 'dsg_at_audienciaerrada_audienciaerrada_audienciaerrada';
    await h.store.saveAccessToken(sha256Hex(forged), {
      familyId: 'fam-audiencia-errada',
      scopes: ['designer.read'],
      expiresAt: h.clock.now() + 3600_000,
    });

    const res = await mcpPost(h.app, forged, rpc('tools/list'));
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('invalid_token');
    // Controle: o token legítimo do mesmo usuário continua passando.
    expect((await mcpPost(h.app, flow.accessToken, rpc('tools/list'))).status).toBe(200);
  });

  it('o token em claro nunca fica em req.auth (só o hash)', async () => {
    const flow = await connect(h);
    const info = await h.store.getAccessToken(sha256Hex(flow.accessToken));
    expect(info).toBeDefined();
    expect(JSON.stringify(info)).not.toContain(flow.accessToken);
  });
});

describe('métodos e corpo', () => {
  it('GET e DELETE em /mcp → 405 (stateless), 401 sem token', async () => {
    const flow = await connect(h);
    const get = await request(h.app).get('/mcp').set('Authorization', `Bearer ${flow.accessToken}`);
    expect(get.status).toBe(405);
    expect(get.headers.allow).toBe('POST');
    const del = await request(h.app).delete('/mcp').set('Authorization', `Bearer ${flow.accessToken}`);
    expect(del.status).toBe(405);
    expect((await request(h.app).get('/mcp')).status).toBe(401);
  });

  it('JSON malformado → 400 parse error (não 500)', async () => {
    const flow = await connect(h);
    const res = await request(h.app)
      .post('/mcp')
      .set('Authorization', `Bearer ${flow.accessToken}`)
      .set('Content-Type', 'application/json')
      .send('{"jsonrpc": "2.0", ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(-32700);
  });

  it('corpo acima de 15 MB → 413 (o teto comporta upload_asset em base64)', async () => {
    const flow = await connect(h);
    const res = await mcpPost(h.app, flow.accessToken, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x', arguments: { blob: 'a'.repeat(16_000_000) } } });
    expect(res.status).toBe(413);
  });

  it('corpo de 2 MB autenticado passa do parser (era 413 com o teto antigo de 1 MB)', async () => {
    const flow = await connect(h);
    const res = await mcpPost(h.app, flow.accessToken, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x', arguments: { blob: 'a'.repeat(2_000_000) } } });
    expect(res.status).not.toBe(413);
  });

  it('o corpo só é lido depois da autenticação (anônimo com corpo gigante NUNCA leva 413)', async () => {
    // Se o parser de JSON rodasse antes do bearer, a resposta seria 413. O servidor
    // responde 401 sem drenar o corpo, e o cliente pode ver isso como 401 ou como reset da
    // conexão (o servidor fechou antes de o corpo terminar) — ambos provam que não parseou.
    const outcome = await mcpPost(h.app, undefined, { blob: 'a'.repeat(16_000_000) }).then(
      (res) => res.status,
      (err: Error) => err.message,
    );
    expect(outcome).not.toBe(413);
    expect([401, 'read ECONNRESET', 'write EPIPE']).toContain(outcome);
  });
});

describe('descoberta (initialize / tools/list)', () => {
  it('initialize responde com a versão do protocolo e as instruções', async () => {
    const flow = await connect(h);
    const res = await mcpPost(
      h.app,
      flow.accessToken,
      rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '1' } }),
    );
    expect(res.status).toBe(200);
    expect(res.body.result.serverInfo.name).toBe('designer-ia');
    expect(res.body.result.capabilities.tools).toBeDefined();
    expect(res.body.result.instructions).toMatch(/list_brands/);
    // Modo stateless: nenhuma sessão é criada.
    expect(res.headers['mcp-session-id']).toBeUndefined();
  });

  it('tools/list: cada ferramenta com as 4 anotações, securitySchemes no topo E em _meta, descrição em pt-BR', async () => {
    const flow = await connect(h);
    const res = await mcpPost(h.app, flow.accessToken, rpc('tools/list'));
    expect(res.status).toBe(200);
    const tools = res.body.result.tools as Array<Record<string, any>>;
    expect(tools.map((t) => t.name).sort()).toEqual([
      'create_version',
      'end_frontend_session',
      'export_file',
      'export_to_canva',
      'get_brand_kit',
      'get_brand_profile',
      'get_canva_export_status',
      'get_design',
      'get_designer_brief',
      'get_export_status',
      'get_integrations_status',
      'get_photo_slots',
      'list_assets',
      'list_brands',
      'list_designs',
      'list_versions',
      'restore_version',
      'save_presentation',
      'set_slide_photo',
      'start_frontend_session',
      'update_slide',
      'upload_asset',
    ]);

    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z]+(_[a-z]+)*$/); // snake_case em inglês
      expect(tool.title).toBeTruthy();
      expect(tool.description).toMatch(/[a-zçãé]/i);
      // Ferramentas de escrita e de saída; as demais são leitura pura. Cada uma declara as 4 dicas ao cliente.
      const writeHints: Record<string, { destructiveHint: boolean; idempotentHint: boolean; openWorldHint?: boolean }> = {
        save_presentation: { destructiveHint: false, idempotentHint: false },
        update_slide: { destructiveHint: false, idempotentHint: true },
        create_version: { destructiveHint: false, idempotentHint: true },
        restore_version: { destructiveHint: true, idempotentHint: false },
        set_slide_photo: { destructiveHint: false, idempotentHint: true },
        upload_asset: { destructiveHint: false, idempotentHint: false },
        // Saída do Designer: openWorldHint verdadeiro (o arquivo vira um link, o Canva recebe um design).
        export_file: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
        export_to_canva: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
        // Sessão de navegador somente leitura (designer.preview): muda estado do servidor, mas não escreve em peça nenhuma.
        start_frontend_session: { destructiveHint: false, idempotentHint: false },
        end_frontend_session: { destructiveHint: false, idempotentHint: true },
      };
      const exportReads = ['get_export_status', 'get_canva_export_status'];
      const isExport = tool.name.includes('export');
      const writes = tool.name in writeHints;
      expect(tool.annotations).toEqual({
        readOnlyHint: !writes,
        destructiveHint: writes ? writeHints[tool.name]!.destructiveHint : false,
        idempotentHint: writes ? writeHints[tool.name]!.idempotentHint : true,
        openWorldHint: isExport,
      });
      expect(exportReads.every((n) => !(n in writeHints))).toBe(true);
      // Doc do Apps SDK: securitySchemes no descritor + espelho em _meta.
      const isPreview = tool.name.endsWith('_frontend_session');
      const scopes = [isPreview ? 'designer.preview' : isExport ? 'designer.export' : writes ? 'designer.write' : 'designer.read'];
      expect(tool.securitySchemes).toEqual([{ type: 'oauth2', scopes }]);
      expect(tool._meta.securitySchemes).toEqual([{ type: 'oauth2', scopes }]);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.outputSchema.type).toBe('object');
    }
    const kit = tools.find((t) => t.name === 'get_brand_kit')!;
    expect(kit.inputSchema.required).toEqual(['brandSlug']);
  });
});

describe('list_brands e get_brand_kit', () => {
  it('list_brands devolve só as marcas APROVADAS no token (interseção com a associação)', async () => {
    const flow = await connect(h, { brandSlugs: ['marca-a'] }); // user-1 é membro de A e B
    const res = await mcpPost(h.app, flow.accessToken, callTool('list_brands'));
    expect(res.status).toBe(200);
    expect(result(res).isError).toBeUndefined();
    expect(result(res).structuredContent).toEqual({ brands: [{ slug: 'marca-a', name: 'Marca A', role: 'EDITOR' }] });
    expect(result(res).content[0].text).toContain('marca-a');
    expect(result(res).content[0].text).not.toContain('marca-b');
  });

  it('get_brand_kit devolve cores, fontes, logo e diretrizes — sem o prompt interno', async () => {
    const flow = await connect(h, { brandSlugs: ['marca-a'] });
    const res = await mcpPost(h.app, flow.accessToken, callTool('get_brand_kit', { brandSlug: 'marca-a' }));
    expect(res.status).toBe(200);
    const body = result(res);
    expect(body.isError).toBeUndefined();
    expect(body.structuredContent).toMatchObject({
      slug: 'marca-a',
      name: 'Marca A',
      role: 'EDITOR',
      colors: ['#112233', '#ffffff'],
      fonts: ['Inter', 'Lora'],
      logoUrl: 'https://cdn.example.test/a.svg',
      guidelines: 'Tom direto e acolhedor.',
      guidelinesTruncated: false,
      visual: { vibe: 'minimalista', boldness: 'balanced', allowSvgLayouts: false },
    });
    expect(JSON.stringify(res.body)).not.toContain('SEGREDO-INTERNO-DO-PROMPT');
  });

  it('corta diretrizes longas e avisa que cortou', async () => {
    const flow = await connect(h, { brandSlugs: ['marca-a'] });
    h.db.brands[0].config!.guidelines = 'x'.repeat(6000);
    const res = await mcpPost(h.app, flow.accessToken, callTool('get_brand_kit', { brandSlug: 'marca-a' }));
    const sc = result(res).structuredContent as { guidelines: string; guidelinesTruncated: boolean };
    expect(sc.guidelines).toHaveLength(4000);
    expect(sc.guidelinesTruncated).toBe(true);
  });

  it('CROSS-TENANT: token da marca A NÃO lê a marca B (mesmo o usuário sendo membro das duas)', async () => {
    const flow = await connect(h, { brandSlugs: ['marca-a'] });
    const res = await mcpPost(h.app, flow.accessToken, callTool('get_brand_kit', { brandSlug: 'marca-b' }));
    expect(res.status).toBe(200); // erro de ferramenta, não de transporte
    expect(result(res).isError).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('CONFIDENCIAL-DA-MARCA-B');
    expect(result(res).structuredContent).toBeUndefined();
  });

  it('marca inexistente e marca fora do escopo respondem IGUAL (não confirma existência)', async () => {
    const flow = await connect(h, { brandSlugs: ['marca-a'] });
    const fora = await mcpPost(h.app, flow.accessToken, callTool('get_brand_kit', { brandSlug: 'marca-b' }));
    const naoExiste = await mcpPost(h.app, flow.accessToken, callTool('get_brand_kit', { brandSlug: 'nao-existe' }));
    expect(result(fora).content[0].text).toBe(result(naoExiste).content[0].text);
  });

  it('marca da qual o usuário nunca foi membro, mesmo com slug certo → recusada', async () => {
    const flow = await connect(h, { userId: 'user-1', brandSlugs: ['marca-a'] });
    h.addMember('user-2', 'brand-b', 'OWNER'); // outro usuário tem a B; o token é do user-1
    const res = await mcpPost(h.app, flow.accessToken, callTool('get_brand_kit', { brandSlug: 'marca-b' }));
    expect(result(res).isError).toBe(true);
  });

  it('usuário REMOVIDO da marca depois da emissão perde o acesso na chamada seguinte', async () => {
    const flow = await connect(h, { brandSlugs: ['marca-a', 'marca-b'] });
    const antes = await mcpPost(h.app, flow.accessToken, callTool('get_brand_kit', { brandSlug: 'marca-b' }));
    expect(result(antes).isError).toBeUndefined();

    h.removeMember('user-1', 'brand-b'); // o token ainda não expirou e não foi revogado

    const depois = await mcpPost(h.app, flow.accessToken, callTool('get_brand_kit', { brandSlug: 'marca-b' }));
    expect(result(depois).isError).toBe(true);
    expect(JSON.stringify(depois.body)).not.toContain('CONFIDENCIAL-DA-MARCA-B');
    const lista = await mcpPost(h.app, flow.accessToken, callTool('list_brands'));
    expect((result(lista).structuredContent as { brands: Array<{ slug: string }> }).brands.map((b) => b.slug)).toEqual(['marca-a']);
  });

  it('removido de TODAS as marcas: list_brands volta vazio, sem erro', async () => {
    const flow = await connect(h, { brandSlugs: ['marca-a'] });
    h.removeMember('user-1', 'brand-a');
    const res = await mcpPost(h.app, flow.accessToken, callTool('list_brands'));
    expect(result(res).structuredContent).toEqual({ brands: [] });
  });

  it('argumento inválido → erro de validação, sem executar a ferramenta', async () => {
    const flow = await connect(h);
    const res = await mcpPost(h.app, flow.accessToken, callTool('get_brand_kit', { brandSlug: 123 }));
    expect(res.status).toBe(200);
    const body = res.body.error ?? result(res);
    expect(JSON.stringify(body)).toMatch(/brandSlug|Invalid|inv/i);
    expect(result(res)?.structuredContent).toBeUndefined();
  });

  it('ferramenta inexistente → erro (não 500)', async () => {
    const flow = await connect(h);
    const res = await mcpPost(h.app, flow.accessToken, callTool('apagar_tudo'));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toMatch(/not found|isError|error/i);
  });
});

describe('escopo por ferramenta (tools com escrita)', () => {
  beforeEach(() => setup([listBrandsTool, getBrandKitTool, pauseTool]));

  it('token só de leitura chamando ferramenta de escrita → 403 insufficient_scope no nível HTTP', async () => {
    const flow = await connect(h); // designer.read
    const res = await mcpPost(h.app, flow.accessToken, callTool('pause_generation', { brandSlug: 'marca-a' }));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_scope');
    const header = res.headers['www-authenticate'];
    expect(header).toContain('error="insufficient_scope"');
    expect(header).toContain('scope="designer.write"');
    expect(header).toContain(`resource_metadata="${METADATA_URL}"`);
  });

  it('a recusa vale também dentro de um lote JSON-RPC', async () => {
    const flow = await connect(h);
    const res = await mcpPost(h.app, flow.accessToken, [callTool('list_brands'), callTool('pause_generation', { brandSlug: 'marca-a' })]);
    expect(res.status).toBe(403);
  });

  it('o mesmo token continua lendo normalmente', async () => {
    const flow = await connect(h);
    expect(result(await mcpPost(h.app, flow.accessToken, callTool('list_brands'))).isError).toBeUndefined();
  });

  it('token com escrita executa a ferramenta de escrita', async () => {
    const flow = await connect(h, { scope: 'designer.write' });
    const res = await mcpPost(h.app, flow.accessToken, callTool('pause_generation', { brandSlug: 'marca-a' }));
    expect(res.status).toBe(200);
    expect(result(res).structuredContent).toEqual({ ok: true });
  });

  it('usuário REBAIXADO de EDITOR para VIEWER perde a escrita na chamada seguinte (mesmo com token write)', async () => {
    const flow = await connect(h, { scope: 'designer.write' });
    expect(result(await mcpPost(h.app, flow.accessToken, callTool('pause_generation', { brandSlug: 'marca-a' }))).isError).toBeUndefined();

    h.setRole('user-1', 'brand-a', 'VIEWER');

    const escrita = await mcpPost(h.app, flow.accessToken, callTool('pause_generation', { brandSlug: 'marca-a' }));
    expect(result(escrita).isError).toBe(true);
    // ...mas a leitura continua: o papel VIEWER ainda enxerga a marca.
    const leitura = await mcpPost(h.app, flow.accessToken, callTool('get_brand_kit', { brandSlug: 'marca-a' }));
    expect(result(leitura).isError).toBeUndefined();
  });

  it('rede de segurança do registro: sem o pré-check HTTP, a ferramenta ainda recusa escopo insuficiente', async () => {
    // Fala direto com o servidor MCP (transporte em memória), entregando authInfo só de
    // leitura — o caminho que um lote ou um bug no pré-check deixaria passar.
    const server = createMcpServer({ callLog: h.store, resourceMetadataUrl: METADATA_URL, tools: [pauseTool] });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const responses: Array<Record<string, any>> = [];
    clientT.onmessage = (m) => void responses.push(m as Record<string, any>);
    await clientT.start();
    const authInfo = {
      token: 'x',
      clientId: 'c',
      scopes: ['designer.read'],
      expiresAt: Math.floor(Date.now() / 1000) + 600,
      extra: { userId: 'user-1', familyId: 'f', brandIds: ['brand-a'] },
    };
    await clientT.send(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pause_generation', arguments: { brandSlug: 'marca-a' } } },
      { authInfo } as never,
    );
    await new Promise((r) => setTimeout(r, 50));
    const res = responses.find((r) => r.id === 1)!;
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toMatch(/designer\.write/);
    // O desafio que o ChatGPT usa para reabrir o OAuth com o escopo certo:
    expect(res.result._meta['mcp/www_authenticate'][0]).toContain('error="insufficient_scope"');
    expect(res.result._meta['mcp/www_authenticate'][0]).toContain('scope="designer.write"');
    expect(res.result.structuredContent).toBeUndefined();
  });

  it('sem authInfo (não autenticado) a ferramenta falha FECHADA', async () => {
    const server = createMcpServer({ callLog: h.store, resourceMetadataUrl: METADATA_URL, tools: [listBrandsTool] });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const responses: Array<Record<string, any>> = [];
    clientT.onmessage = (m) => void responses.push(m as Record<string, any>);
    await clientT.start();
    await clientT.send({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'list_brands', arguments: {} } });
    await new Promise((r) => setTimeout(r, 50));
    const res = responses.find((r) => r.id === 9)!;
    expect(res.result.isError).toBe(true);
    expect(res.result.structuredContent).toBeUndefined();
  });
});

describe('registro de chamadas', () => {
  it('cada tools/call grava um evento enxuto na lista da marca — sem argumentos nem conteúdo', async () => {
    const flow = await connect(h, { brandSlugs: ['marca-a'] });
    await mcpPost(h.app, flow.accessToken, callTool('get_brand_kit', { brandSlug: 'marca-a' }));
    await new Promise((r) => setTimeout(r, 20)); // o registro é fire-and-forget

    const events = await h.store.listCalls('brand-a');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: 'user-1', clientId: flow.clientId, tool: 'get_brand_kit', brandSlug: 'marca-a', ok: true });
    expect(typeof events[0].durationMs).toBe('number');
    expect(new Date(events[0].ts).toString()).not.toBe('Invalid Date');
    expect(Object.keys(events[0]).sort()).toEqual(['brandSlug', 'clientId', 'durationMs', 'ok', 'tool', 'ts', 'userId']);
    expect(JSON.stringify(events[0])).not.toContain('Tom direto');
  });

  it('recusa por marca fora do escopo é registrada como erro, na lista do USUÁRIO (não da marca alheia)', async () => {
    const flow = await connect(h, { brandSlugs: ['marca-a'] });
    await mcpPost(h.app, flow.accessToken, callTool('get_brand_kit', { brandSlug: 'marca-b' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(await h.store.listCalls('brand-b')).toEqual([]);
    const events = await h.store.listCalls('user:user-1');
    expect(events[0]).toMatchObject({ tool: 'get_brand_kit', ok: false, errorCode: 'brand_unavailable' });
  });

  it('list_brands (sem marca) grava na lista do usuário', async () => {
    const flow = await connect(h);
    await mcpPost(h.app, flow.accessToken, callTool('list_brands'));
    await new Promise((r) => setTimeout(r, 20));
    expect((await h.store.listCalls('user:user-1'))[0]).toMatchObject({ tool: 'list_brands', ok: true });
  });

  it('falha do Redis no registro NÃO derruba a chamada', async () => {
    const flow = await connect(h);
    h.store.appendCall = async () => {
      throw new Error('redis fora');
    };
    const res = await mcpPost(h.app, flow.accessToken, callTool('list_brands'));
    expect(res.status).toBe(200);
    expect(result(res).isError).toBeUndefined();
  });
});

describe('Origin (anti DNS-rebinding)', () => {
  it('sem Origin (ChatGPT, servidor a servidor) passa', async () => {
    const flow = await connect(h);
    expect((await mcpPost(h.app, flow.accessToken, rpc('tools/list'))).status).toBe(200);
  });

  it('Origin desconhecido → 403, antes de qualquer autenticação', async () => {
    const flow = await connect(h);
    const comToken = await mcpPost(h.app, flow.accessToken, rpc('tools/list'), { Origin: 'https://evil.example.net' });
    expect(comToken.status).toBe(403);
    expect(comToken.body.error).toBe('forbidden_origin');
    const semToken = await mcpPost(h.app, undefined, rpc('tools/list'), { Origin: 'https://evil.example.net' });
    expect(semToken.status).toBe(403);
    expect(semToken.headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each(['null', 'http://localhost:3000', 'https://api.example.test.evil.net', 'https://app.example.test:8443'])(
    'Origin %j → 403',
    async (origin) => {
      const flow = await connect(h);
      expect((await mcpPost(h.app, flow.accessToken, rpc('tools/list'), { Origin: origin })).status).toBe(403);
    },
  );

  it('Origin da allowlist (frontend) passa, com CORS', async () => {
    const flow = await connect(h);
    const res = await mcpPost(h.app, flow.accessToken, rpc('tools/list'), { Origin: FRONTEND });
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(FRONTEND);
    expect(res.headers['access-control-expose-headers']).toMatch(/WWW-Authenticate/i);
  });

  it('loopback só passa com MCP_ALLOW_LOCALHOST_REDIRECT=true', async () => {
    const dev = buildHarness({ env: { MCP_ALLOW_LOCALHOST_REDIRECT: 'true' } });
    dev.addMember('user-1', 'brand-a', 'EDITOR');
    const flow = await connect(dev);
    expect((await mcpPost(dev.app, flow.accessToken, rpc('tools/list'), { Origin: 'http://localhost:6274' })).status).toBe(200);
    expect((await mcpPost(dev.app, flow.accessToken, rpc('tools/list'), { Origin: 'http://evil.example.net' })).status).toBe(403);
  });

  it('preflight de uma origem permitida é respondido com os headers certos', async () => {
    const res = await request(h.app)
      .options('/mcp')
      .set('Origin', FRONTEND)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(FRONTEND);
    expect(res.headers['access-control-allow-headers']).toMatch(/authorization/i);
  });
});

describe('refresh pelo /token continua valendo para o /mcp', () => {
  it('o access token novo emitido pela rotação funciona', async () => {
    const flow = await connect(h);
    const r = await exchange(h.app, { grant_type: 'refresh_token', client_id: flow.clientId, refresh_token: flow.refreshToken });
    expect((await mcpPost(h.app, r.body.access_token, rpc('tools/list'))).status).toBe(200);
  });
});
