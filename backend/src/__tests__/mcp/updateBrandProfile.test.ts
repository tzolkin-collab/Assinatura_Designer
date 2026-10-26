// update_brand_profile: escopo próprio (designer.brand), mescla por campo, restauração pelo `previous` e as
// mesmas travas da rota PUT (arquivos da biblioteca da marca, medição dos logos pelo servidor).
import '../client'; // mocka prisma e redis do processo de teste (precisa vir antes do resto)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type request from 'supertest';
import { prismaMock } from '../client';
import { buildHarness, callTool, connect, mcpPost, type Harness } from './harness';

// A medição baixa o arquivo do R2; aqui interessa que a ferramenta a acione, não o download.
vi.mock('../../lib/logoEnrich', () => ({
  enrichLogoFiles: vi.fn(async (files: Array<Record<string, unknown>>) =>
    files.map((f) => ({ ...f, bgHex: '#410B1C', ink: '#8E232D', transparentUrl: 'https://cdn.example.test/t.png' })),
  ),
}));

let h: Harness;

const result = (res: request.Response) =>
  res.body.result as { isError?: boolean; content: Array<{ type: string; text: string }>; structuredContent?: Record<string, any> };

const brandConn = (brandSlugs = ['marca-a']) =>
  connect(h, { scope: 'designer.read designer.brand', scopes: ['designer.read', 'designer.brand'], brandSlugs });

const SAVED = { essence: 'Marca de autoridade.', neverDo: ['Degradê colorido.'], palette: [{ hex: '#112233', role: 'Fundo' }] };

beforeEach(() => {
  h = buildHarness();
  h.addMember('user-1', 'brand-a', 'EDITOR');
  prismaMock.brandProfile.findUnique.mockResolvedValue({ data: SAVED } as never);
  prismaMock.brandProfile.upsert.mockResolvedValue({} as never);
  prismaMock.asset.findFirst.mockResolvedValue({ id: 'asset-1' } as never);
});

describe('update_brand_profile', () => {
  it('muda só os campos enviados, devolve o `previous` e grava a ficha mesclada', async () => {
    const flow = await brandConn();
    const res = await mcpPost(
      h.app,
      flow.accessToken,
      callTool('update_brand_profile', { brandSlug: 'marca-a', changes: { essence: 'Nova essência.' } }),
    );
    const r = result(res);
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent!.changedKeys).toEqual(['essence']);
    expect(r.structuredContent!.previous).toEqual(SAVED);
    expect(r.structuredContent!.profile).toMatchObject({ essence: 'Nova essência.', neverDo: ['Degradê colorido.'] });
    const gravado = prismaMock.brandProfile.upsert.mock.calls[0]![0] as { update: { data: Record<string, unknown> } };
    expect(gravado.update.data).toMatchObject({ essence: 'Nova essência.', neverDo: ['Degradê colorido.'] });
  });

  it('valor null apaga o campo', async () => {
    const flow = await brandConn();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('update_brand_profile', { brandSlug: 'marca-a', changes: { neverDo: null } })));
    expect(r.structuredContent!.profile).not.toHaveProperty('neverDo');
    expect(r.structuredContent!.changedKeys).toEqual(['neverDo']);
  });

  it('replace=true com o `previous` restaura a ficha inteira (campos ausentes somem)', async () => {
    prismaMock.brandProfile.findUnique.mockResolvedValue({ data: { ...SAVED, essence: 'Outra.', writingDirection: 'Direto.' } } as never);
    const flow = await brandConn();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('update_brand_profile', { brandSlug: 'marca-a', changes: SAVED, replace: true })));
    expect(r.structuredContent!.profile).toEqual(SAVED);
    expect(r.structuredContent!.changedKeys.sort()).toEqual(['essence', 'writingDirection']);
  });

  it('ficha inválida não grava nada e explica o campo', async () => {
    const flow = await brandConn();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('update_brand_profile', { brandSlug: 'marca-a', changes: { palette: [{ hex: 'azul' }] } })));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('nada foi gravado');
    expect(prismaMock.brandProfile.upsert).not.toHaveBeenCalled();
  });

  it('logo que não é da biblioteca da marca é recusado', async () => {
    prismaMock.asset.findFirst.mockResolvedValue(null as never);
    const flow = await brandConn();
    const r = result(
      await mcpPost(h.app, flow.accessToken, callTool('update_brand_profile', { brandSlug: 'marca-a', changes: { logo: { files: [{ url: 'https://evil.example.test/x.png' }] } } })),
    );
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('biblioteca');
    expect(prismaMock.brandProfile.upsert).not.toHaveBeenCalled();
  });

  it('o servidor mede os logos ao gravar (fundo exato e versão transparente), e o cliente não escolhe esses campos', async () => {
    const flow = await brandConn();
    const r = result(
      await mcpPost(
        h.app,
        flow.accessToken,
        callTool('update_brand_profile', { brandSlug: 'marca-a', changes: { logo: { files: [{ url: 'https://cdn.example.test/a.png', label: 'Wordmark' }] } } }),
      ),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent!.profile.logo.files[0]).toMatchObject({ bgHex: '#410B1C', transparentUrl: 'https://cdn.example.test/t.png' });
  });

  it('sem o escopo designer.brand a ferramenta é recusada (escrever peças não basta)', async () => {
    const flow = await connect(h, { scope: 'designer.write', scopes: ['designer.write'], brandSlugs: ['marca-a'] });
    const res = await mcpPost(h.app, flow.accessToken, callTool('update_brand_profile', { brandSlug: 'marca-a', changes: { essence: 'x' } }));
    expect(JSON.stringify(res.body)).toContain('designer.brand');
    expect(prismaMock.brandProfile.upsert).not.toHaveBeenCalled();
  });

  it('leitor da marca não altera a ficha mesmo com o escopo', async () => {
    h.addMember('user-1', 'brand-b', 'VIEWER');
    const flow = await brandConn(['marca-a']);
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('update_brand_profile', { brandSlug: 'marca-b', changes: { essence: 'x' } })));
    expect(r.isError).toBe(true);
    expect(prismaMock.brandProfile.upsert).not.toHaveBeenCalled();
  });
});
