// Lote 1A do plano completo: get_brand_profile, list_assets, list_versions, create_version, restore_version, update_slide.
// Passam pelo transporte real (POST /mcp) com o OAuth completo do harness; o banco é em memória.
import '../client'; // mocka prisma e redis do processo de teste (precisa vir antes do resto)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type request from 'supertest';
import { prismaMock } from '../client';
import { buildHarness, callTool, connect, mcpPost, type Harness } from './harness';

// A escrita do slide e as versões têm teste próprio; aqui interessa QUANDO e COM QUE argumentos são acionadas.
vi.mock('../../lib/slideEdit', () => ({
  applySlideCode: vi.fn(async (input: { html: string; css?: string; index: number }) => ({
    slideIndex: input.index,
    slide: { html: input.html, css: input.css },
    slideCount: 5,
  })),
}));
vi.mock('../../lib/postVersions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/postVersions')>();
  return {
    ...actual,
    snapshotPost: vi.fn(async () => ({ id: 'versao-nova' })),
    restorePostVersion: vi.fn(async () => ({ content: { slides: [{}, {}, {}] } })),
  };
});
import { applySlideCode } from '../../lib/slideEdit';
import { restorePostVersion, snapshotPost } from '../../lib/postVersions';

let h: Harness;

const result = (res: request.Response) =>
  res.body.result as {
    isError?: boolean;
    content: Array<{ type: string; text: string }>;
    structuredContent?: Record<string, any>;
  };

const POST = '11111111-1111-4111-8111-111111111111';
const VERSION = '22222222-2222-4222-8222-222222222222';

const asWriter = () => connect(h, { scope: 'designer.write', scopes: ['designer.write'], brandSlugs: ['marca-a'] });
const asEditAll = () => connect(h, { scope: 'designer.edit_all', scopes: ['designer.edit_all'], brandSlugs: ['marca-a'] });
const asReader = () => connect(h, { brandSlugs: ['marca-a'] });

const ownedPost = { id: POST, type: 'PRESENTATION', name: 'Deck', content: { mcp: { userId: 'user-1' } } };
const foreignPost = { id: POST, type: 'PRESENTATION', name: 'Deck', content: {} };

beforeEach(() => {
  h = buildHarness();
  h.addMember('user-1', 'brand-a', 'EDITOR');
  h.addMember('user-1', 'brand-b', 'EDITOR');
  vi.mocked(applySlideCode).mockClear();
  vi.mocked(snapshotPost).mockClear();
  vi.mocked(restorePostVersion).mockClear();
});

describe('get_brand_profile', () => {
  it('devolve a ficha salva e o que falta preencher', async () => {
    prismaMock.brandProfile.findUnique.mockResolvedValue({
      data: { essence: 'Mulher forte, sofisticada.', palette: [{ hex: '#410C1C', role: 'principal' }] },
    } as never);
    const flow = await asReader();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('get_brand_profile', { brandSlug: 'marca-a' })));

    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ slug: 'marca-a', derived: false });
    expect(r.structuredContent!.completeness).toMatchObject({ ready: expect.any(Boolean), percent: expect.any(Number) });
    expect(Array.isArray(r.structuredContent!.completeness.pending)).toBe(true);
    expect(prismaMock.brandProfile.findUnique).toHaveBeenCalledWith({ where: { brandId: 'brand-a' } });
  });

  it('sem ficha salva, deriva dos campos antigos e avisa (nada é gravado)', async () => {
    prismaMock.brandProfile.findUnique.mockResolvedValue(null as never);
    prismaMock.brandConfig.findUnique.mockResolvedValue({ colors: ['#112233'], primaryFonts: ['Inter'], logoUrl: null, guidelines: 'x', agentPrompt: '' } as never);
    const flow = await asReader();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('get_brand_profile', { brandSlug: 'marca-a' })));

    expect(r.structuredContent).toMatchObject({ derived: true });
    expect(r.content[0]!.text).toMatch(/derivada dos campos antigos/);
  });

  it('dado gravado fora do esquema cai na ficha vazia, sem erro', async () => {
    prismaMock.brandProfile.findUnique.mockResolvedValue({ data: { palette: 'isto não é uma lista' } } as never);
    const flow = await asReader();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('get_brand_profile', { brandSlug: 'marca-a' })));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent!.profile).toEqual({});
  });

  it('CROSS-TENANT: marca não aprovada no token é recusada', async () => {
    const flow = await asReader();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('get_brand_profile', { brandSlug: 'marca-b' })));
    expect(r.isError).toBe(true);
    expect(prismaMock.brandProfile.findUnique).not.toHaveBeenCalled();
  });
});

describe('list_assets', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'a1', name: 'foto-palco.jpg', url: 'https://cdn.example.test/foto-palco.jpg', fileType: 'image/jpeg',
    source: 'upload', tags: ['foto'], width: 1200, height: 800, brandId: 'brand-a', ...over,
  });

  beforeEach(() => {
    prismaMock.brand.findUnique.mockResolvedValue({ parentBrandId: null } as never);
  });

  it('lista os arquivos reais com a URL exata e sem imagens geradas por IA', async () => {
    prismaMock.asset.findMany.mockResolvedValue([row()] as never);
    const flow = await asReader();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('list_assets', { brandSlug: 'marca-a' })));

    expect(r.structuredContent).toMatchObject({
      total: 1,
      truncated: false,
      assets: [{ id: 'a1', url: 'https://cdn.example.test/foto-palco.jpg', origin: 'brand', width: 1200 }],
    });
    const where = (prismaMock.asset.findMany.mock.calls[0]![0] as any).where;
    expect(where.NOT).toEqual({ source: 'ai-generated' }); // regra de foto real
    expect(where.fileType).toEqual({ startsWith: 'image/' }); // padrão: só imagens
    expect(where.brandId).toEqual({ in: ['brand-a'] });
  });

  it('aplica os filtros pedidos e aceita fontes quando imagesOnly é false', async () => {
    prismaMock.asset.findMany.mockResolvedValue([] as never);
    const flow = await asReader();
    const r = result(
      await mcpPost(
        h.app,
        flow.accessToken,
        callTool('list_assets', { brandSlug: 'marca-a', imagesOnly: false, tag: 'logo', source: 'branding', query: 'Queens' }),
      ),
    );
    const where = (prismaMock.asset.findMany.mock.calls[0]![0] as any).where;
    expect(where.fileType).toBeUndefined();
    expect(where.tags).toEqual({ has: 'logo' });
    expect(where.source).toBe('branding');
    expect(where.name).toEqual({ contains: 'Queens', mode: 'insensitive' });
    expect(r.content[0]!.text).toMatch(/data-photo-slot/); // sem foto, o agente é orientado a reservar a área
  });

  it('num collab inclui a biblioteca do projeto-base e marca a origem', async () => {
    prismaMock.brand.findUnique.mockResolvedValue({ parentBrandId: 'brand-base' } as never);
    prismaMock.asset.findMany.mockResolvedValue([row(), row({ id: 'a2', brandId: 'brand-base', url: 'https://cdn.example.test/base.png' })] as never);
    const flow = await asReader();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('list_assets', { brandSlug: 'marca-a' })));

    expect((prismaMock.asset.findMany.mock.calls[0]![0] as any).where.brandId).toEqual({ in: ['brand-a', 'brand-base'] });
    expect(r.structuredContent!.assets.map((a: { origin: string }) => a.origin)).toEqual(['brand', 'base']);
  });

  it('avisa quando há mais do que o limite', async () => {
    prismaMock.asset.findMany.mockResolvedValue([row({ id: 'a1' }), row({ id: 'a2' }), row({ id: 'a3' })] as never);
    const flow = await asReader();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('list_assets', { brandSlug: 'marca-a', limit: 2 })));
    expect(r.structuredContent).toMatchObject({ total: 2, truncated: true });
    expect((prismaMock.asset.findMany.mock.calls[0]![0] as any).take).toBe(3); // pede um a mais para saber
  });

  it('recusa limite fora da faixa', async () => {
    const flow = await asReader();
    const res = await mcpPost(h.app, flow.accessToken, callTool('list_assets', { brandSlug: 'marca-a', limit: 500 }));
    expect(result(res).isError).toBe(true);
    expect(prismaMock.asset.findMany).not.toHaveBeenCalled();
  });
});

describe('list_versions', () => {
  it('lista o histórico (leitura basta) e nunca devolve o conteúdo da versão', async () => {
    prismaMock.post.findFirst.mockResolvedValue(foreignPost as never);
    prismaMock.postVersion.findMany.mockResolvedValue([
      { id: VERSION, label: 'Antes da atualização', source: 'AI', slideCount: 5, createdAt: new Date('2026-10-15T12:00:00Z'), createdBy: { name: 'Ana' } },
    ] as never);
    const flow = await asReader();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('list_versions', { brandSlug: 'marca-a', postId: POST })));

    expect(r.structuredContent!.versions).toEqual([
      { versionId: VERSION, label: 'Antes da atualização', source: 'AI', slideCount: 5, createdAt: '2026-10-15T12:00:00.000Z', createdBy: 'Ana' },
    ]);
    const select = (prismaMock.postVersion.findMany.mock.calls[0]![0] as any).select;
    expect(select).not.toHaveProperty('content'); // versão pesa MBs
    expect(prismaMock.post.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: POST, brandId: 'brand-a' } }));
  });

  it('peça de outra marca (ou inexistente) é recusada igual', async () => {
    prismaMock.post.findFirst.mockResolvedValue(null as never);
    const flow = await asReader();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('list_versions', { brandSlug: 'marca-a', postId: POST })));
    expect(r.isError).toBe(true);
    expect(prismaMock.postVersion.findMany).not.toHaveBeenCalled();
  });
});

describe('create_version', () => {
  it('exige escrita: token só de leitura é recusado', async () => {
    const flow = await asReader();
    const res = await mcpPost(h.app, flow.accessToken, callTool('create_version', { brandSlug: 'marca-a', postId: POST }));
    expect(res.status === 403 || result(res)?.isError).toBeTruthy();
    expect(snapshotPost).not.toHaveBeenCalled();
  });

  it('marca o ponto de retorno da peça que o próprio usuário criou', async () => {
    prismaMock.post.findFirst.mockResolvedValue(ownedPost as never);
    const flow = await asWriter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('create_version', { brandSlug: 'marca-a', postId: POST, label: 'antes da capa' })));

    expect(r.structuredContent).toEqual({ postId: POST, created: true, versionId: 'versao-nova' });
    expect(snapshotPost).toHaveBeenCalledWith(POST, { source: 'MANUAL', label: 'antes da capa', userId: 'user-1' });
  });

  it('conteúdo idêntico à última versão: created false, sem erro', async () => {
    prismaMock.post.findFirst.mockResolvedValue(ownedPost as never);
    vi.mocked(snapshotPost).mockResolvedValueOnce(null as never);
    const flow = await asWriter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('create_version', { brandSlug: 'marca-a', postId: POST })));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ created: false, versionId: null });
  });

  it('peça de outra origem só com designer.edit_all', async () => {
    prismaMock.post.findFirst.mockResolvedValue(foreignPost as never);
    const writer = await asWriter();
    const negado = result(await mcpPost(h.app, writer.accessToken, callTool('create_version', { brandSlug: 'marca-a', postId: POST })));
    expect(negado.isError).toBe(true);
    expect(snapshotPost).not.toHaveBeenCalled();

    const all = await asEditAll();
    const ok = result(await mcpPost(h.app, all.accessToken, callTool('create_version', { brandSlug: 'marca-a', postId: POST })));
    expect(ok.isError).toBeFalsy();
    expect(snapshotPost).toHaveBeenCalledTimes(1);
  });
});

describe('restore_version', () => {
  it('restaura a peça do usuário e devolve a contagem de slides', async () => {
    prismaMock.post.findFirst.mockResolvedValue(ownedPost as never);
    const flow = await asWriter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('restore_version', { brandSlug: 'marca-a', postId: POST, versionId: VERSION })));

    expect(r.structuredContent).toMatchObject({ postId: POST, restoredVersionId: VERSION, slideCount: 3 });
    expect(restorePostVersion).toHaveBeenCalledWith(POST, VERSION, 'user-1');
    expect(r.content[0]!.text).toMatch(/estado anterior ficou guardado/);
  });

  it('versão que não é desta peça vira erro de domínio, sem stack', async () => {
    prismaMock.post.findFirst.mockResolvedValue(ownedPost as never);
    vi.mocked(restorePostVersion).mockRejectedValueOnce(Object.assign(new Error('Versão não encontrada para este post.'), { statusCode: 404 }));
    const flow = await asWriter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('restore_version', { brandSlug: 'marca-a', postId: POST, versionId: VERSION })));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/list_versions/);
  });

  it('não restaura peça alheia sem designer.edit_all', async () => {
    prismaMock.post.findFirst.mockResolvedValue(foreignPost as never);
    const flow = await asWriter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('restore_version', { brandSlug: 'marca-a', postId: POST, versionId: VERSION })));
    expect(r.isError).toBe(true);
    expect(restorePostVersion).not.toHaveBeenCalled();
  });

  it('exige id de versão em formato de UUID', async () => {
    const flow = await asWriter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('restore_version', { brandSlug: 'marca-a', postId: POST, versionId: 'qualquer-coisa' })));
    expect(r.isError).toBe(true);
    expect(restorePostVersion).not.toHaveBeenCalled();
  });
});

describe('update_slide', () => {
  const html = '<h1 class="s3-t">Crescer sem direção cansa</h1>';

  it('troca o slide (número a partir de 1) e guarda a versão como AI', async () => {
    prismaMock.post.findFirst.mockResolvedValue(ownedPost as never);
    const flow = await asWriter();
    const r = result(
      await mcpPost(h.app, flow.accessToken, callTool('update_slide', { brandSlug: 'marca-a', postId: POST, slide: 3, html, css: '.s3-t{color:red}' })),
    );

    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ postId: POST, slide: 3, slideCount: 5, textChecked: false });
    expect(r.content[0]!.text).toMatch(/NÃO foi conferido/);
    expect(applySlideCode).toHaveBeenCalledWith(
      expect.objectContaining({ postId: POST, index: 2, html, css: '.s3-t{color:red}', userId: 'user-1', source: 'AI' }),
    );
  });

  it('com approvedText confere o texto e aponta o que faltou', async () => {
    prismaMock.post.findFirst.mockResolvedValue(ownedPost as never);
    const flow = await asWriter();
    const r = result(
      await mcpPost(
        h.app,
        flow.accessToken,
        callTool('update_slide', { brandSlug: 'marca-a', postId: POST, slide: 3, html: '<h1>Crescer</h1>', approvedText: 'Crescer sem direção cansa' }),
      ),
    );
    expect(r.structuredContent).toMatchObject({ textChecked: true, ok: false });
    expect(r.structuredContent!.issues[0]).toMatchObject({ slide: 3 });
    expect(r.content[0]!.text).toMatch(/Corrija e chame update_slide/);
  });

  it('com o texto certo, ok', async () => {
    prismaMock.post.findFirst.mockResolvedValue(ownedPost as never);
    const flow = await asWriter();
    const r = result(
      await mcpPost(h.app, flow.accessToken, callTool('update_slide', { brandSlug: 'marca-a', postId: POST, slide: 3, html, approvedText: 'Crescer sem direção cansa' })),
    );
    expect(r.structuredContent).toMatchObject({ textChecked: true, ok: true, issues: [] });
  });

  it('rejeição de conteúdo (4xx do servidor) vira frase para o agente', async () => {
    prismaMock.post.findFirst.mockResolvedValue(ownedPost as never);
    vi.mocked(applySlideCode).mockRejectedValueOnce(Object.assign(new Error('slide fora do limite'), { statusCode: 400 }));
    const flow = await asWriter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('update_slide', { brandSlug: 'marca-a', postId: POST, slide: 9, html })));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe('slide fora do limite');
  });

  it('erro inesperado não vaza a mensagem interna', async () => {
    prismaMock.post.findFirst.mockResolvedValue(ownedPost as never);
    vi.mocked(applySlideCode).mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
    const flow = await asWriter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('update_slide', { brandSlug: 'marca-a', postId: POST, slide: 1, html })));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
  });

  it('peça alheia só com designer.edit_all; token de leitura nunca', async () => {
    prismaMock.post.findFirst.mockResolvedValue(foreignPost as never);
    const writer = await asWriter();
    expect(result(await mcpPost(h.app, writer.accessToken, callTool('update_slide', { brandSlug: 'marca-a', postId: POST, slide: 1, html }))).isError).toBe(true);
    expect(applySlideCode).not.toHaveBeenCalled();

    const all = await asEditAll();
    expect(result(await mcpPost(h.app, all.accessToken, callTool('update_slide', { brandSlug: 'marca-a', postId: POST, slide: 1, html }))).isError).toBeFalsy();
    expect(applySlideCode).toHaveBeenCalledTimes(1);

    const reader = await asReader();
    const res = await mcpPost(h.app, reader.accessToken, callTool('update_slide', { brandSlug: 'marca-a', postId: POST, slide: 1, html }));
    expect(res.status === 403 || result(res)?.isError).toBeTruthy();
    expect(applySlideCode).toHaveBeenCalledTimes(1);
  });

  it('edit_all não alcança post que não é apresentação nem carrossel', async () => {
    prismaMock.post.findFirst.mockResolvedValue({ ...foreignPost, type: 'SINGLE_IMAGE' } as never);
    const all = await asEditAll();
    const r = result(await mcpPost(h.app, all.accessToken, callTool('update_slide', { brandSlug: 'marca-a', postId: POST, slide: 1, html })));
    expect(r.isError).toBe(true);
    expect(applySlideCode).not.toHaveBeenCalled();
  });
});
