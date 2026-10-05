// Rate limit por conta nas rotas que acabam chamando sanitizeSvg/prepareStorableFile
// (blocker B, revisão adversarial sobre o commit de0d9a6): saturar o pool piscina
// (maxThreads=4) com só 5-6 uploads concorrentes de UMA ÚNICA conta (papel EDITOR, sem
// privilégio nenhum) fazia até um SVG legítimo concorrente ser rejeitado por timeout
// junto com os adversariais. A correção vive em lib/svgSanitizeRateLimit.ts (a
// configuração compartilhada) + middleware/rateLimit.ts (suporte a `keyBy: 'user'`) +
// as 4 rotas (brands.ts, assets.ts, upload.ts).
//
// Este arquivo prova o contrato no nível HTTP: a Nª requisição da MESMA conta recebe
// 429 ANTES de chegar em prepareStorableFile/sanitizeSvg — por isso os payloads aqui
// são PNGs triviais (não-SVG): prepareStorableFile devolve o buffer intacto sem tocar
// no pool piscina (ver a checagem `isSvg` em svgSanitize.ts), então este arquivo não
// sobe nenhum worker_thread e não compete por CPU com os arquivos que sobem o pool de
// verdade (svgSanitize.test.ts, svgSanitizeConcorrencia.test.ts, svgWritePoints.test.ts,
// r2SvgGuard.test.ts) — o que está sendo testado aqui é o MIDDLEWARE, não o pool.
//
// O mock de Redis vem de ./client (client.ts) — um contador em memória de verdade (não
// resetado por `vi.clearAllMocks()`, só por `vi.resetAllMocks()`, que este arquivo
// EVITA de propósito). Cada describe usa um userId próprio (nunca reaproveitado) para
// não herdar contagem de outro teste.

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import { prismaMock } from './client';
import jwt from 'jsonwebtoken';

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
    sign: vi.fn(() => 'jwt'),
    JsonWebTokenError: class JsonWebTokenError extends Error {},
  },
}));

vi.mock('../lib/r2', () => ({
  uploadFileToR2: vi.fn(async (_buf: Buffer, name: string) => `https://cdn.exemplo.com/${name}`),
  deleteFromR2: vi.fn(async () => true),
  assertR2Configured: vi.fn(),
  uploadPngToR2: vi.fn(),
  r2KeyFromUrl: vi.fn(),
}));

// brandbook/ingest passa por um pipeline pesado (Gemini, R2, múltiplos arquivos) que
// não tem nada a ver com o que este arquivo testa (rate limit) — mockado fora, como
// svgWritePoints.test.ts já mocka dependências não relacionadas ao caso em teste.
vi.mock('../lib/brandbookIngestion', () => ({
  processBrandbookIngest: vi.fn(async () => ({ assets: [], colors: [], guidelines: '' })),
}));

// POST /api/upload/logo fala com S3 diretamente (não via lib/r2.ts).
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = vi.fn(async () => ({}));
  },
  PutObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

import { app } from '../app';
import { config } from '../config';
import { processBrandbookIngest } from '../lib/brandbookIngestion';

const mockedVerify = jwt.verify as unknown as Mock;
const mockedIngest = processBrandbookIngest as unknown as Mock;

// PNG 1x1 de verdade: prepareStorableFile detecta "não é SVG" e devolve o buffer
// intacto sem chamar sanitizeSvg — nenhum pool piscina sobe neste arquivo.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function comoUsuario(userId: string) {
  mockedVerify.mockReturnValue({ userId });
  return (r: request.Test) => r.set('Authorization', 'Bearer jwt-de-teste');
}

beforeEach(() => {
  // Só clearAllMocks (limpa histórico de chamadas) — NUNCA resetAllMocks aqui: isso
  // apagaria a implementação do redis.incr em memória que ./client fornece, e o rate
  // limit passaria a falhar aberto (nunca bloquear), invalidando o teste inteiro.
  vi.clearAllMocks();
  mockedIngest.mockResolvedValue({ assets: [], colors: [], guidelines: '' });
  prismaMock.brand.findUnique.mockResolvedValue({ id: 'brand-1', slug: 'marca', name: 'Marca' });
  prismaMock.brandMember.findUnique.mockResolvedValue({ role: 'EDITOR' });
  prismaMock.asset.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'asset-1', ...data }));
  Object.assign(config, {
    r2Endpoint: 'https://r2.exemplo.com',
    r2AccessKeyId: 'k',
    r2SecretAccessKey: 's',
    r2BucketName: 'bucket',
    r2PublicUrl: 'https://cdn.exemplo.com',
  });
});

describe('rate limit por conta — POST /api/upload', () => {
  it('as 4 primeiras requisições passam; a 5ª (mesma conta) recebe 429 com Retry-After', async () => {
    const auth = comoUsuario('conta-upload-1');
    const respostas: number[] = [];

    for (let i = 0; i < 5; i++) {
      const res = await auth(request(app).post('/api/upload').attach('file', PNG_1X1, { filename: 'a.png', contentType: 'image/png' }));
      respostas.push(res.status);
      if (i === 4) {
        expect(res.status).toBe(429);
        expect(res.headers['retry-after']).toBeDefined();
      }
    }

    expect(respostas).toEqual([201, 201, 201, 201, 429]);
  });
});

describe('rate limit por conta — isolamento entre contas (keyBy: user, não IP)', () => {
  it('a conta B não herda o limite já gasto pela conta A', async () => {
    const authA = comoUsuario('conta-isolamento-a');
    // Conta A gasta o orçamento inteiro (4 de 4).
    for (let i = 0; i < 4; i++) {
      const res = await authA(request(app).post('/api/upload').attach('file', PNG_1X1, { filename: 'a.png', contentType: 'image/png' }));
      expect(res.status).toBe(201);
    }
    // A 5ª da conta A já bloqueia — confirma que o teto foi mesmo atingido.
    const bloqueada = await authA(request(app).post('/api/upload').attach('file', PNG_1X1, { filename: 'a.png', contentType: 'image/png' }));
    expect(bloqueada.status).toBe(429);

    // Conta B, DIFERENTE, na mesma rota: se a chave fosse por IP (todas as requisições
    // do supertest saem do "mesmo IP" local), a conta B herdaria o balde da conta A e
    // seria bloqueada injustamente. Com keyBy: 'user', tem orçamento próprio.
    const authB = comoUsuario('conta-isolamento-b');
    const res = await authB(request(app).post('/api/upload').attach('file', PNG_1X1, { filename: 'b.png', contentType: 'image/png' }));
    expect(res.status).toBe(201);
  });
});

describe('rate limit por conta — orçamento COMPARTILHADO entre as 4 rotas', () => {
  it('POST /assets e POST /upload da MESMA conta dividem o mesmo teto (o pool que protegem é compartilhado)', async () => {
    const auth = comoUsuario('conta-compartilhado-1');

    const r1 = await auth(request(app).post('/api/brands/marca/assets').attach('file', PNG_1X1, { filename: 'a.png', contentType: 'image/png' }));
    const r2 = await auth(request(app).post('/api/upload').attach('file', PNG_1X1, { filename: 'b.png', contentType: 'image/png' }));
    const r3 = await auth(request(app).post('/api/brands/marca/assets').attach('file', PNG_1X1, { filename: 'c.png', contentType: 'image/png' }));
    const r4 = await auth(request(app).post('/api/upload').attach('file', PNG_1X1, { filename: 'd.png', contentType: 'image/png' }));
    // A 5ª requisição da conta, em QUALQUER uma das duas rotas, já esbarra no limite —
    // se cada rota tivesse seu PRÓPRIO teto separado, esta ainda passaria (seria a 3ª
    // só de /assets), o que deixaria a mesma conta somar 3+3 = 6 concorrentes contra o
    // pool compartilhado, reproduzindo o próprio blocker B.
    const r5 = await auth(request(app).post('/api/brands/marca/assets').attach('file', PNG_1X1, { filename: 'e.png', contentType: 'image/png' }));

    expect([r1.status, r2.status, r3.status, r4.status]).toEqual([201, 201, 201, 201]);
    expect(r5.status).toBe(429);
  });
});

describe('rate limit por conta — POST /api/upload/logo e POST /brandbook/ingest também estão protegidas', () => {
  it('POST /api/upload/logo: a 5ª requisição da mesma conta recebe 429', async () => {
    const auth = comoUsuario('conta-logo-1');
    const body = { data: PNG_1X1.toString('base64'), mimeType: 'image/png' };

    for (let i = 0; i < 4; i++) {
      const res = await auth(request(app).post('/api/upload/logo').send(body));
      expect(res.status).toBe(200);
    }
    const bloqueada = await auth(request(app).post('/api/upload/logo').send(body));
    expect(bloqueada.status).toBe(429);
  });

  it('POST /api/brands/:slug/brandbook/ingest: a 5ª requisição da mesma conta recebe 429', async () => {
    const auth = comoUsuario('conta-brandbook-1');

    for (let i = 0; i < 4; i++) {
      const res = await auth(
        request(app).post('/api/brands/marca/brandbook/ingest').attach('files', PNG_1X1, { filename: 'a.png', contentType: 'image/png' }),
      );
      expect(res.status).toBe(200);
    }
    const bloqueada = await auth(
      request(app).post('/api/brands/marca/brandbook/ingest').attach('files', PNG_1X1, { filename: 'a.png', contentType: 'image/png' }),
    );
    expect(bloqueada.status).toBe(429);
  });
});

describe('rate limit por conta — fluxo legítimo dentro do limite continua funcionando', () => {
  it('uma conta fazendo 1 upload não é afetada (sem falso positivo)', async () => {
    const auth = comoUsuario('conta-legitima-1');
    const res = await auth(request(app).post('/api/upload').attach('file', PNG_1X1, { filename: 'logo.png', contentType: 'image/png' }));
    expect(res.status).toBe(201);
    expect(res.body.data.url).toContain('logo.png');
  });

  it('brandbook aceitando até 15 arquivos numa ÚNICA requisição não gasta orçamento extra por arquivo', async () => {
    const auth = comoUsuario('conta-legitima-2');
    const arquivos = Array.from({ length: 10 }, (_, i) => ({ name: `logo-${i}.png` }));
    let req = request(app).post('/api/brands/marca/brandbook/ingest');
    for (const a of arquivos) {
      req = req.attach('files', PNG_1X1, { filename: a.name, contentType: 'image/png' });
    }
    const res = await auth(req);
    // 10 arquivos, mas é UMA requisição HTTP: conta só 1 do orçamento de 4.
    expect(res.status).toBe(200);
    expect(mockedIngest).toHaveBeenCalledTimes(1);
    const [{ files }] = mockedIngest.mock.calls[0]!;
    expect(files).toHaveLength(10);
  });
});
