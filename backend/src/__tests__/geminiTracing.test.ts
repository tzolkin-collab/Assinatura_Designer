import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateWithRetry } from '../lib/geminiRetry.js';
import { GoogleGenAI } from '@google/genai';
import { runWithAiContext } from '../lib/aiContext.js';
import * as tracing from '../lib/generationTracing.js';

vi.mock('../lib/aiBudget.js', () => ({
  assertWithinBudget: vi.fn().mockResolvedValue(undefined),
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/generationTracing.js', () => ({
  recordStep: vi.fn(),
  ensureRun: vi.fn().mockResolvedValue('run-de-teste'),
}));

function fakeAi(): GoogleGenAI {
  return {
    models: {
      generateContent: vi.fn().mockResolvedValue({
        text: 'Mock response',
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
      }),
    },
  } as unknown as GoogleGenAI;
}

describe('generateWithRetry — trace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tracing.ensureRun).mockResolvedValue('run-de-teste');
  });

  it('grava o step com o runId, os tokens e o modelo que respondeu', async () => {
    await runWithAiContext({ brandSlug: 'marca', feature: 'pipeline' }, async () => {
      const res = await generateWithRetry(fakeAi(), { model: 'gemini-2.5-flash', contents: 'Test prompt' });
      expect(res.text).toBe('Mock response');
    });

    expect(tracing.recordStep).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-de-teste',
        kind: 'MODEL',
        model: 'gemini-2.5-flash',
        inputTokens: 10,
        outputTokens: 20,
      }),
    );
  });

  it('não grava step nenhum quando não há run — em vez de gravar com id órfão', async () => {
    // Sem run aberto, um step com runId inventado violaria a FK e sumiria no
    // fail-open. Melhor não gravar: o silêncio aqui é intencional.
    vi.mocked(tracing.ensureRun).mockResolvedValue(null);

    await runWithAiContext({ feature: 'utility' }, async () => {
      const res = await generateWithRetry(fakeAi(), { model: 'gemini-2.5-flash', contents: 'x' });
      expect(res.text).toBe('Mock response');
    });

    expect(tracing.recordStep).not.toHaveBeenCalled();
  });

  it('a geração sobrevive quando o trace explode', async () => {
    vi.mocked(tracing.recordStep).mockImplementationOnce(() => { throw new Error('DB DOWN'); });

    await runWithAiContext({ brandSlug: 'marca', feature: 'pipeline' }, async () => {
      const res = await generateWithRetry(fakeAi(), { model: 'gemini-2.5-flash', contents: 'x' });
      // O ponto do fail-open: o resultado do modelo chega mesmo com o banco fora.
      expect(res.text).toBe('Mock response');
    });

    expect(tracing.recordStep).toHaveBeenCalled();
  });
});

describe('generateWithRetry — tokens de raciocínio no trace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tracing.ensureRun).mockResolvedValue('run-de-teste');
  });

  const aiComUso = (usageMetadata: Record<string, number>): GoogleGenAI =>
    ({
      models: { generateContent: vi.fn().mockResolvedValue({ text: 'ok', usageMetadata }) },
    }) as unknown as GoogleGenAI;

  it('grava thinkingTokens no metadata: o Gemini cobra o raciocínio como output', async () => {
    // Sem isto a estimativa de custo por deck subestima o modelo mais caro, que é
    // o que mais "pensa" (candidatesTokenCount não inclui o thinking).
    await runWithAiContext({ brandSlug: 'marca', feature: 'pipeline' }, async () => {
      await generateWithRetry(
        aiComUso({ promptTokenCount: 100, candidatesTokenCount: 50, thoughtsTokenCount: 4000 }),
        { model: 'gemini-2.5-flash', contents: 'x' },
      );
    });

    expect(tracing.recordStep).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { thinkingTokens: 4000 } }),
    );
  });

  it('sem thinking na resposta, não inventa metadata', async () => {
    await runWithAiContext({ brandSlug: 'marca', feature: 'pipeline' }, async () => {
      await generateWithRetry(aiComUso({ promptTokenCount: 10, candidatesTokenCount: 20 }), {
        model: 'gemini-2.5-flash',
        contents: 'x',
      });
    });

    const step = vi.mocked(tracing.recordStep).mock.calls[0]![0];
    expect(step.metadata).toBeUndefined();
  });
});
