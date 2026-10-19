// Lote 1C do plano completo: escopo designer.export + export_file, get_export_status, export_to_canva, get_canva_export_status.
// Passam pelo transporte real (POST /mcp) com o OAuth completo do harness; o banco é em memória.
import '../client'; // mocka prisma e redis do processo de teste (precisa vir antes do resto)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type request from 'supertest';
import { prismaMock } from '../client';
import { buildHarness, callTool, connect, mcpPost, type Harness } from './harness';

vi.mock('../../lib/exportJobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/exportJobs')>()),
  requestDeckExport: vi.fn(async () => ({ jobId: 'job-file-1', total: 7 })),
  requestCanvaExport: vi.fn(async () => ({ jobId: 'job-canva-1', total: 7 })),
  readDeckExportStatus: vi.fn(),
  readCanvaExportStatus: vi.fn(),
}));
// Só o link do NOSSO storage chega ao agente: aqui, o prefixo do CDN de teste.
vi.mock('../../lib/r2', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/r2')>()),
  r2KeyFromUrl: (url: string) => (url.startsWith('https://cdn.example.test/') ? url.slice('https://cdn.example.test/'.length) : null),
}));
// O contador é controlado por teste (o mock do Redis não expira janelas); o miolo tem teste próprio.
vi.mock('../../middleware/rateLimit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../middleware/rateLimit')>()),
  consumeRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSec: 0 })),
}));
import {
  CanvaNotConnectedError,
  readCanvaExportStatus,
  readDeckExportStatus,
  requestCanvaExport,
  requestDeckExport,
} from '../../lib/exportJobs';
import { consumeRateLimit } from '../../middleware/rateLimit';
import { EXPORT_RATE_LIMIT } from '../../mcp/tools/exportTools';

let h: Harness;

const result = (res: request.Response) =>
  res.body.result as {
    isError?: boolean;
    content: Array<{ type: string; text: string }>;
    structuredContent?: Record<string, any>;
  };

const POST = '11111111-1111-4111-8111-111111111111';
const post = { id: POST, type: 'PRESENTATION', name: 'Deck', content: {}, slides: [] };

/** Conexão com leitura + exportação, como a tela de consentimento concede. */
const asExporter = (userId = 'user-1') =>
  connect(h, { userId, scope: 'designer.export', scopes: ['designer.read', 'designer.export'], brandSlugs: ['marca-a'] });
const asWriterOnly = () => connect(h, { scope: 'designer.write', scopes: ['designer.write'], brandSlugs: ['marca-a'] });

beforeEach(() => {
  h = buildHarness();
  h.addMember('user-1', 'brand-a', 'EDITOR');
  h.addMember('viewer-1', 'brand-a', 'VIEWER');
  h.addMember('user-1', 'brand-b', 'EDITOR');
  vi.mocked(requestDeckExport).mockClear();
  vi.mocked(requestCanvaExport).mockClear();
  vi.mocked(readDeckExportStatus).mockReset();
  vi.mocked(readCanvaExportStatus).mockReset();
  vi.mocked(consumeRateLimit).mockClear();
  vi.mocked(consumeRateLimit).mockResolvedValue({ allowed: true, retryAfterSec: 0 });
  prismaMock.post.findFirst.mockResolvedValue(post as never);
});

describe('export_file', () => {
  it('enfileira a exportação e devolve o jobId (com leitura + export)', async () => {
    const flow = await asExporter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('export_file', { brandSlug: 'marca-a', postId: POST, format: 'pdf' })));

    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toEqual({ postId: POST, jobId: 'job-file-1', total: 7, status: 'queued' });
    expect(requestDeckExport).toHaveBeenCalledWith(expect.objectContaining({ id: POST }), 'user-1', 'pdf');
    expect(r.content[0]!.text).toMatch(/get_export_status/);
  });

  it('carrega a peça DA MARCA autorizada, com os slides (que a exportação lê)', async () => {
    const flow = await asExporter();
    await mcpPost(h.app, flow.accessToken, callTool('export_file', { brandSlug: 'marca-a', postId: POST, format: 'zip' }));
    const calls = prismaMock.post.findFirst.mock.calls.map((c) => c[0] as { where: Record<string, unknown>; include?: unknown });
    expect(calls.every((c) => (c.where as { brandId: string }).brandId === 'brand-a')).toBe(true);
    expect(calls.some((c) => c.include && (c.include as { slides?: unknown }).slides)).toBe(true);
  });

  it('exige o escopo de exportação: token de escrita sem export é recusado', async () => {
    const flow = await asWriterOnly();
    const res = await mcpPost(h.app, flow.accessToken, callTool('export_file', { brandSlug: 'marca-a', postId: POST, format: 'pdf' }));
    expect(res.status === 403 || result(res)?.isError).toBeTruthy();
    expect(requestDeckExport).not.toHaveBeenCalled();
  });

  it('leitor da marca (VIEWER) pode exportar arquivo, como no app', async () => {
    const flow = await asExporter('viewer-1');
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('export_file', { brandSlug: 'marca-a', postId: POST, format: 'pdf' })));
    expect(r.isError).toBeFalsy();
    expect(requestDeckExport).toHaveBeenCalledWith(expect.anything(), 'viewer-1', 'pdf');
  });

  it.each(['pdf', 'zip', 'pptx', 'html'])('aceita o formato %s', async (format) => {
    const flow = await asExporter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('export_file', { brandSlug: 'marca-a', postId: POST, format })));
    expect(r.isError).toBeFalsy();
  });

  it('recusa formato fora da lista antes de qualquer trabalho', async () => {
    const flow = await asExporter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('export_file', { brandSlug: 'marca-a', postId: POST, format: 'docx' })));
    expect(r.isError).toBe(true);
    expect(requestDeckExport).not.toHaveBeenCalled();
    expect(consumeRateLimit).not.toHaveBeenCalled();
  });

  it('limite de taxa por conta, no mesmo balde para arquivo e Canva', async () => {
    const flow = await asExporter();
    await mcpPost(h.app, flow.accessToken, callTool('export_file', { brandSlug: 'marca-a', postId: POST, format: 'pdf' }));
    expect(consumeRateLimit).toHaveBeenCalledWith(EXPORT_RATE_LIMIT, 'user-1');
    expect(EXPORT_RATE_LIMIT).toMatchObject({ keyPrefix: 'mcp-export', max: 6, windowSec: 60 });
  });

  it('acima do limite: recusa com o tempo de espera e nada vai para a fila', async () => {
    vi.mocked(consumeRateLimit).mockResolvedValueOnce({ allowed: false, retryAfterSec: 42 });
    const flow = await asExporter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('export_file', { brandSlug: 'marca-a', postId: POST, format: 'pdf' })));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/42 s/);
    expect(requestDeckExport).not.toHaveBeenCalled();
  });

  it('peça de outra marca (ou inexistente) é recusada', async () => {
    prismaMock.post.findFirst.mockResolvedValue(null as never);
    const flow = await asExporter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('export_file', { brandSlug: 'marca-a', postId: POST, format: 'pdf' })));
    expect(r.isError).toBe(true);
    expect(requestDeckExport).not.toHaveBeenCalled();
  });

  it('CROSS-TENANT: marca não aprovada no token é recusada', async () => {
    const flow = await asExporter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('export_file', { brandSlug: 'marca-b', postId: POST, format: 'pdf' })));
    expect(r.isError).toBe(true);
    expect(requestDeckExport).not.toHaveBeenCalled();
  });

  it('rejeição do servidor (400) vira frase; erro inesperado não vaza detalhe', async () => {
    vi.mocked(requestDeckExport).mockRejectedValueOnce(Object.assign(new Error('Este design ainda não tem slides.'), { statusCode: 400 }));
    const flow = await asExporter();
    const ruim = result(await mcpPost(h.app, flow.accessToken, callTool('export_file', { brandSlug: 'marca-a', postId: POST, format: 'pdf' })));
    expect(ruim.content[0]!.text).toBe('Este design ainda não tem slides.');

    vi.mocked(requestDeckExport).mockRejectedValueOnce(new Error('connect ECONNREFUSED redis:6379'));
    const interno = result(await mcpPost(h.app, flow.accessToken, callTool('export_file', { brandSlug: 'marca-a', postId: POST, format: 'pdf' })));
    expect(interno.isError).toBe(true);
    expect(interno.content[0]!.text).not.toMatch(/ECONNREFUSED|redis/);
  });
});

describe('get_export_status', () => {
  const args = { brandSlug: 'marca-a', postId: POST, jobId: 'job-file-1' };

  it('na fila e em andamento, com o progresso', async () => {
    vi.mocked(readDeckExportStatus).mockResolvedValueOnce({ jobId: 'job-file-1', status: 'waiting', done: 0, total: 7 });
    const flow = await asExporter();
    const fila = result(await mcpPost(h.app, flow.accessToken, callTool('get_export_status', args)));
    expect(fila.structuredContent).toMatchObject({ status: 'queued', done: 0, total: 7, downloadUrl: null });

    vi.mocked(readDeckExportStatus).mockResolvedValueOnce({ jobId: 'job-file-1', status: 'active', done: 3, total: 7 });
    const rodando = result(await mcpPost(h.app, flow.accessToken, callTool('get_export_status', args)));
    expect(rodando.structuredContent).toMatchObject({ status: 'running', done: 3, total: 7 });
    expect(rodando.content[0]!.text).toMatch(/3\/7/);
  });

  it('pronto: devolve o link do nosso storage, o nome e o formato', async () => {
    vi.mocked(readDeckExportStatus).mockResolvedValue({
      jobId: 'job-file-1', status: 'completed', done: 7, total: 7,
      result: { url: 'https://cdn.example.test/exports/abc-Deck.pdf', fileName: 'Deck.pdf', format: 'pdf', slides: 7 },
    });
    const flow = await asExporter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('get_export_status', args)));
    expect(r.structuredContent).toMatchObject({ status: 'done', downloadUrl: 'https://cdn.example.test/exports/abc-Deck.pdf', fileName: 'Deck.pdf', format: 'pdf', error: null });
    expect(r.content[0]!.text).toMatch(/Deck\.pdf/);
  });

  it('resultado com URL de FORA do nosso storage não chega ao agente', async () => {
    vi.mocked(readDeckExportStatus).mockResolvedValue({
      jobId: 'job-file-1', status: 'completed', done: 7, total: 7,
      result: { url: 'https://evil.example/x.pdf', fileName: 'x.pdf', format: 'pdf' },
    });
    const flow = await asExporter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('get_export_status', args)));
    expect(r.structuredContent).toMatchObject({ status: 'done', downloadUrl: null, fileName: null });
    expect(JSON.stringify(r)).not.toContain('evil.example');
  });

  it('falhou: frase genérica, sem o motivo interno do worker', async () => {
    vi.mocked(readDeckExportStatus).mockResolvedValue({
      jobId: 'job-file-1', status: 'failed', done: 2, total: 7, error: 'Error: ENOENT /app/tmp/chromium-123 at Page.goto (/app/node_modules/puppeteer)',
    });
    const flow = await asExporter();
    const res = await mcpPost(h.app, flow.accessToken, callTool('get_export_status', args));
    const r = result(res);
    expect(r.structuredContent).toMatchObject({ status: 'failed' });
    expect(r.structuredContent!.error).toMatch(/falhou/);
    expect(JSON.stringify(res.body)).not.toMatch(/ENOENT|chromium|puppeteer|node_modules/);
  });

  it('só quem pediu lê o job: o userId da conexão e a peça vão para a verificação', async () => {
    vi.mocked(readDeckExportStatus).mockResolvedValue({ jobId: 'job-file-1', status: 'active', done: 1, total: 7 });
    const flow = await asExporter();
    await mcpPost(h.app, flow.accessToken, callTool('get_export_status', args));
    expect(readDeckExportStatus).toHaveBeenCalledWith('job-file-1', 'user-1', POST);
  });

  it('job de outro usuário (403 da lib) vira frase, sem confirmar nada', async () => {
    vi.mocked(readDeckExportStatus).mockRejectedValue(Object.assign(new Error('Este export não pertence a você.'), { statusCode: 403 }));
    const flow = await asExporter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('get_export_status', args)));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe('Este export não pertence a você.');
  });

  it('é leitura: não consome o limite de pedidos e exige o escopo de export', async () => {
    vi.mocked(readDeckExportStatus).mockResolvedValue({ jobId: 'job-file-1', status: 'active', done: 1, total: 7 });
    const flow = await asExporter();
    await mcpPost(h.app, flow.accessToken, callTool('get_export_status', args));
    expect(consumeRateLimit).not.toHaveBeenCalled();

    const sem = await asWriterOnly();
    const res = await mcpPost(h.app, sem.accessToken, callTool('get_export_status', args));
    expect(res.status === 403 || result(res)?.isError).toBeTruthy();
  });
});

describe('export_to_canva', () => {
  const args = { brandSlug: 'marca-a', postId: POST };

  it('enfileira (png por padrão) e devolve o jobId', async () => {
    const flow = await asExporter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('export_to_canva', args)));
    expect(r.structuredContent).toEqual({ postId: POST, jobId: 'job-canva-1', total: 7, mode: 'png', status: 'queued' });
    expect(requestCanvaExport).toHaveBeenCalledWith(expect.objectContaining({ id: POST }), 'user-1', { mode: 'png', slideIndex: undefined });
  });

  it('modo pptx e slide a partir de 1 (vira índice 0-based)', async () => {
    const flow = await asExporter();
    await mcpPost(h.app, flow.accessToken, callTool('export_to_canva', { ...args, mode: 'png', slide: 3 }));
    expect(requestCanvaExport).toHaveBeenLastCalledWith(expect.anything(), 'user-1', { mode: 'png', slideIndex: 2 });
    await mcpPost(h.app, flow.accessToken, callTool('export_to_canva', { ...args, mode: 'pptx' }));
    expect(requestCanvaExport).toHaveBeenLastCalledWith(expect.anything(), 'user-1', { mode: 'pptx', slideIndex: undefined });
  });

  it('leitor (VIEWER) NÃO exporta para o Canva, mesmo com o escopo — como no app (EDITORS)', async () => {
    const flow = await asExporter('viewer-1');
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('export_to_canva', args)));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/editor, administrador ou dono/);
    expect(requestCanvaExport).not.toHaveBeenCalled();
    expect(consumeRateLimit).not.toHaveBeenCalled(); // recusado antes de gastar o orçamento
  });

  it('Canva não conectado: orienta o usuário, sem erro interno', async () => {
    vi.mocked(requestCanvaExport).mockRejectedValueOnce(new CanvaNotConnectedError());
    const flow = await asExporter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('export_to_canva', args)));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/Integrações/);
  });

  it('slide fora do limite (400 da lib) vira frase', async () => {
    vi.mocked(requestCanvaExport).mockRejectedValueOnce(Object.assign(new Error('slideIndex fora do limite'), { statusCode: 400 }));
    const flow = await asExporter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('export_to_canva', { ...args, slide: 60 })));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe('slideIndex fora do limite');
  });

  it('usa o mesmo limite de taxa e exige o escopo de export', async () => {
    const flow = await asExporter();
    await mcpPost(h.app, flow.accessToken, callTool('export_to_canva', args));
    expect(consumeRateLimit).toHaveBeenCalledWith(EXPORT_RATE_LIMIT, 'user-1');

    const sem = await asWriterOnly();
    const res = await mcpPost(h.app, sem.accessToken, callTool('export_to_canva', args));
    expect(res.status === 403 || result(res)?.isError).toBeTruthy();
  });

  it('modo desconhecido é recusado', async () => {
    const flow = await asExporter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('export_to_canva', { ...args, mode: 'jpg' })));
    expect(r.isError).toBe(true);
    expect(requestCanvaExport).not.toHaveBeenCalled();
  });
});

describe('get_canva_export_status', () => {
  const args = { brandSlug: 'marca-a', postId: POST, jobId: 'job-canva-1' };

  it('pronto: link do design (https) e ids', async () => {
    vi.mocked(readCanvaExportStatus).mockResolvedValue({
      jobId: 'job-canva-1', status: 'completed', done: 7, total: 7,
      result: { designId: 'D1', designUrl: 'https://www.canva.com/design/D1/edit', slides: 7 },
    });
    const flow = await asExporter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('get_canva_export_status', args)));
    expect(r.structuredContent).toMatchObject({ status: 'done', designUrl: 'https://www.canva.com/design/D1/edit', designIds: ['D1'], error: null });
    expect(r.content[0]!.text).toMatch(/canva\.com/);
  });

  it('um design por slide (fallback): devolve todos os ids', async () => {
    vi.mocked(readCanvaExportStatus).mockResolvedValue({
      jobId: 'job-canva-1', status: 'completed', done: 3, total: 3,
      result: { designId: 'D1', designIds: ['D1', 'D2', 'D3'], mergeFallback: true },
    });
    const flow = await asExporter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('get_canva_export_status', args)));
    expect(r.structuredContent).toMatchObject({ status: 'done', designUrl: null, designIds: ['D1', 'D2', 'D3'] });
    expect(r.content[0]!.text).toMatch(/3 design/);
  });

  it('link que não é https não chega ao agente', async () => {
    vi.mocked(readCanvaExportStatus).mockResolvedValue({
      jobId: 'job-canva-1', status: 'completed', done: 1, total: 1,
      result: { designId: 'D1', designUrl: 'javascript:alert(1)' },
    });
    const flow = await asExporter();
    const res = await mcpPost(h.app, flow.accessToken, callTool('get_canva_export_status', args));
    expect(result(res).structuredContent!.designUrl).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('javascript:');
  });

  it('em andamento e falha (genérica)', async () => {
    vi.mocked(readCanvaExportStatus).mockResolvedValueOnce({ jobId: 'job-canva-1', status: 'active', done: 2, total: 7 });
    const flow = await asExporter();
    const rodando = result(await mcpPost(h.app, flow.accessToken, callTool('get_canva_export_status', args)));
    expect(rodando.structuredContent).toMatchObject({ status: 'running', done: 2, total: 7 });

    vi.mocked(readCanvaExportStatus).mockResolvedValueOnce({ jobId: 'job-canva-1', status: 'failed', done: 2, total: 7, error: 'Canva API 401: token abc.def.ghi expired' });
    const res = await mcpPost(h.app, flow.accessToken, callTool('get_canva_export_status', args));
    expect(result(res).structuredContent).toMatchObject({ status: 'failed' });
    expect(JSON.stringify(res.body)).not.toMatch(/abc\.def\.ghi|Canva API 401/);
  });

  it('job de outro usuário vira frase; a conexão e a peça vão para a verificação', async () => {
    vi.mocked(readCanvaExportStatus).mockRejectedValue(Object.assign(new Error('Este export não pertence a você.'), { statusCode: 403 }));
    const flow = await asExporter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('get_canva_export_status', args)));
    expect(r.isError).toBe(true);
    expect(readCanvaExportStatus).toHaveBeenCalledWith('job-canva-1', 'user-1', POST);
  });
});

describe('porta de rascunho nas exportações (texto em revisão)', () => {
  const rascunho = {
    ...post,
    content: { kind: 'html-design', finalGate: { blocking: ['Há texto marcado como "em revisão".'], notes: [] } },
  };
  beforeEach(() => {
    prismaMock.post.findFirst.mockResolvedValue(rascunho as never);
  });

  it('export_file recusa, explica o motivo e não enfileira', async () => {
    const flow = await asExporter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('export_file', { brandSlug: 'marca-a', postId: POST, format: 'pdf' })));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('em revisão');
    expect(r.content[0]!.text).toContain('confirmarRascunho');
    expect(requestDeckExport).not.toHaveBeenCalled();
  });

  it('export_file com confirmarRascunho entrega como rascunho', async () => {
    const flow = await asExporter();
    const r = result(
      await mcpPost(h.app, flow.accessToken, callTool('export_file', { brandSlug: 'marca-a', postId: POST, format: 'pdf', confirmarRascunho: true })),
    );
    expect(r.isError).toBeFalsy();
    expect(requestDeckExport).toHaveBeenCalledTimes(1);
  });

  it('export_to_canva recusa antes de pedir a exportação', async () => {
    const flow = await asExporter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('export_to_canva', { brandSlug: 'marca-a', postId: POST })));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('em revisão');
    expect(requestCanvaExport).not.toHaveBeenCalled();
  });

  it('export_to_canva com confirmarRascunho segue', async () => {
    const flow = await asExporter();
    const r = result(
      await mcpPost(h.app, flow.accessToken, callTool('export_to_canva', { brandSlug: 'marca-a', postId: POST, confirmarRascunho: true })),
    );
    expect(r.isError).toBeFalsy();
    expect(requestCanvaExport).toHaveBeenCalledTimes(1);
  });

  it('só notas (sem bloqueio) não impedem a exportação', async () => {
    prismaMock.post.findFirst.mockResolvedValue({ ...post, content: { finalGate: { blocking: [], notes: ['Falta definir: x.'] } } } as never);
    const flow = await asExporter();
    const r = result(await mcpPost(h.app, flow.accessToken, callTool('export_file', { brandSlug: 'marca-a', postId: POST, format: 'zip' })));
    expect(r.isError).toBeFalsy();
  });
});
