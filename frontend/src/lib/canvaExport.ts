import { api, ApiError } from './api';

/**
 * Acompanha um job de export para o Canva.
 *
 * O export deixou de ser um laço de N requisições no navegador (uma por slide,
 * cada uma segurando um render full-res no servidor) e virou um job na fila. Aqui
 * só perguntamos o progresso até terminar.
 */

export interface ExportResult {
  designId: string;
  designUrl?: string;
  slides: number;
  mergeFallback?: boolean;
  designIds?: string[];
}

interface ExportStatus<T> {
  jobId: string;
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown';
  done: number;
  total: number;
  result?: T;
  error?: string;
}

export const EXPORT_POLL_MS = 1500;
/** Teto de segurança: 300 slides * ~4s/slide dá folga sem deixar a UI presa pra sempre. */
export const EXPORT_TIMEOUT_MS = 30 * 60 * 1000;

export interface AcompanharOpts {
  pollMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Poller genérico de job de export. Serve tanto o Canva quanto o download do deck
 * como arquivo (PDF/ZIP) — as duas filas expõem o MESMO shape de status, e duplicar
 * este laço só garantiria que um dos dois envelheceria sozinho.
 */
export async function acompanharJobDeExport<T>(
  statusPath: (jobId: string) => string,
  jobId: string,
  onProgress?: (done: number, total: number) => void,
  opts: AcompanharOpts & { erroPadrao?: string } = {},
): Promise<T> {
  const pollMs = opts.pollMs ?? EXPORT_POLL_MS;
  const timeoutMs = opts.timeoutMs ?? EXPORT_TIMEOUT_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const erroPadrao = opts.erroPadrao ?? 'O export falhou.';

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = await api.get<ExportStatus<T>>(statusPath(jobId));

    onProgress?.(status.done, status.total);

    if (status.status === 'completed') {
      if (status.result) return status.result;
      // O servidor pode ter lido o estado 'completed' antes de o resultado estar
      // visível (corrida de leitura no BullMQ). Não é falha: consulta de novo.
      await sleep(pollMs);
      continue;
    }
    if (status.status === 'failed') {
      throw new ApiError(500, status.error || erroPadrao);
    }

    await sleep(pollMs);
  }

  throw new ApiError(504, 'O export demorou demais. Ele pode ainda estar rodando no servidor.');
}

export async function acompanharExport(
  postId: string,
  jobId: string,
  onProgress?: (done: number, total: number) => void,
  opts: AcompanharOpts = {},
): Promise<ExportResult> {
  return acompanharJobDeExport<ExportResult>(
    (id) => `/posts/${postId}/export-canva/${id}`,
    jobId,
    onProgress,
    { ...opts, erroPadrao: 'O export para o Canva falhou.' },
  );
}
