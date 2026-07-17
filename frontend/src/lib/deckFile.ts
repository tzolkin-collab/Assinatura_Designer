// O deck como ARQUIVO — do lado do navegador.
//
// Até aqui a arte gerada só existia como preview na tela: para levar uma apresentação
// a uma reunião não havia arquivo nenhum. Aqui ficam os quatro downloads que a Fábrica
// (e a galeria) oferecem, e o polling do job pesado.

import { api, ApiError, API_BASE } from './api';
import { acompanharJobDeExport, type AcompanharOpts } from './canvaExport';

export type DeckFileFormat = 'pdf' | 'zip' | 'pptx';

export interface DeckExportResult {
  url: string;
  fileName: string;
  format: DeckFileFormat;
  slides: number;
}

/** Dispara o download de uma URL sem tirar o usuário da página. */
function baixarUrl(url: string, fileName?: string): void {
  const a = document.createElement('a');
  a.href = url;
  if (fileName) a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Baixa um Blob já em memória (usado pelo PNG/HTML/JSON, que são imediatos). */
function baixarBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  baixarUrl(url, fileName);
  // Revogar já: o clique é síncrono e o navegador só precisa da URL até ali.
  URL.revokeObjectURL(url);
}

/**
 * PNG ou HTML de UM slide. Vai direto ao endpoint (que devolve o binário) em vez de
 * passar pelo `api.get`, que assume JSON. Funciona no meio de uma geração: o slide já
 * está persistido assim que aparece na tela.
 */
export async function baixarSlide(
  postId: string,
  slideIndex: number,
  formato: 'png' | 'html',
): Promise<void> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const resp = await fetch(
    `${API_BASE}/posts/${postId}/export?slide=${slideIndex}&format=${formato}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );

  if (!resp.ok) {
    throw new ApiError(resp.status, `Não consegui baixar o slide ${slideIndex + 1}.`);
  }

  baixarBlob(await resp.blob(), `slide-${slideIndex + 1}.${formato}`);
}

/** O DesignIR do deck, como arquivo. É o "ver a fonte" — o dado já está na tela. */
export function baixarIrJson(design: unknown, postId?: string): void {
  const blob = new Blob([JSON.stringify(design, null, 2)], { type: 'application/json' });
  baixarBlob(blob, `design-${(postId ?? 'deck').slice(0, 8)}.json`);
}

/**
 * PDF ou ZIP do deck inteiro. É trabalho pesado (um render de chromium por slide),
 * então roda como job na fila: aqui só enfileiramos, acompanhamos o progresso e
 * baixamos o arquivo pronto.
 */
export async function exportarDeck(
  postId: string,
  format: DeckFileFormat,
  onProgress?: (done: number, total: number) => void,
  opts: AcompanharOpts = {},
): Promise<DeckExportResult> {
  const { jobId } = await api.post<{ jobId: string; total: number }>(
    `/posts/${postId}/export-file`,
    { format },
  );

  const resultado = await acompanharJobDeExport<DeckExportResult>(
    (id) => `/posts/${postId}/export-file/${id}`,
    jobId,
    onProgress,
    { ...opts, erroPadrao: `Não consegui gerar o ${format.toUpperCase()} do deck.` },
  );

  // Download via PROXY do backend (mesma origem): a URL do R2 é cross-origin e
  // o navegador ignora o atributo `download` do <a> — o clique não vira arquivo.
  // O proxy manda Content-Disposition: attachment e o Bearer vai no header.
  try {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    const resp = await fetch(`${API_BASE}/posts/${postId}/export-file/${jobId}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) throw new Error(`proxy ${resp.status}`);
    baixarBlob(await resp.blob(), resultado.fileName);
  } catch {
    // Fallback: navegação direta para o R2 (pode abrir em vez de baixar).
    baixarUrl(resultado.url, resultado.fileName);
  }
  return resultado;
}
