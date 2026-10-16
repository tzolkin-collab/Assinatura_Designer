// exportJobs: pedir e acompanhar exportações (arquivo e Canva), compartilhado pelas rotas do editor e pelo MCP.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock } from './client';
import {
  CanvaNotConnectedError,
  readCanvaExportStatus,
  readDeckExportStatus,
  requestCanvaExport,
  requestDeckExport,
  type ExportablePost,
} from '../lib/exportJobs';

vi.mock('../lib/queue', () => ({
  enqueueDeckExport: vi.fn(async () => 'deck-job-1'),
  enqueueCanvaExport: vi.fn(async () => 'canva-job-1'),
  deckExportQueue: { getJob: vi.fn() },
  canvaExportQueue: { getJob: vi.fn() },
}));
vi.mock('../lib/renderableDeck', () => ({ resolveRenderableDeckWithFonts: vi.fn() }));
import { canvaExportQueue, deckExportQueue, enqueueCanvaExport, enqueueDeckExport } from '../lib/queue';
import { resolveRenderableDeckWithFonts } from '../lib/renderableDeck';

const post = { id: 'post-1', content: { kind: 'html-design' }, slides: [] } as unknown as ExportablePost;
const deckOf = (count: number) => ({ count }) as never;

const job = (over: Record<string, unknown> = {}) => ({
  data: { userId: 'u1', postId: 'post-1' },
  progress: { done: 2, total: 5 },
  returnvalue: null as unknown,
  failedReason: undefined as string | undefined,
  getState: vi.fn(async () => 'active'),
  ...over,
});

describe('requestDeckExport', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enfileira com o dono do pedido e devolve a contagem de slides', async () => {
    vi.mocked(resolveRenderableDeckWithFonts).mockResolvedValue(deckOf(7));
    expect(await requestDeckExport(post, 'u1', 'pdf')).toEqual({ jobId: 'deck-job-1', total: 7 });
    expect(enqueueDeckExport).toHaveBeenCalledWith({ postId: 'post-1', userId: 'u1', format: 'pdf' });
  });

  it('design que não é html-design: 400, nada na fila', async () => {
    vi.mocked(resolveRenderableDeckWithFonts).mockResolvedValue(null as never);
    await expect(requestDeckExport(post, 'u1', 'pdf')).rejects.toMatchObject({ statusCode: 400 });
    expect(enqueueDeckExport).not.toHaveBeenCalled();
  });

  it('deck sem slides: 400, nada na fila', async () => {
    vi.mocked(resolveRenderableDeckWithFonts).mockResolvedValue(deckOf(0));
    await expect(requestDeckExport(post, 'u1', 'zip')).rejects.toMatchObject({ statusCode: 400 });
    expect(enqueueDeckExport).not.toHaveBeenCalled();
  });
});

describe('requestCanvaExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveRenderableDeckWithFonts).mockResolvedValue(deckOf(5));
    prismaMock.user.findUnique.mockResolvedValue({ canvaAccessToken: 'tok' } as never);
  });

  it('sem Canva conectado lança o erro tipado e não enfileira (o job morreria no worker)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ canvaAccessToken: null } as never);
    await expect(requestCanvaExport(post, 'u1', {})).rejects.toBeInstanceOf(CanvaNotConnectedError);
    expect(enqueueCanvaExport).not.toHaveBeenCalled();
  });

  it('a conta de Canva é a de quem pede, não a da marca', async () => {
    await requestCanvaExport(post, 'u7', {});
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u7' }, select: { canvaAccessToken: true } });
  });

  it('deck inteiro: total = nº de slides', async () => {
    expect(await requestCanvaExport(post, 'u1', { mode: 'png' })).toEqual({ jobId: 'canva-job-1', total: 5 });
    expect(enqueueCanvaExport).toHaveBeenCalledWith({ postId: 'post-1', userId: 'u1', slideIndex: undefined, mode: 'png' });
  });

  it('um slide no modo png: total 1 e o índice vai para a fila', async () => {
    expect(await requestCanvaExport(post, 'u1', { mode: 'png', slideIndex: 2 })).toMatchObject({ total: 1 });
    expect(enqueueCanvaExport).toHaveBeenCalledWith(expect.objectContaining({ slideIndex: 2 }));
  });

  it('pptx exporta sempre o deck inteiro: o slideIndex é descartado', async () => {
    expect(await requestCanvaExport(post, 'u1', { mode: 'pptx', slideIndex: 2 })).toMatchObject({ total: 5 });
    expect(enqueueCanvaExport).toHaveBeenCalledWith(expect.objectContaining({ slideIndex: undefined, mode: 'pptx' }));
  });

  it.each([5, -1])('slideIndex %i fora do limite: 400', async (slideIndex) => {
    await expect(requestCanvaExport(post, 'u1', { slideIndex })).rejects.toMatchObject({ statusCode: 400 });
    expect(enqueueCanvaExport).not.toHaveBeenCalled();
  });

  it('design que não é html-design: 400', async () => {
    vi.mocked(resolveRenderableDeckWithFonts).mockResolvedValue(null as never);
    await expect(requestCanvaExport(post, 'u1', {})).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe.each([
  ['arquivo', readDeckExportStatus, deckExportQueue],
  ['Canva', readCanvaExportStatus, canvaExportQueue],
])('progresso do export (%s)', (_nome, read, queue) => {
  const getJob = queue.getJob as unknown as ReturnType<typeof vi.fn>;
  beforeEach(() => getJob.mockReset());

  it('job em andamento: estado e progresso', async () => {
    getJob.mockResolvedValue(job());
    expect(await read('j1', 'u1', 'post-1')).toEqual({ jobId: 'j1', status: 'active', done: 2, total: 5, result: undefined, error: undefined });
  });

  it('job inexistente: 404', async () => {
    getJob.mockResolvedValue(undefined);
    await expect(read('j1', 'u1', 'post-1')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('export de OUTRO usuário: 403 (não vaza o link)', async () => {
    getJob.mockResolvedValue(job({ data: { userId: 'outro', postId: 'post-1' } }));
    await expect(read('j1', 'u1', 'post-1')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('job de outra peça: 403', async () => {
    getJob.mockResolvedValue(job({ data: { userId: 'u1', postId: 'post-9' } }));
    await expect(read('j1', 'u1', 'post-1')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('completo: devolve o resultado', async () => {
    getJob.mockResolvedValue(job({ getState: vi.fn(async () => 'completed'), returnvalue: { url: 'https://cdn/x.pdf' } }));
    expect(await read('j1', 'u1', 'post-1')).toMatchObject({ status: 'completed', result: { url: 'https://cdn/x.pdf' } });
  });

  it('corrida getJob→getState: completo sem returnvalue relê o job', async () => {
    getJob
      .mockResolvedValueOnce(job({ getState: vi.fn(async () => 'completed'), returnvalue: null }))
      .mockResolvedValueOnce(job({ returnvalue: { url: 'https://cdn/y.pdf' } }));
    expect(await read('j1', 'u1', 'post-1')).toMatchObject({ result: { url: 'https://cdn/y.pdf' } });
    expect(getJob).toHaveBeenCalledTimes(2);
  });

  it('falhou: devolve o motivo; o resultado fica de fora', async () => {
    getJob.mockResolvedValue(job({ getState: vi.fn(async () => 'failed'), failedReason: 'timeout', returnvalue: { url: 'x' } }));
    expect(await read('j1', 'u1', 'post-1')).toMatchObject({ status: 'failed', error: 'timeout', result: undefined });
  });
});
