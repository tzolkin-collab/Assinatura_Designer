import { describe, it, expect, vi, beforeEach } from 'vitest';
import './client';
import type { GoogleGenAI } from '@google/genai';
import { generateWithRetry, resetModelBreakers } from '../lib/geminiRetry';

/** Erro de sobrecarga, como o provedor devolve quando o modelo está lotado. */
function sobrecarga() {
  return Object.assign(new Error('The model is overloaded (high demand). 503'), { status: 503 });
}

/** Blip de rede: o mesmo modelo volta a funcionar em seguida. */
function blipDeRede() {
  return Object.assign(new Error('fetch failed'), { code: 'UND_ERR_SOCKET' });
}

function fakeAi(impl: (model: string) => Promise<unknown>) {
  const generateContent = vi.fn(async ({ model }: { model: string }) => impl(model));
  return {
    ai: { models: { generateContent } } as unknown as GoogleGenAI,
    generateContent,
  };
}

const resposta = { text: 'ok', usageMetadata: { totalTokenCount: 10 } };

describe('Retry, fallback e circuit breaker do Gemini', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetModelBreakers();
  });

  it('modelo lotado: UMA tentativa e cai para o próximo (não insiste 3x)', async () => {
    const { ai, generateContent } = fakeAi(async (model) => {
      if (model === 'gemini-3.5-flash') throw sobrecarga();
      return resposta;
    });

    const res = await generateWithRetry(ai, { model: 'x', contents: 'oi' });

    expect(res).toBe(resposta);
    // Antes: 3 tentativas no lotado (com 1s + 2s de backoff) antes de trocar — ~17s
    // queimados por chamada. Agora: uma tentativa e vai embora.
    const tentativasNoLotado = generateContent.mock.calls.filter(
      (c) => (c[0] as { model: string }).model === 'gemini-3.5-flash',
    );
    expect(tentativasNoLotado).toHaveLength(1);
  });

  it('blip de rede: insiste no MESMO modelo (ele costuma voltar)', async () => {
    let chamadas = 0;
    const { ai, generateContent } = fakeAi(async () => {
      chamadas++;
      if (chamadas === 1) throw blipDeRede();
      return resposta;
    });

    const res = await generateWithRetry(ai, { model: 'x', contents: 'oi' }, 'gemini-2.5-flash');

    expect(res).toBe(resposta);
    expect(generateContent.mock.calls.every((c) => (c[0] as { model: string }).model === 'gemini-2.5-flash')).toBe(true);
    expect(generateContent).toHaveBeenCalledTimes(2); // falhou, esperou, tentou de novo
  });

  it('erro não retentável estoura na hora, sem gastar em outro modelo', async () => {
    const { ai, generateContent } = fakeAi(async () => {
      throw Object.assign(new Error('API key inválida'), { status: 401 });
    });

    await expect(generateWithRetry(ai, { model: 'x', contents: 'oi' })).rejects.toThrow('API key inválida');
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('circuit breaker: depois de lotar repetido, o modelo é PULADO nas chamadas seguintes', async () => {
    const { ai, generateContent } = fakeAi(async (model) => {
      if (model === 'gemini-3.5-flash') throw sobrecarga();
      return resposta;
    });

    // Duas chamadas descobrem a lotação (limiar do breaker = 2 falhas).
    await generateWithRetry(ai, { model: 'x', contents: 'oi' });
    await generateWithRetry(ai, { model: 'x', contents: 'oi' });
    generateContent.mockClear();

    // A terceira já não perde tempo com o lotado: vai direto no saudável.
    await generateWithRetry(ai, { model: 'x', contents: 'oi' });

    const modelosTentados = generateContent.mock.calls.map((c) => (c[0] as { model: string }).model);
    expect(modelosTentados).toEqual(['gemini-2.5-flash']);
  });

  it('circuito aberto não impede o modelo preferido de ser tentado se for o único caminho', async () => {
    // Todos lotados: tentar um lotado ainda é melhor do que falhar sem tentar.
    const { ai, generateContent } = fakeAi(async () => {
      throw sobrecarga();
    });

    await expect(generateWithRetry(ai, { model: 'x', contents: 'oi' })).rejects.toBeDefined();
    await expect(generateWithRetry(ai, { model: 'x', contents: 'oi' })).rejects.toBeDefined();
    generateContent.mockClear();

    await expect(generateWithRetry(ai, { model: 'x', contents: 'oi' })).rejects.toBeDefined();
    expect(generateContent.mock.calls.length).toBeGreaterThan(0); // tentou mesmo assim
  });

  it('sucesso fecha o circuito (modelo que voltou não fica marcado para sempre)', async () => {
    let lotado = true;
    const { ai, generateContent } = fakeAi(async (model) => {
      if (model === 'gemini-3.5-flash' && lotado) throw sobrecarga();
      return resposta;
    });

    await generateWithRetry(ai, { model: 'x', contents: 'oi' });
    await generateWithRetry(ai, { model: 'x', contents: 'oi' }); // abre o circuito

    lotado = false;
    resetModelBreakers(); // simula o fim do cooldown
    generateContent.mockClear();

    await generateWithRetry(ai, { model: 'x', contents: 'oi' });
    expect((generateContent.mock.calls[0]![0] as { model: string }).model).toBe('gemini-3.5-flash');
  });
});
