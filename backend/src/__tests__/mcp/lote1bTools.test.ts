// Lote 1B do plano completo: get_photo_slots, set_slide_photo, upload_asset, get_integrations_status.
// Passam pelo transporte real (POST /mcp) com o OAuth completo do harness; o banco é em memória.
import '../client'; // mocka prisma e redis do processo de teste (precisa vir antes do resto)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type request from 'supertest';
import { prismaMock } from '../client';
import { buildHarness, callTool, connect, mcpPost, type Harness } from './harness';

vi.mock('../../lib/slidePhoto', () => ({
  applySlidePhoto: vi.fn(async (input: { slot: string; assetUrl?: string | null }) => ({
    slideIndex: 0,
    slide: { html: '<div data-photo-slot="1"></div>' },
    slots: [
      {
        slot: input.slot,
        hasPhoto: typeof input.assetUrl === 'string',
        src: typeof input.assetUrl === 'string' ? input.assetUrl : undefined,
        position: { x: 50, y: 40 },
        fit: 'cover',
      },
    ],
    framing: { mode: 'auto', faceVisible: 0.9 },
  })),
}));
vi.mock('../../lib/assetStore', () => ({
  storeBrandAsset: vi.fn(async (input: { fileName: string; mimeType: string; buffer: Buffer }) => ({
    id: 'asset-1',
    name: input.fileName,
    url: 'https://cdn.example.test/brands/brand-a/asset-1.png',
    fileType: input.mimeType,
    width: 2,
    height: 2,
    sizeBytes: input.buffer.length,
  })),
}));
// O contador de taxa é controlado por teste (o mock do Redis não expira janelas); o miolo tem teste próprio.
vi.mock('../../middleware/rateLimit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../middleware/rateLimit')>()),
  consumeRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSec: 0 })),
}));
import { applySlidePhoto } from '../../lib/slidePhoto';
import { storeBrandAsset } from '../../lib/assetStore';
import { consumeRateLimit } from '../../middleware/rateLimit';

let h: Harness;

const result = (res: request.Response) =>
  res.body.result as {
    isError?: boolean;
    content: Array<{ type: string; text: string }>;
    structuredContent?: Record<string, any>;
  };

const POST = '11111111-1111-4111-8111-111111111111';
const asWriter = () => connect(h, { scope: 'designer.write', scopes: ['designer.write'], brandSlugs: ['marca-a'] });
const asEditAll = () => connect(h, { scope: 'designer.edit_all', scopes: ['designer.edit_all'], brandSlugs: ['marca-a'] });
const asReader = () => connect(h, { brandSlugs: ['marca-a'] });

const ownedPost = { id: POST, type: 'PRESENTATION', name: 'Deck', content: { mcp: { userId: 'user-1' } } };
const foreignPost = { id: POST, type: 'PRESENTATION', name: 'Deck', content: {} };

async function tinyPng(): Promise<string> {
  const buf = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer();
  return buf.toString('base64');
}

beforeEach(() => {
  h = buildHarness();
  h.addMember('user-1', 'brand-a', 'EDITOR');
  h.addMember('user-1', 'brand-b', 'EDITOR');
  vi.mocked(applySlidePhoto).mockClear();
  vi.mocked(storeBrandAsset).mockClear();
  vi.mocked(consumeRateLimit).mockClear();
  vi.mocked(consumeRateLimit).mockResolvedValue({ allowed: true, retryAfterSec: 0 });
  prismaMock.brand.findUnique.mockResolvedValue({ parentBrandId: null } as never);
});

describe('get_photo_slots', () => {
  const deck = (html: string) => ({
    ...foreignPost,
    content: { kind: 'html-design', width: 1920, height: 1080, fonts: ['Inter'] },
    slides: [{ id: 's0', position: 0, contentJson: { html }, metadata: null }],
  });

  it('lista os espaços do slide, vazios e preenchidos (leitura basta)', async () => {
    prismaMock.post.findFirst.mockResolvedValue(
      deck(
        '<div data-photo-slot="1"></div>' +
          '<div data-photo-slot="2"><img src="https://cdn.example.test/a.jpg" style="object-position:30% 20%;object-fit:cover"></div>',
      ) as never,
    );
    const flow = await asReader();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('get_photo_slots', { brandSlug: 'marca-a', postId: POST, slide: 1 })));

    expect(r.isError).toBeFalsy();
    const slots = r.structuredContent!.slots as Array<{ slot: string; hasPhoto: boolean; src: string | null }>;
    expect(slots.map((s) => [s.slot, s.hasPhoto])).toEqual([
      ['1', false],
      ['2', true],
    ]);
    expect(slots[1]!.src).toBe('https://cdn.example.test/a.jpg');
    expect(slots[0]!.src).toBeNull();
  });

  it('slide sem espaço devolve lista vazia, com a explicação', async () => {
    prismaMock.post.findFirst.mockResolvedValue(deck('<h1>Só texto</h1>') as never);
    const flow = await asReader();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('get_photo_slots', { brandSlug: 'marca-a', postId: POST, slide: 1 })));
    expect(r.structuredContent!.slots).toEqual([]);
    expect(r.content[0]!.text).toMatch(/não tem espaço de foto/);
  });

  it('slide fora do deck vira erro de domínio', async () => {
    prismaMock.post.findFirst.mockResolvedValue(deck('<p>x</p>') as never);
    const flow = await asReader();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('get_photo_slots', { brandSlug: 'marca-a', postId: POST, slide: 5 })));
    expect(r.isError).toBe(true);
  });

  it('peça de outra marca é recusada', async () => {
    prismaMock.post.findFirst.mockResolvedValue(null as never);
    const flow = await asReader();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('get_photo_slots', { brandSlug: 'marca-a', postId: POST, slide: 1 })));
    expect(r.isError).toBe(true);
  });
});

describe('set_slide_photo', () => {
  const photo = 'https://cdn.example.test/brands/brand-a/palco.jpg';

  it('coloca a foto da biblioteca (slide a partir de 1) como edição de agente', async () => {
    prismaMock.post.findFirst.mockResolvedValue(ownedPost as never);
    const flow = await asWriter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('set_slide_photo', { brandSlug: 'marca-a', postId: POST, slide: 2, slot: '1', assetUrl: photo })));

    expect(r.isError).toBeFalsy();
    expect(applySlidePhoto).toHaveBeenCalledWith(
      expect.objectContaining({ postId: POST, index: 1, slot: '1', assetUrl: photo, userId: 'user-1', source: 'AI', allowedBrandIds: ['brand-a'] }),
    );
    expect(r.structuredContent).toMatchObject({ slide: 2, framing: { mode: 'auto' } });
    expect(r.structuredContent!.slots[0]).toMatchObject({ slot: '1', hasPhoto: true, src: photo });
  });

  it('num collab a biblioteca do projeto-base também vale', async () => {
    prismaMock.post.findFirst.mockResolvedValue(ownedPost as never);
    prismaMock.brand.findUnique.mockResolvedValue({ parentBrandId: 'brand-base' } as never);
    const flow = await asWriter();
    await mcpPost(h.app, flow.accessToken, callTool('set_slide_photo', { brandSlug: 'marca-a', postId: POST, slide: 1, slot: '1', assetUrl: photo }));
    expect(applySlidePhoto).toHaveBeenCalledWith(expect.objectContaining({ allowedBrandIds: ['brand-a', 'brand-base'] }));
  });

  it('assetUrl null esvazia o espaço', async () => {
    prismaMock.post.findFirst.mockResolvedValue(ownedPost as never);
    const flow = await asWriter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('set_slide_photo', { brandSlug: 'marca-a', postId: POST, slide: 1, slot: '1', assetUrl: null })));
    expect(applySlidePhoto).toHaveBeenCalledWith(expect.objectContaining({ assetUrl: null }));
    expect(r.content[0]!.text).toMatch(/Foto removida/);
  });

  it('só reenquadrar: aceita position/fit sem assetUrl', async () => {
    prismaMock.post.findFirst.mockResolvedValue(ownedPost as never);
    const flow = await asWriter();
    const r = result(
      await mcpPost(h.app, flow.accessToken, callTool('set_slide_photo', { brandSlug: 'marca-a', postId: POST, slide: 1, slot: '1', position: { x: 30, y: 10 }, fit: 'contain' })),
    );
    expect(r.isError).toBeFalsy();
    expect(vi.mocked(applySlidePhoto).mock.calls[0]![0].assetUrl).toBeUndefined();
    expect(vi.mocked(applySlidePhoto).mock.calls[0]![0]).toMatchObject({ position: { x: 30, y: 10 }, fit: 'contain' });
  });

  it('sem assetUrl, position nem fit não há o que mudar', async () => {
    prismaMock.post.findFirst.mockResolvedValue(ownedPost as never);
    const flow = await asWriter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('set_slide_photo', { brandSlug: 'marca-a', postId: POST, slide: 1, slot: '1' })));
    expect(r.isError).toBe(true);
    expect(applySlidePhoto).not.toHaveBeenCalled();
  });

  it('recusa posição fora de 0-100 e URL que não é URL', async () => {
    prismaMock.post.findFirst.mockResolvedValue(ownedPost as never);
    const flow = await asWriter();
    expect(result(await mcpPost(h.app, flow.accessToken, callTool('set_slide_photo', { brandSlug: 'marca-a', postId: POST, slide: 1, slot: '1', position: { x: 150, y: 0 } }))).isError).toBe(true);
    expect(result(await mcpPost(h.app, flow.accessToken, callTool('set_slide_photo', { brandSlug: 'marca-a', postId: POST, slide: 1, slot: '1', assetUrl: 'nao-e-url' }))).isError).toBe(true);
    expect(applySlidePhoto).not.toHaveBeenCalled();
  });

  it('foto fora da biblioteca (400 do servidor) vira frase para o agente', async () => {
    prismaMock.post.findFirst.mockResolvedValue(ownedPost as never);
    vi.mocked(applySlidePhoto).mockRejectedValueOnce(Object.assign(new Error('Essa foto não está na biblioteca da marca'), { statusCode: 400 }));
    const flow = await asWriter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('set_slide_photo', { brandSlug: 'marca-a', postId: POST, slide: 1, slot: '1', assetUrl: 'https://evil.example/x.jpg' })));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe('Essa foto não está na biblioteca da marca');
  });

  it('erro inesperado não vaza detalhe interno', async () => {
    prismaMock.post.findFirst.mockResolvedValue(ownedPost as never);
    vi.mocked(applySlidePhoto).mockRejectedValueOnce(new Error('chromium crashed at /app/node_modules/puppeteer'));
    const flow = await asWriter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('set_slide_photo', { brandSlug: 'marca-a', postId: POST, slide: 1, slot: '1', assetUrl: photo })));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).not.toMatch(/chromium|puppeteer|node_modules/);
  });

  it('peça alheia só com designer.edit_all; leitura nunca', async () => {
    prismaMock.post.findFirst.mockResolvedValue(foreignPost as never);
    const writer = await asWriter();
    expect(result(await mcpPost(h.app, writer.accessToken, callTool('set_slide_photo', { brandSlug: 'marca-a', postId: POST, slide: 1, slot: '1', assetUrl: photo }))).isError).toBe(true);
    expect(applySlidePhoto).not.toHaveBeenCalled();

    const all = await asEditAll();
    expect(result(await mcpPost(h.app, all.accessToken, callTool('set_slide_photo', { brandSlug: 'marca-a', postId: POST, slide: 1, slot: '1', assetUrl: photo }))).isError).toBeFalsy();
    expect(applySlidePhoto).toHaveBeenCalledTimes(1);

    const reader = await asReader();
    const res = await mcpPost(h.app, reader.accessToken, callTool('set_slide_photo', { brandSlug: 'marca-a', postId: POST, slide: 1, slot: '1', assetUrl: photo }));
    expect(res.status === 403 || result(res)?.isError).toBeTruthy();
    expect(applySlidePhoto).toHaveBeenCalledTimes(1);
  });
});

describe('upload_asset', () => {
  it('guarda a imagem na marca autorizada e devolve a URL', async () => {
    const flow = await asWriter();
    const dataBase64 = await tinyPng();
    const r = result(
      await mcpPost(h.app, flow.accessToken, callTool('upload_asset', { brandSlug: 'marca-a', fileName: 'palco.png', mimeType: 'image/png', dataBase64, tags: ['foto'] })),
    );

    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ assetId: 'asset-1', name: 'palco.png', fileType: 'image/png', width: 2, height: 2 });
    expect(r.structuredContent!.url).toMatch(/^https:\/\//);
    expect(storeBrandAsset).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: 'brand-a', userId: 'user-1', fileName: 'palco.png', mimeType: 'image/png', source: 'upload', tags: ['foto'] }),
    );
    const sent = vi.mocked(storeBrandAsset).mock.calls[0]![0].buffer;
    expect(sent.toString('base64')).toBe(dataBase64);
  });

  it('aceita o prefixo data: e quebras de linha no base64', async () => {
    const flow = await asWriter();
    const b64 = await tinyPng();
    const withPrefix = `data:image/png;base64,${b64.slice(0, 20)}\n${b64.slice(20)}`;
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('upload_asset', { brandSlug: 'marca-a', fileName: 'a.png', mimeType: 'image/png', dataBase64: withPrefix })));
    expect(r.isError).toBeFalsy();
  });

  it.each([
    ['base64 inválido', { dataBase64: '###não é base64###' }],
    ['tipo fora da lista', { mimeType: 'application/pdf' }],
    ['conteúdo que não é imagem, mesmo declarado como PNG', { dataBase64: Buffer.from('<html><script>alert(1)</script></html>').toString('base64') }],
    ['nome vazio', { fileName: '   ' }],
    ['etiquetas demais', { tags: Array.from({ length: 9 }, (_, i) => `t${i}`) }],
  ])('recusa %s antes de gravar', async (_nome, over) => {
    const flow = await asWriter();
    const base = { brandSlug: 'marca-a', fileName: 'a.png', mimeType: 'image/png', dataBase64: await tinyPng() };
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('upload_asset', { ...base, ...over })));
    expect(r.isError).toBe(true);
    expect(storeBrandAsset).not.toHaveBeenCalled();
  });

  it('arquivo acima de 10 MB é recusado (decodificado)', async () => {
    const flow = await asWriter();
    // 10 MB + 1 em base64 cabe no teto do schema, mas passa do teto decodificado.
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 1).toString('base64');
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('upload_asset', { brandSlug: 'marca-a', fileName: 'grande.png', mimeType: 'image/png', dataBase64: big })));
    expect(r.isError).toBe(true);
    expect(storeBrandAsset).not.toHaveBeenCalled();
  });

  it('nome com caminho vira só o nome do arquivo', async () => {
    const flow = await asWriter();
    await mcpPost(h.app, flow.accessToken, callTool('upload_asset', { brandSlug: 'marca-a', fileName: '../../etc/passwd.png', mimeType: 'image/png', dataBase64: await tinyPng() }));
    expect(vi.mocked(storeBrandAsset).mock.calls[0]![0].fileName).toBe('passwd.png');
  });

  it('SVG inválido na higienização vira erro de domínio', async () => {
    const { InvalidSvgError } = await import('../../lib/svgSanitize');
    vi.mocked(storeBrandAsset).mockRejectedValueOnce(new InvalidSvgError('SVG vazio ou malformado'));
    const flow = await asWriter();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('upload_asset', { brandSlug: 'marca-a', fileName: 'a.svg', mimeType: 'image/svg+xml', dataBase64: svg })));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/SVG inválido/);
  });

  it('divide o MESMO orçamento de sanitização por conta (chave: usuário)', async () => {
    const flow = await asWriter();
    await mcpPost(h.app, flow.accessToken, callTool('upload_asset', { brandSlug: 'marca-a', fileName: 'a.png', mimeType: 'image/png', dataBase64: await tinyPng() }));
    expect(consumeRateLimit).toHaveBeenCalledWith(expect.objectContaining({ keyPrefix: 'svg-sanitize', max: 4, windowSec: 10 }), 'user-1');
  });

  it('acima do orçamento a chamada é recusada com o tempo de espera e nada é gravado', async () => {
    vi.mocked(consumeRateLimit).mockResolvedValueOnce({ allowed: false, retryAfterSec: 7 });
    const flow = await asWriter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('upload_asset', { brandSlug: 'marca-a', fileName: 'a.png', mimeType: 'image/png', dataBase64: await tinyPng() })));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/7 s/);
    expect(storeBrandAsset).not.toHaveBeenCalled();
  });

  it('exige escrita e a marca aprovada no token', async () => {
    const reader = await asReader();
    const res = await mcpPost(h.app, reader.accessToken, callTool('upload_asset', { brandSlug: 'marca-a', fileName: 'a.png', mimeType: 'image/png', dataBase64: await tinyPng() }));
    expect(res.status === 403 || result(res)?.isError).toBeTruthy();

    const writer = await asWriter();
    const other = result(await mcpPost(h.app, writer.accessToken, callTool('upload_asset', { brandSlug: 'marca-b', fileName: 'a.png', mimeType: 'image/png', dataBase64: await tinyPng() })));
    expect(other.isError).toBe(true);
    expect(storeBrandAsset).not.toHaveBeenCalled();
  });
});

describe('get_integrations_status', () => {
  it('devolve só sim/não e a validade do Canva — nunca um token', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      canvaAccessToken: 'SEGREDO-CANVA-TOKEN',
      canvaTokenExpiry: new Date('2026-12-01T00:00:00Z'),
      googleAccessToken: 'SEGREDO-GOOGLE-TOKEN',
      asanaToken: null,
    } as never);
    const flow = await asReader();
    const res = await mcpPost(h.app, flow.accessToken, callTool('get_integrations_status', {}));
    const r = result(res);

    expect(r.structuredContent).toEqual({
      canva: { connected: true, expiresAt: '2026-12-01T00:00:00.000Z' },
      google: { connected: true },
      asana: { connected: false },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/SEGREDO/);
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-1' } }));
  });

  it('usuário sem integração: tudo desconectado, validade nula', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ canvaAccessToken: '', canvaTokenExpiry: new Date(), googleAccessToken: null, asanaToken: null } as never);
    const flow = await asReader();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('get_integrations_status', {})));
    expect(r.structuredContent).toEqual({ canva: { connected: false, expiresAt: null }, google: { connected: false }, asana: { connected: false } });
  });

  it('usuário inexistente não quebra', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null as never);
    const flow = await asReader();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('get_integrations_status', {})));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent!.canva.connected).toBe(false);
  });
});
