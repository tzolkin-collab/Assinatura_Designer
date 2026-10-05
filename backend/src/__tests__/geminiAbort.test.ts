import { describe, it, expect, vi, beforeEach } from 'vitest';
import './client';
import type { GoogleGenAI } from '@google/genai';
import { generateStreamWithRetry, GenerationAbortedError, resetModelBreakers } from '../lib/geminiRetry';
import { resetThrottle } from '../lib/aiThrottle';

// "Pausar e enviar" no cérebro aborta o stream pelo AbortSignal. O AbortError do fetch
// é classificado como TIMEOUT (retentável): sem o tratamento próprio, o laço de retry
// esperaria, avisaria "tentando novamente" e refaria no modelo irmão a resposta que o
// usuário acabou de mandar parar.

function fakeAi(generateContentStream: (params: any) => Promise<unknown>): GoogleGenAI {
  return { models: { generateContentStream } } as unknown as GoogleGenAI;
}
const params = { model: 'gemini-2.5-flash', contents: 'oi', config: {} } as any;
const abortError = () => Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });

beforeEach(() => {
  resetModelBreakers();
  resetThrottle();
});

describe('generateStreamWithRetry com abortSignal do usuário', () => {
  it('sinal já abortado: nem chama o modelo', async () => {
    const chamar = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(generateStreamWithRetry(fakeAi(chamar), params, undefined, { abortSignal: controller.signal }))
      .rejects.toBeInstanceOf(GenerationAbortedError);
    expect(chamar).not.toHaveBeenCalled();
  });

  it('aborto DURANTE a conexão: erro próprio, UMA chamada só, sem retry nem fallback nem aviso', async () => {
    const controller = new AbortController();
    const chamar = vi.fn(async () => { controller.abort(); throw abortError(); });
    const onRetry = vi.fn();
    const onFallback = vi.fn();

    await expect(generateStreamWithRetry(fakeAi(chamar), params, undefined, {
      abortSignal: controller.signal, onRetry, onFallback,
    })).rejects.toBeInstanceOf(GenerationAbortedError);

    expect(chamar).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('o sinal do usuário se SOMA ao timeout (não o substitui) na chamada ao SDK', async () => {
    const controller = new AbortController();
    let recebido: AbortSignal | undefined;
    const chamar = vi.fn(async (p: any) => {
      recebido = p.config.abortSignal;
      return (async function* () { /* stream vazio */ })();
    });

    const stream = await generateStreamWithRetry(fakeAi(chamar), params, undefined, { abortSignal: controller.signal });
    for await (const _ of stream) { /* consome */ }

    expect(recebido).toBeDefined();
    expect(recebido!.aborted).toBe(false);
    controller.abort();
    expect(recebido!.aborted).toBe(true); // o abort do usuário propaga pelo sinal combinado
  });

  it('sem sinal do usuário nada muda: timeout continua sendo o único sinal e AbortError segue retentável', async () => {
    let n = 0;
    const chamar = vi.fn(async () => {
      n++;
      if (n === 1) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      return (async function* () { /* ok */ })();
    });
    vi.useFakeTimers();
    const p = generateStreamWithRetry(fakeAi(chamar), params);
    await vi.runAllTimersAsync();
    await p;
    vi.useRealTimers();
    expect(chamar).toHaveBeenCalledTimes(2);
  });
});
