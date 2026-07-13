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

interface ExportStatus {
  jobId: string;
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown';
  done: number;
  total: number;
  result?: ExportResult;
  error?: string;
}

export const EXPORT_POLL_MS = 1500;
/** Teto de segurança: 300 slides * ~4s/slide dá folga sem deixar a UI presa pra sempre. */
export const EXPORT_TIMEOUT_MS = 30 * 60 * 1000;

export async function acompanharExport(
  postId: string,
  jobId: string,
  onProgress?: (done: number, total: number) => void,
  opts: { pollMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ExportResult> {
  const pollMs = opts.pollMs ?? EXPORT_POLL_MS;
  const timeoutMs = opts.timeoutMs ?? EXPORT_TIMEOUT_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = await api.get<ExportStatus>(`/posts/${postId}/export-canva/${jobId}`);

    onProgress?.(status.done, status.total);

    if (status.status === 'completed') {
      if (!status.result) throw new ApiError(500, 'Export concluiu sem resultado.');
      return status.result;
    }
    if (status.status === 'failed') {
      throw new ApiError(500, status.error || 'O export para o Canva falhou.');
    }

    await sleep(pollMs);
  }

  throw new ApiError(504, 'O export para o Canva demorou demais. Ele pode ainda estar rodando no servidor.');
}
