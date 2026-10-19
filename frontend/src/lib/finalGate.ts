import { ApiError } from './api';

// Porta de "final" (Cérebro de IA §2, §4.1, §13): o servidor grava em `content.finalGate` o que
// impede a peça de ser entregue (`blocking`) e o que a pessoa precisa saber (`notes`).

export interface FinalGate {
  blocking: string[];
  notes: string[];
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Lê `finalGate` do envelope do design. Ausente ou vazio = sem pendências. */
export function readFinalGate(design: unknown): FinalGate | null {
  if (typeof design !== 'object' || design === null) return null;
  const raw = (design as { finalGate?: unknown }).finalGate;
  if (typeof raw !== 'object' || raw === null) return null;
  const gate = { blocking: strings((raw as FinalGate).blocking), notes: strings((raw as FinalGate).notes) };
  return gate.blocking.length === 0 && gate.notes.length === 0 ? null : gate;
}

export function isDraftRefusal(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 409 && error.code === 'DRAFT_NOT_FINAL';
}

/**
 * Executa uma entrega (publicar/exportar). Se o servidor recusar por a peça ser rascunho, mostra o
 * motivo e só repete com `confirmarRascunho` se a pessoa confirmar. Recusa da pessoa = `undefined`.
 */
export async function entregarOuConfirmarRascunho<T>(
  executar: (confirmarRascunho: boolean) => Promise<T>,
  perguntar: (mensagem: string) => boolean = (m) => (typeof window !== 'undefined' ? window.confirm(m) : false),
): Promise<T | undefined> {
  try {
    return await executar(false);
  } catch (e) {
    if (!isDraftRefusal(e)) throw e;
    if (!perguntar(`${e.message}\n\nEntregar mesmo assim, como rascunho?`)) return undefined;
    return executar(true);
  }
}
