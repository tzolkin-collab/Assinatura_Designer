// Acesso total opcional: modo "todas as minhas marcas" e o escopo designer.edit_all.
// Mesmo harness do restante: OAuth completo, transporte real, banco em memória.
import '../client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type request from 'supertest';
import { prismaMock } from '../client';
import { buildHarness, callTool, connect, mcpPost, type Harness } from './harness';

vi.mock('../../lib/postHelper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/postHelper')>();
  return { ...actual, syncPostSlides: vi.fn(async () => undefined) };
});
vi.mock('../../lib/postVersions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/postVersions')>();
  return { ...actual, snapshotPost: vi.fn(async () => ({ id: 'versao-1' })) };
});
import { snapshotPost } from '../../lib/postVersions';

let h: Harness;
const POST = '11111111-1111-4111-8111-111111111111';
const slide = (text: string) => ({ html: `<h1>${text}</h1>`, approvedText: text });

const result = (res: request.Response) =>
  res.body.result as { isError?: boolean; content: Array<{ text: string }>; structuredContent?: Record<string, any> };

const save = (token: string, args: Record<string, unknown>) =>
  mcpPost(h.app, token, callTool('save_presentation', { slides: [slide('Oi')], ...args }));

/** Peça de OUTRA pessoa (sem content.mcp do usuário). */
const othersPost = (type = 'PRESENTATION') => ({ id: POST, type, content: { kind: 'html-design' } }) as never;

const writeOnly = { scope: 'designer.write', scopes: ['designer.write'] };

beforeEach(() => {
  h = buildHarness();
  h.addMember('user-1', 'brand-a', 'EDITOR');
  vi.mocked(snapshotPost).mockClear();
  // Um mockResolvedValueOnce que o teste anterior não consumiu (recusa antes do banco) não pode vazar.
  prismaMock.post.findFirst.mockReset();
  prismaMock.post.create.mockResolvedValue({} as never);
  prismaMock.post.update.mockResolvedValue({} as never);
});

describe('modo "todas as minhas marcas"', () => {
  it('inclui marca em que o usuário entra depois e exclui a que ele perde, sem reconectar', async () => {
    const flow = await connect(h, { allBrands: true });
    const list = async () =>
      (result(await mcpPost(h.app, flow.accessToken, callTool('list_brands'))).structuredContent!.brands as Array<{ slug: string }>)
        .map((b) => b.slug)
        .sort();

    expect(await list()).toEqual(['marca-a']);
    h.addMember('user-1', 'brand-b', 'VIEWER');
    expect(await list()).toEqual(['marca-a', 'marca-b']);
    h.removeMember('user-1', 'brand-a');
    expect(await list()).toEqual(['marca-b']);
  });

  it('guarda o MODO no token, não a lista de marcas', async () => {
    await connect(h, { allBrands: true });
    const [fam] = await h.store.listFamiliesByUser('user-1');
    expect(fam).toMatchObject({ brandMode: 'all', brandIds: [] });
  });

  it('token de marcas escolhidas nunca enxerga outra marca, mesmo sendo membro dela', async () => {
    h.addMember('user-1', 'brand-b', 'EDITOR');
    const flow = await connect(h, { brandSlugs: ['marca-a'] });
    const brands = result(await mcpPost(h.app, flow.accessToken, callTool('list_brands'))).structuredContent!.brands as Array<{
      slug: string;
    }>;
    expect(brands.map((b) => b.slug)).toEqual(['marca-a']);
    const kit = result(await mcpPost(h.app, flow.accessToken, callTool('get_brand_kit', { brandSlug: 'marca-b' })));
    expect(kit.isError).toBe(true);
  });

  it('o papel de agora continua sendo o teto: marca rebaixada para VIEWER deixa de aceitar escrita', async () => {
    const flow = await connect(h, { allBrands: true, ...writeOnly });
    h.setRole('user-1', 'brand-a', 'VIEWER');
    const r = result(await save(flow.accessToken, { brandSlug: 'marca-a' }));
    expect(r.isError).toBe(true);
    expect(prismaMock.post.create).not.toHaveBeenCalled();
  });

  it('"todas" sem nenhum papel que sirva para o escopo é recusado', async () => {
    h.removeMember('user-1', 'brand-a');
    h.addMember('user-1', 'brand-b', 'VIEWER');
    const flow = await connectRaw({ allBrands: true, ...writeOnly });
    expect(flow.status).toBe(403);
  });
});

// `connect` do harness exige sucesso; aqui precisamos ver o status do consentimento.
async function connectRaw(opts: { allBrands: boolean; scope: string; scopes: string[] }) {
  const { registerClient, authorize, authorizeQuery, pkcePair, requestIdFromLocation, decide } = await import('./harness');
  const reg = await registerClient(h.app, {});
  const { challenge } = pkcePair();
  const auth = await authorize(h.app, authorizeQuery(reg.body.client_id as string, challenge, { scope: opts.scope }));
  const requestId = requestIdFromLocation(auth.headers.location);
  return decide(h, requestId, 'user-1', { decision: 'approve', allBrands: true, scopes: opts.scopes });
}

describe('designer.edit_all', () => {
  const editAll = (extra: Record<string, unknown> = {}) =>
    connect(h, { scope: 'designer.edit_all', scopes: ['designer.edit_all'], ...extra });

  it('sem edit_all, peça de outra pessoa continua intocável', async () => {
    const flow = await connect(h, writeOnly);
    prismaMock.post.findFirst.mockResolvedValueOnce(othersPost());
    const r = result(await save(flow.accessToken, { brandSlug: 'marca-a', postId: POST }));
    expect(r.isError).toBe(true);
    expect(prismaMock.post.update).not.toHaveBeenCalled();
    expect(snapshotPost).not.toHaveBeenCalled();
  });

  it('com edit_all atualiza peça de outra pessoa e congela a versão antes de sobrescrever', async () => {
    const flow = await editAll();
    prismaMock.post.findFirst.mockResolvedValueOnce(othersPost());
    const r = result(await save(flow.accessToken, { brandSlug: 'marca-a', postId: POST }));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent!.created).toBe(false);
    expect(r.structuredContent!.versionId).toBe('versao-1');
    expect(snapshotPost).toHaveBeenCalledWith(POST, expect.objectContaining({ source: 'AI', userId: 'user-1' }));
    const snapOrder = vi.mocked(snapshotPost).mock.invocationCallOrder[0]!;
    const updOrder = prismaMock.post.update.mock.invocationCallOrder[0]!;
    expect(snapOrder).toBeLessThan(updOrder);
  });

  it('a peça é buscada só na marca autorizada: marca fora do token nem chega ao banco', async () => {
    h.addMember('user-1', 'brand-b', 'EDITOR');
    const flow = await editAll({ brandSlugs: ['marca-a'] });
    const r = result(await save(flow.accessToken, { brandSlug: 'marca-b', postId: POST }));
    expect(r.isError).toBe(true);
    expect(prismaMock.post.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.post.update).not.toHaveBeenCalled();
  });

  it('não reescreve o que não é apresentação nem carrossel', async () => {
    const flow = await editAll();
    prismaMock.post.findFirst.mockResolvedValueOnce(othersPost('SINGLE_POST'));
    const r = result(await save(flow.accessToken, { brandSlug: 'marca-a', postId: POST }));
    expect(r.isError).toBe(true);
    expect(prismaMock.post.update).not.toHaveBeenCalled();
  });

  it('rebaixado para VIEWER depois de conectar perde a edição na chamada seguinte', async () => {
    const flow = await editAll();
    h.setRole('user-1', 'brand-a', 'VIEWER');
    prismaMock.post.findFirst.mockResolvedValueOnce(othersPost());
    const r = result(await save(flow.accessToken, { brandSlug: 'marca-a', postId: POST }));
    expect(r.isError).toBe(true);
    expect(prismaMock.post.update).not.toHaveBeenCalled();
  });

  it('get_design.editableViaAgent reflete o escopo e o papel', async () => {
    const design = {
      id: POST,
      name: 'Deck',
      type: 'PRESENTATION',
      status: 'READY',
      content: { width: 1920, height: 1080, fonts: [] },
      slides: [],
    } as never;
    const args = { brandSlug: 'marca-a', postId: POST };
    const editable = async (token: string) => {
      prismaMock.post.findFirst.mockResolvedValueOnce(design);
      return result(await mcpPost(h.app, token, callTool('get_design', args))).structuredContent!.editableViaAgent;
    };

    const plain = await connect(h, writeOnly);
    expect(await editable(plain.accessToken)).toBe(false);

    const all = await editAll();
    expect(await editable(all.accessToken)).toBe(true);

    h.setRole('user-1', 'brand-a', 'VIEWER');
    expect(await editable(all.accessToken)).toBe(false);
  });

  it('edit_all implica escrita e leitura no token', async () => {
    const flow = await editAll();
    expect(String(flow.token.body.scope).split(' ').sort()).toEqual(['designer.edit_all', 'designer.read', 'designer.write']);
  });
});
