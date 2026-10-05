// Um teste por ponto de escrita: prova que o buffer entregue ao R2 JÁ é o sanitizado
// e que o Content-Type é image/svg+xml exato (o cliente não escolhe text/html).
// R2, Prisma, Gemini e S3 são mocks — nada aqui fala com infraestrutura real.

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import { prismaMock } from './client';
import jwt from 'jsonwebtoken';

const hoisted = vi.hoisted(() => ({
  s3Sent: [] as Array<{ input: Record<string, unknown> }>,
  geminiSvg: { value: '' },
}));

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
    sign: vi.fn(() => 'jwt'),
    JsonWebTokenError: class JsonWebTokenError extends Error {},
  },
}));

vi.mock('../lib/r2', () => ({
  uploadFileToR2: vi.fn(),
  deleteFromR2: vi.fn(async () => true),
  assertR2Configured: vi.fn(),
  uploadPngToR2: vi.fn(),
  r2KeyFromUrl: vi.fn(),
  s3: { send: vi.fn(async (cmd: { input: Record<string, unknown> }) => { hoisted.s3Sent.push(cmd); return {}; }) },
}));

// upload.ts (rota /logo) e referenceSync.ts (uploadBase64ToR2) gravam direto no S3.
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = vi.fn(async (cmd: { input: Record<string, unknown> }) => {
      hoisted.s3Sent.push(cmd);
      return {};
    });
  },
  PutObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
  DeleteObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

// A ingestão de brandbook pede SVGs "reconstruídos" ao Gemini. Aqui o modelo devolve um
// SVG malicioso — é exatamente o risco: o modelo leu o brandbook do usuário.
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContent: vi.fn(async () => ({
        text: JSON.stringify({
          guidelines: 'Tom direto',
          colors: ['#112233'],
          primaryFonts: ['Inter'],
          reconstructedSvgs: [
            { name: 'sparkle-ia.svg', classification: 'GRAPHIC_ELEMENT', svgCode: hoisted.geminiSvg.value },
          ],
        }),
      })),
    };
  },
  Type: { OBJECT: 'OBJECT', STRING: 'STRING', ARRAY: 'ARRAY', NUMBER: 'NUMBER' },
}));

import { app } from '../app';
import { config } from '../config';
import { uploadFileToR2 } from '../lib/r2';
import { uploadChatAttachments } from '../lib/chatAttachments';
import { uploadBase64ToR2 } from '../lib/referenceSync';
import { normalizeImage } from '../lib/imageNormalizer';
import type { ChatAttachment } from '../lib/redis';

const XMLNS = 'xmlns="http://www.w3.org/2000/svg"';
const SVG_SUJO = `<svg ${XMLNS} viewBox="0 0 10 10" onload=alert(1)><script>alert(1)</script ><rect width="10" height="10" fill="#c2103f"/></svg>`;
const SVG_LIMPO_ESPERADO = /<rect[^>]*width="10"/;

const mockedVerify = jwt.verify as unknown as Mock;
const mockedUpload = uploadFileToR2 as unknown as Mock;
const auth = (r: request.Test) => r.set('Authorization', 'Bearer token');

/** O que o R2 recebeu: buffer como texto + mime + pasta, de cada chamada. */
function enviados() {
  return mockedUpload.mock.calls.map(([buffer, name, mimeType, folder]) => ({
    text: (buffer as Buffer).toString('utf-8'),
    name: name as string,
    mimeType: mimeType as string,
    folder: folder as string,
  }));
}

function assertLimpo(text: string) {
  expect(text).not.toMatch(/<script/i);
  expect(text).not.toMatch(/onload/i);
  expect(text).not.toMatch(/alert\(1\)\s*<\/script/i);
  expect(text).toMatch(SVG_LIMPO_ESPERADO);
}

let contadorUsuarioDeTeste = 0;

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.s3Sent.length = 0;
  hoisted.geminiSvg.value = `<svg viewBox="0 0 40 40"><a href="javascript:alert(1)"><path d="M0 0h10v10z" fill="#c2103f"/></a><script>alert(1)</script><rect width="10" height="10" onclick="alert(1)"/></svg>`;
  // Cada teste usa uma conta PRÓPRIA (não mais fixo em 'u1'): este arquivo bate várias
  // vezes nas MESMAS rotas que agora têm rate limit por conta (svgSanitizeRateLimit.ts,
  // max=4 por janela) — com 'u1' fixo, os testes deste arquivo dividiam o mesmo balde e,
  // a partir do 5º POST, o rate limiter (corretamente) começava a devolver 429 em vez do
  // 200/201/400 que cada teste espera. Isto não é sobre o rate limit em si (testado à
  // parte em svgSanitizeRateLimit.test.ts) — é sobre isolar a conta simulada entre casos
  // de teste, o que já era desejável independente do rate limit.
  mockedVerify.mockReturnValue({ userId: `usuario-de-teste-${++contadorUsuarioDeTeste}` });
  mockedUpload.mockImplementation(async (_b: Buffer, name: string) => `https://cdn.exemplo.com/brands/brand-1/${name}`);
  prismaMock.brand.findUnique.mockResolvedValue({ id: 'brand-1', slug: 'marca', name: 'Marca', config: null });
  prismaMock.brandMember.findUnique.mockResolvedValue({ role: 'EDITOR' });
  prismaMock.asset.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'asset-1', ...data }));
  prismaMock.folder.findFirst.mockResolvedValue({ id: 'folder-1' });
  prismaMock.brandConfig.upsert.mockResolvedValue({});
  Object.assign(config, {
    r2Endpoint: 'https://r2.exemplo.com',
    r2AccessKeyId: 'k',
    r2SecretAccessKey: 's',
    r2BucketName: 'bucket',
    r2PublicUrl: 'https://cdn.exemplo.com',
  });
});

// ── POST /api/brands/:slug/assets ──────────────────────────────────────────────
describe('POST /api/brands/:slug/assets (upload multipart)', () => {
  it('SVG malicioso chega ao R2 já sanitizado e como image/svg+xml', async () => {
    const res = await auth(
      request(app)
        .post('/api/brands/marca/assets')
        .attach('file', Buffer.from(SVG_SUJO), { filename: 'logo.svg', contentType: 'image/svg+xml' }),
    );

    expect(res.status).toBe(201);
    const [envio] = enviados();
    assertLimpo(envio!.text);
    expect(envio!.mimeType).toBe('image/svg+xml');
    // O registro no banco descreve o que foi gravado, não o que foi enviado.
    const gravado = prismaMock.asset.create.mock.calls[0]![0].data;
    expect(gravado.fileType).toBe('image/svg+xml');
    expect(gravado.sizeBytes).toBe(Buffer.byteLength(envio!.text));
  });

  it('cliente declarando text/html para um .svg não consegue servir HTML: sai image/svg+xml', async () => {
    const res = await auth(
      request(app)
        .post('/api/brands/marca/assets')
        .attach('file', Buffer.from(SVG_SUJO), { filename: 'logo.svg', contentType: 'text/html' }),
    );

    expect(res.status).toBe(201);
    const [envio] = enviados();
    expect(envio!.mimeType).toBe('image/svg+xml');
    assertLimpo(envio!.text);
  });

  it('HTML de verdade nunca vai ao R2 como text/html', async () => {
    const res = await auth(
      request(app)
        .post('/api/brands/marca/assets')
        .attach('file', Buffer.from('<html><script>alert(1)</script></html>'), { filename: 'pagina.html', contentType: 'text/html' }),
    );

    expect(res.status).toBe(201);
    expect(enviados()[0]!.mimeType).toBe('application/octet-stream');
  });

  it('arquivo .svg que não é SVG → 400 e nada é gravado', async () => {
    const res = await auth(
      request(app)
        .post('/api/brands/marca/assets')
        .attach('file', Buffer.from('<html><script>alert(1)</script></html>'), { filename: 'falso.svg', contentType: 'image/svg+xml' }),
    );

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SVG');
    expect(mockedUpload).not.toHaveBeenCalled();
    expect(prismaMock.asset.create).not.toHaveBeenCalled();
  });

  it('PNG segue intacto (sem reprocessar raster)', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const res = await auth(request(app).post('/api/brands/marca/assets').attach('file', png, { filename: 'a.png', contentType: 'image/png' }));

    expect(res.status).toBe(201);
    expect(mockedUpload.mock.calls[0]![0]).toEqual(png);
    expect(mockedUpload.mock.calls[0]![2]).toBe('image/png');
  });
});

// ── POST /api/brands/:slug/assets/import-base64 ────────────────────────────────
describe('POST /api/brands/:slug/assets/import-base64', () => {
  it('SVG malicioso chega sanitizado; SVG inválido do mesmo lote só é pulado', async () => {
    const res = await auth(
      request(app)
        .post('/api/brands/marca/assets/import-base64')
        .send({
          attachments: [
            { name: 'logo.svg', mimeType: 'text/html', dataBase64: Buffer.from(SVG_SUJO).toString('base64') },
            { name: 'lixo.svg', mimeType: 'image/svg+xml', dataBase64: Buffer.from('<html><script>alert(1)</script></html>').toString('base64') },
          ],
          source: 'drive',
        }),
    );

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(1);
    const envios = enviados();
    expect(envios).toHaveLength(1);
    assertLimpo(envios[0]!.text);
    expect(envios[0]!.mimeType).toBe('image/svg+xml');
    expect(prismaMock.asset.create.mock.calls[0]![0].data.fileType).toBe('image/svg+xml');
  });

  it('lote só com SVG inválido → 400 (nenhum arquivo importado)', async () => {
    const res = await auth(
      request(app)
        .post('/api/brands/marca/assets/import-base64')
        .send({ attachments: [{ name: 'lixo.svg', mimeType: 'image/svg+xml', dataBase64: Buffer.from('nada').toString('base64') }] }),
    );

    expect(res.status).toBe(400);
    expect(mockedUpload).not.toHaveBeenCalled();
  });
});

// ── POST /api/upload ───────────────────────────────────────────────────────────
describe('POST /api/upload (upload genérico)', () => {
  it('SVG malicioso chega ao R2 sanitizado e como image/svg+xml, mesmo declarado como text/html', async () => {
    const res = await auth(
      request(app)
        .post('/api/upload')
        .attach('file', Buffer.from(SVG_SUJO), { filename: 'x.svg', contentType: 'text/html' }),
    );

    expect(res.status).toBe(201);
    const [envio] = enviados();
    assertLimpo(envio!.text);
    expect(envio!.mimeType).toBe('image/svg+xml');
    expect(envio!.folder).toBe('uploads/general');
  });

  it('SVG sem extensão e sem tipo (octet-stream) é descoberto pelo conteúdo', async () => {
    const res = await auth(
      request(app)
        .post('/api/upload')
        .attach('file', Buffer.from(SVG_SUJO), { filename: 'anexo', contentType: 'application/octet-stream' }),
    );

    expect(res.status).toBe(201);
    assertLimpo(enviados()[0]!.text);
    expect(enviados()[0]!.mimeType).toBe('image/svg+xml');
  });

  it('SVG inválido → 400', async () => {
    const res = await auth(
      request(app).post('/api/upload').attach('file', Buffer.from('<html/>'), { filename: 'x.svg', contentType: 'image/svg+xml' }),
    );
    expect(res.status).toBe(400);
    expect(mockedUpload).not.toHaveBeenCalled();
  });
});

// ── POST /api/upload/logo ──────────────────────────────────────────────────────
describe('POST /api/upload/logo', () => {
  it('SVG vira PNG: nenhum byte de SVG chega ao R2, com Content-Type image/png', async () => {
    const res = await auth(
      request(app)
        .post('/api/upload/logo')
        .send({ data: Buffer.from(SVG_SUJO).toString('base64'), mimeType: 'image/svg+xml' }),
    );

    expect(res.status).toBe(200);
    expect(hoisted.s3Sent).toHaveLength(1);
    const put = hoisted.s3Sent[0]!.input;
    expect(put.ContentType).toBe('image/png');
    const body = put.Body as Buffer;
    expect(body.subarray(0, 4).toString('hex')).toBe('89504e47');
    expect(body.toString('utf-8')).not.toMatch(/<script|onload/i);
  });

  it('SVG mandado como image/png também passa pelo sanitizador antes de rasterizar', async () => {
    const res = await auth(
      request(app)
        .post('/api/upload/logo')
        .send({ data: Buffer.from(SVG_SUJO).toString('base64'), mimeType: 'image/png' }),
    );
    expect(res.status).toBe(200);
    expect((hoisted.s3Sent[0]!.input.Body as Buffer).subarray(0, 4).toString('hex')).toBe('89504e47');
  });

  it('SVG que não é SVG → 400 (InvalidSvgError mapeado pelo errorHandler)', async () => {
    const res = await auth(
      request(app)
        .post('/api/upload/logo')
        .send({ data: Buffer.from('<html><script>alert(1)</script></html>').toString('base64'), mimeType: 'image/svg+xml' }),
    );
    expect(res.status).toBe(400);
    expect(hoisted.s3Sent).toHaveLength(0);
  });
});

// ── POST /api/brands/:slug/brandbook/ingest ────────────────────────────────────
describe('POST /api/brands/:slug/brandbook/ingest', () => {
  it('SVG real, cópia bruta, SVG inline de HTML e SVG "reconstruído por IA": todos sanitizados', async () => {
    const html = `<html><body><h1>Brandbook</h1><svg ${XMLNS} viewBox="0 0 10 10" onload=alert(1)><script>alert(1)</script><rect width="10" height="10" fill="#c2103f"/></svg></body></html>`;

    const res = await auth(
      request(app)
        .post('/api/brands/marca/brandbook/ingest')
        .attach('files', Buffer.from(SVG_SUJO), { filename: 'logo-marca.svg', contentType: 'image/svg+xml' })
        .attach('files', Buffer.from(html), { filename: 'brandbook.html', contentType: 'text/html' }),
    );

    expect(res.status).toBe(200);
    const envios = enviados();

    // Nada com cara de SVG sai sujo, em nenhuma das pastas.
    const svgs = envios.filter((e) => e.mimeType === 'image/svg+xml');
    expect(svgs.length).toBeGreaterThanOrEqual(4); // bruto + processado (logo), inline (html), IA
    for (const e of svgs) {
      expect(e.text, `${e.folder}/${e.name}`).not.toMatch(/<script|onload|onclick|javascript:/i);
    }

    // Cada origem foi coberta.
    expect(envios.some((e) => e.folder.endsWith('brandbooks_raw') && e.name === 'logo-marca.svg' && e.mimeType === 'image/svg+xml')).toBe(true);
    expect(envios.some((e) => e.folder.endsWith('/brandbook') && e.name === 'logo-marca.svg')).toBe(true);
    expect(envios.some((e) => e.name === 'inline-graphic-1.svg')).toBe(true);
    expect(envios.some((e) => e.name === 'sparkle-ia.svg')).toBe(true);

    // O .html bruto não vai como text/html (viraria página servida do bucket).
    const htmlBruto = envios.find((e) => e.name === 'brandbook.html');
    expect(htmlBruto!.mimeType).toBe('application/octet-stream');

    // Conteúdo legítimo do SVG da IA sobreviveu.
    const ia = envios.find((e) => e.name === 'sparkle-ia.svg')!;
    expect(ia.text).toContain('M0 0h10v10z');
    expect(ia.text).toContain('xmlns="http://www.w3.org/2000/svg"');

    // Metadados no banco batem com o que foi gravado.
    for (const [{ data }] of prismaMock.asset.create.mock.calls as Array<[{ data: { fileType: string; name: string } }]>) {
      if (data.name.endsWith('.svg')) expect(data.fileType).toBe('image/svg+xml');
    }
  });

  it('SVG irrecuperável no zip/upload é pulado sem derrubar a ingestão', async () => {
    const res = await auth(
      request(app)
        .post('/api/brands/marca/brandbook/ingest')
        .attach('files', Buffer.from('<html><script>alert(1)</script></html>'), { filename: 'falso.svg', contentType: 'image/svg+xml' }),
    );

    expect(res.status).toBe(200);
    // Só o SVG da IA foi gravado; o falso não gerou nada com aquele nome.
    expect(enviados().some((e) => e.name === 'falso.svg')).toBe(false);
  });
});

// ── lib/chatAttachments (anexos do chat, WebSocket) ────────────────────────────
describe('uploadChatAttachments', () => {
  it('SVG anexado no chat chega ao R2 sanitizado; a URL é preenchida', async () => {
    const anexos: ChatAttachment[] = [
      { name: 'logo.svg', mimeType: 'image/svg+xml', dataBase64: Buffer.from(SVG_SUJO).toString('base64') },
    ];

    await uploadChatAttachments(anexos, 'marca');

    const [envio] = enviados();
    assertLimpo(envio!.text);
    expect(envio!.mimeType).toBe('image/svg+xml');
    expect(envio!.folder).toBe('brands/marca/chat-attachments');
    expect(anexos[0]!.url).toContain('logo.svg');
  });

  it('SVG inválido não derruba o lote: o anexo segue sem url', async () => {
    const anexos: ChatAttachment[] = [
      { name: 'falso.svg', mimeType: 'image/svg+xml', dataBase64: Buffer.from('<html><script>alert(1)</script></html>').toString('base64') },
      { name: 'ok.svg', mimeType: 'image/svg+xml', dataBase64: Buffer.from(SVG_SUJO).toString('base64') },
    ];

    await uploadChatAttachments(anexos, 'marca');

    expect(anexos[0]!.url).toBeUndefined();
    expect(anexos[1]!.url).toBeDefined();
    expect(mockedUpload).toHaveBeenCalledTimes(1);
  });
});

// ── lib/referenceSync.uploadBase64ToR2 (upload manual de referência) ───────────
describe('uploadBase64ToR2 (referências)', () => {
  it('SVG enviado como print de referência é gravado sanitizado, com Content-Type fixo', async () => {
    const url = await uploadBase64ToR2(Buffer.from(SVG_SUJO).toString('base64'), 'image/svg+xml');

    expect(url).toMatch(/^https:\/\/cdn\.exemplo\.com\/references\/[0-9a-f-]+\.svg$/);
    expect(hoisted.s3Sent).toHaveLength(1);
    const put = hoisted.s3Sent[0]!.input;
    assertLimpo((put.Body as Buffer).toString('utf-8'));
    expect(put.ContentType).toBe('image/svg+xml');
    expect(put.ContentDisposition).toBe('attachment');
  });

  it('SVG inválido lança (nada é gravado)', async () => {
    await expect(uploadBase64ToR2(Buffer.from('<html/>').toString('base64'), 'image/svg+xml')).rejects.toMatchObject({ code: 'INVALID_SVG' });
    expect(hoisted.s3Sent).toHaveLength(0);
  });

  it('imagem comum continua igual', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const url = await uploadBase64ToR2(png.toString('base64'), 'image/png');
    expect(url).toMatch(/\.png$/);
    expect(hoisted.s3Sent[0]!.input.ContentType).toBe('image/png');
    expect(hoisted.s3Sent[0]!.input.ContentDisposition).toBeUndefined();
  });
});

// ── imageNormalizer (sanitização delegada ao helper único) ─────────────────────
describe('normalizeImage', () => {
  it('SVG com script vira PNG normalmente', async () => {
    const out = await normalizeImage(Buffer.from(SVG_SUJO), 'image/svg+xml');
    expect(out.mimeType).toBe('image/png');
    expect(out.buffer.subarray(0, 4).toString('hex')).toBe('89504e47');
  });

  it('SVG que não é SVG lança InvalidSvgError (antes o regex deixava passar qualquer coisa)', async () => {
    await expect(normalizeImage(Buffer.from('<html><script>alert(1)</script></html>'), 'image/svg+xml')).rejects.toMatchObject({ code: 'INVALID_SVG' });
  });
});
