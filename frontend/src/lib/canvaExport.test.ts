import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return { ...actual, api: { get: vi.fn() } };
});

import { acompanharExport } from './canvaExport';
import { api } from './api';

const get = api.get as unknown as ReturnType<typeof vi.fn>;
const semEspera = { pollMs: 0, sleep: async () => {} };

describe('Acompanhamento do export para o Canva', () => {
  beforeEach(() => vi.clearAllMocks());

  it('faz UMA requisição por consulta até concluir — não uma por slide', async () => {
    get
      .mockResolvedValueOnce({ status: 'active', done: 1, total: 3 })
      .mockResolvedValueOnce({ status: 'active', done: 2, total: 3 })
      .mockResolvedValueOnce({
        status: 'completed',
        done: 3,
        total: 3,
        result: { designId: 'deck', designUrl: 'https://canva.com/deck', slides: 3 },
      });

    const progresso: Array<[number, number]> = [];
    const res = await acompanharExport('post-1', 'job-1', (d, t) => progresso.push([d, t]), semEspera);

    expect(res.designId).toBe('deck');
    expect(res.slides).toBe(3);
    expect(progresso).toEqual([[1, 3], [2, 3], [3, 3]]);
    // 3 consultas para um deck de 3 slides — mas o número de consultas depende do
    // TEMPO, não da quantidade de slides. O laço por slide morreu.
    expect(get).toHaveBeenCalledTimes(3);
    expect(get).toHaveBeenCalledWith('/posts/post-1/export-canva/job-1');
  });

  it('propaga a falha do job com a mensagem do servidor', async () => {
    get.mockResolvedValue({ status: 'failed', done: 1, total: 4, error: 'Canva recusou o upload' });

    await expect(acompanharExport('post-1', 'job-1', undefined, semEspera)).rejects.toThrow(
      'Canva recusou o upload',
    );
  });

  it('não trava para sempre: estoura timeout se o job nunca termina', async () => {
    get.mockResolvedValue({ status: 'active', done: 0, total: 10 });

    await expect(
      acompanharExport('post-1', 'job-1', undefined, { ...semEspera, timeoutMs: 5 }),
    ).rejects.toThrow(/demorou demais/i);
  });

  it('avisa quando o job conclui sem resultado (estado inconsistente)', async () => {
    get.mockResolvedValue({ status: 'completed', done: 2, total: 2 });

    await expect(acompanharExport('post-1', 'job-1', undefined, semEspera)).rejects.toThrow(
      /sem resultado/i,
    );
  });
});
