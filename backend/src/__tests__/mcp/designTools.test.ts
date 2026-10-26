// Ferramentas que fazem o AGENTE trabalhar (brief, salvar peça, listar, ler) e a política de clientes.
// Tudo passa pelo transporte real (POST /mcp) com o OAuth completo do harness; só o banco é em memória.
import '../client'; // mocka prisma e redis do processo de teste (precisa vir antes do resto)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type request from 'supertest';
import { prismaMock } from '../client';
import { buildHarness, callTool, connect, mcpPost, type Harness } from './harness';

// syncPostSlides fala com a tabela de slides; aqui interessa o que a ferramenta ENTREGA a ele.
vi.mock('../../lib/postHelper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/postHelper')>();
  return { ...actual, syncPostSlides: vi.fn(async () => undefined) };
});
import { syncPostSlides } from '../../lib/postHelper';

// O histórico de versões tem teste próprio; aqui interessa QUANDO a ferramenta o aciona.
vi.mock('../../lib/postVersions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/postVersions')>();
  return { ...actual, snapshotPost: vi.fn(async () => ({ id: 'versao-1' })) };
});
import { snapshotPost } from '../../lib/postVersions';

let h: Harness;

const result = (res: request.Response) =>
  res.body.result as {
    isError?: boolean;
    content: Array<{ type: string; text: string }>;
    structuredContent?: Record<string, any>;
  };

async function writer(brandSlugs = ['marca-a']) {
  return connect(h, { scope: 'designer.write', scopes: ['designer.write'], brandSlugs });
}

beforeEach(() => {
  h = buildHarness();
  h.addMember('user-1', 'brand-a', 'EDITOR');
  h.addMember('user-1', 'brand-b', 'EDITOR');
  vi.mocked(syncPostSlides).mockClear();
  vi.mocked(snapshotPost).mockClear();
  prismaMock.post.create.mockResolvedValue({} as never);
  prismaMock.post.update.mockResolvedValue({} as never);
});

describe('get_designer_brief', () => {
  it('entrega canvas, contrato do HTML, regras, paleta e logo da marca', async () => {
    const flow = await connect(h);
    const res = await mcpPost(h.app, flow.accessToken, callTool('get_designer_brief', { brandSlug: 'marca-a' }));
    const r = result(res);
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent!;
    expect(s.canvas).toMatchObject({ width: 1920, height: 1080, format: 'presentation', aspectRatio: '16:9' });
    expect(s.htmlContract).toContain('.slide-root');
    expect(s.htmlContract).toMatch(/Proibido: <script>/);
    expect(s.photoSlotRule).toContain('data-photo-slot');
    expect(s.palette).toEqual(['#112233', '#ffffff']);
    expect(s.logoUrl).toBe('https://cdn.example.test/a.svg');
    expect(s.rules).toBeTruthy();
    expect(s.warnings).toEqual([]);
    expect(s.checklist.length).toBeGreaterThan(3);
  });

  it('carrossel respeita a proporção pedida', async () => {
    const flow = await connect(h);
    const res = await mcpPost(
      h.app,
      flow.accessToken,
      callTool('get_designer_brief', { brandSlug: 'marca-a', format: 'carousel', aspectRatio: '9:16' }),
    );
    expect(result(res).structuredContent!.canvas).toMatchObject({ width: 1080, height: 1920, aspectRatio: '9:16' });
  });

  it('marca fora do que foi aprovado é recusada, igual a uma marca que não existe', async () => {
    const flow = await connect(h, { brandSlugs: ['marca-a'] });
    const fora = result(await mcpPost(h.app, flow.accessToken, callTool('get_designer_brief', { brandSlug: 'marca-b' })));
    const nada = result(await mcpPost(h.app, flow.accessToken, callTool('get_designer_brief', { brandSlug: 'nao-existe' })));
    expect(fora.isError).toBe(true);
    expect(fora.content[0]!.text).toBe(nada.content[0]!.text);
  });
});

describe('save_presentation', () => {
  const slide = (text: string, extra = '') => ({
    html: `<div class="s1-root"><h1>${text}</h1>${extra}</div>`,
    css: '.s1-root{padding:80px}',
    approvedText: text,
  });

  it('cria a peça na marca, sanitiza o HTML e devolve o link do editor', async () => {
    const flow = await writer();
    const res = await mcpPost(
      h.app,
      flow.accessToken,
      callTool('save_presentation', {
        brandSlug: 'marca-a',
        name: 'Minha peça',
        slides: [slide('Estratégia para uma vida extraordinária', '<script>alert(1)</script>')],
      }),
    );
    const r = result(res);
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent!;
    expect(s.created).toBe(true);
    expect(s.slideCount).toBe(1);
    expect(s.ok).toBe(true);
    expect(s.editorUrl).toBe(`https://app.example.test/marca-a/editor/${s.postId}`);

    const data = (prismaMock.post.create.mock.calls[0]![0] as any).data;
    expect(data.brandId).toBe('brand-a');
    expect(data.type).toBe('PRESENTATION');
    expect(data.status).toBe('READY');
    expect(data.content.mcp.userId).toBe('user-1');
    expect(data.content.slides).toBeUndefined();

    const synced = vi.mocked(syncPostSlides).mock.calls[0]![1] as { slides: Array<{ html: string }> };
    expect(synced.slides[0]!.html).not.toContain('<script');
    expect(synced.slides[0]!.html).toContain('Estratégia para uma vida extraordinária');
  });

  it('aponta o texto que faltou e o que foi acrescentado, por slide', async () => {
    const flow = await writer();
    const res = await mcpPost(
      h.app,
      flow.accessToken,
      callTool('save_presentation', {
        brandSlug: 'marca-a',
        slides: [
          {
            html: '<h1>Estratégia vida</h1><p>Texto inventado aqui</p>',
            approvedText: 'Estratégia para uma vida extraordinária',
          },
        ],
      }),
    );
    const s = result(res).structuredContent!;
    expect(s.ok).toBe(false);
    expect(s.textChecked).toBe(true);
    const kinds = s.issues.map((i: { description: string }) => i.description).join(' ');
    expect(kinds).toMatch(/não aparece por inteiro/);
    expect(s.issues[0].slide).toBe(1);
    expect(result(res).content[0]!.text).toMatch(/Corrija e chame save_presentation de novo/);
  });

  it('sem texto aprovado avisa que o texto NÃO foi conferido', async () => {
    const flow = await writer();
    const res = await mcpPost(
      h.app,
      flow.accessToken,
      callTool('save_presentation', { brandSlug: 'marca-a', slides: [{ html: '<h1>Qualquer</h1>' }] }),
    );
    const s = result(res).structuredContent!;
    expect(s.textChecked).toBe(false);
    expect(s.warnings.join(' ')).toMatch(/NÃO foi conferido/);
  });

  it('atualiza só a peça que o PRÓPRIO usuário criou por MCP', async () => {
    const flow = await writer();
    const postId = '11111111-1111-4111-8111-111111111111';

    prismaMock.post.findFirst.mockResolvedValueOnce({ id: postId, content: { mcp: { userId: 'outro-usuario' } } } as never);
    const negado = result(
      await mcpPost(h.app, flow.accessToken, callTool('save_presentation', { brandSlug: 'marca-a', postId, slides: [slide('Oi')] })),
    );
    expect(negado.isError).toBe(true);
    expect(prismaMock.post.update).not.toHaveBeenCalled();

    prismaMock.post.findFirst.mockResolvedValueOnce({ id: postId, content: { mcp: { userId: 'user-1' } } } as never);
    const ok = result(
      await mcpPost(h.app, flow.accessToken, callTool('save_presentation', { brandSlug: 'marca-a', postId, slides: [slide('Oi')] })),
    );
    expect(ok.structuredContent!.created).toBe(false);
    expect(ok.structuredContent!.postId).toBe(postId);
    expect(prismaMock.post.update).toHaveBeenCalled();
  });

  it('B3: congela a versão anterior ANTES de sobrescrever a peça', async () => {
    const flow = await writer();
    const postId = '11111111-1111-4111-8111-111111111111';
    prismaMock.post.findFirst.mockResolvedValueOnce({ id: postId, content: { mcp: { userId: 'user-1' } } } as never);

    const r = result(
      await mcpPost(h.app, flow.accessToken, callTool('save_presentation', { brandSlug: 'marca-a', postId, slides: [slide('Oi')] })),
    );

    expect(snapshotPost).toHaveBeenCalledWith(postId, expect.objectContaining({ source: 'AI', userId: 'user-1' }));
    const snapshotOrder = vi.mocked(snapshotPost).mock.invocationCallOrder[0]!;
    const updateOrder = prismaMock.post.update.mock.invocationCallOrder[0]!;
    const syncOrder = vi.mocked(syncPostSlides).mock.invocationCallOrder[0]!;
    expect(snapshotOrder).toBeLessThan(updateOrder);
    expect(snapshotOrder).toBeLessThan(syncOrder);
    expect(r.structuredContent!.versionId).toBe('versao-1');
  });

  it('B3: peça nova não gera versão', async () => {
    const flow = await writer();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('save_presentation', { brandSlug: 'marca-a', slides: [slide('Oi')] })));
    expect(snapshotPost).not.toHaveBeenCalled();
    expect(r.structuredContent!.versionId).toBeNull();
  });

  it('B4: texto divergente grava RASCUNHO, não pronta', async () => {
    const flow = await writer();
    const res = await mcpPost(
      h.app,
      flow.accessToken,
      callTool('save_presentation', {
        brandSlug: 'marca-a',
        slides: [{ html: '<h1>Estratégia vida</h1>', approvedText: 'Estratégia para uma vida extraordinária' }],
      }),
    );
    const s = result(res).structuredContent!;
    expect(s.ok).toBe(false);
    expect(s.status).toBe('DRAFT');
    expect((prismaMock.post.create.mock.calls[0]![0] as any).data.status).toBe('DRAFT');
  });

  it('B4: a atualização limpa volta a pronta', async () => {
    const flow = await writer();
    const postId = '11111111-1111-4111-8111-111111111111';
    prismaMock.post.findFirst.mockResolvedValueOnce({ id: postId, content: { mcp: { userId: 'user-1' } } } as never);
    const r = result(
      await mcpPost(h.app, flow.accessToken, callTool('save_presentation', { brandSlug: 'marca-a', postId, slides: [slide('Oi')] })),
    );
    expect(r.structuredContent!.status).toBe('READY');
    expect((prismaMock.post.update.mock.calls[0]![0] as any).data.status).toBe('READY');
  });

  it('conexão só de leitura não consegue salvar', async () => {
    const flow = await connect(h); // designer.read
    const res = await mcpPost(h.app, flow.accessToken, callTool('save_presentation', { brandSlug: 'marca-a', slides: [slide('Oi')] }));
    // 403 do pré-check HTTP ou isError da ferramenta: nunca grava.
    expect(res.status === 403 || result(res)?.isError === true).toBe(true);
    expect(prismaMock.post.create).not.toHaveBeenCalled();
  });

  it('slide vazio depois da limpeza é recusado', async () => {
    const flow = await writer();
    const res = await mcpPost(
      h.app,
      flow.accessToken,
      callTool('save_presentation', { brandSlug: 'marca-a', slides: [{ html: '<script>x</script>' }] }),
    );
    expect(result(res).isError).toBe(true);
    expect(prismaMock.post.create).not.toHaveBeenCalled();
  });
});

describe('list_designs e get_design', () => {
  it('lista as peças da marca com o link do editor', async () => {
    prismaMock.post.findMany.mockResolvedValue([
      {
        id: 'p-1',
        name: 'Deck A',
        type: 'PRESENTATION',
        status: 'READY',
        updatedAt: new Date('2026-10-15T12:00:00Z'),
        content: { mcp: { userId: 'user-1' } },
        _count: { slides: 5 },
      },
    ] as never);
    const flow = await connect(h);
    const res = await mcpPost(h.app, flow.accessToken, callTool('list_designs', { brandSlug: 'marca-a' }));
    const d = result(res).structuredContent!.designs;
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ postId: 'p-1', slideCount: 5, viaAgent: true });
    expect(d[0].editorUrl).toBe('https://app.example.test/marca-a/editor/p-1');
    const where = (prismaMock.post.findMany.mock.calls[0]![0] as any).where;
    expect(where.brandId).toBe('brand-a');
  });

  it('get_design devolve o texto visível e só entrega HTML com includeSource', async () => {
    prismaMock.post.findFirst.mockResolvedValue({
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Deck A',
      type: 'PRESENTATION',
      status: 'READY',
      content: { width: 1920, height: 1080, fonts: ['Inter'], mcp: { userId: 'user-1' } },
      slides: [{ position: 0, contentJson: { html: '<h1>Olá</h1><style>.a{}</style>', css: '.s1-a{color:red}' } }],
    } as never);
    const flow = await connect(h);
    const args = { brandSlug: 'marca-a', postId: '22222222-2222-4222-8222-222222222222' };

    const leve = result(await mcpPost(h.app, flow.accessToken, callTool('get_design', args))).structuredContent!;
    expect(leve.slides[0].text).toBe('Olá');
    expect(leve.slides[0].html).toBeUndefined();
    expect(leve.editableViaAgent).toBe(true);

    const cheio = result(await mcpPost(h.app, flow.accessToken, callTool('get_design', { ...args, includeSource: true }))).structuredContent!;
    expect(cheio.slides[0].html).toContain('<h1>Olá</h1>');
    expect(cheio.slides[0].css).toContain('.s1-a');
  });

  it('peça de outra marca não aparece', async () => {
    prismaMock.post.findFirst.mockResolvedValue(null);
    const flow = await connect(h);
    const res = await mcpPost(
      h.app,
      flow.accessToken,
      callTool('get_design', { brandSlug: 'marca-a', postId: '33333333-3333-4333-8333-333333333333' }),
    );
    expect(result(res).isError).toBe(true);
    const where = (prismaMock.post.findFirst.mock.calls[0]![0] as any).where;
    expect(where.brandId).toBe('brand-a');
  });
});
