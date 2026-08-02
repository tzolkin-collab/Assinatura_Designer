import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateWithRetry } from '../lib/geminiRetry.js';
import { GoogleGenAI } from '@google/genai';
import { runWithAiContext } from '../lib/aiContext.js';
import * as tracing from '../lib/generationTracing.js';
import * as budget from '../lib/aiBudget.js';

vi.mock('../lib/aiBudget.js', () => ({
  assertWithinBudget: vi.fn().mockResolvedValue(undefined),
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/generationTracing.js', () => ({
  recordStep: vi.fn(),
}));

describe('generateWithRetry Tracing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve registrar o step mesmo se o generateContent disparar mas mock prisma falhar', async () => {
    const aiMock = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: 'Mock response',
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
        }),
      },
    } as unknown as GoogleGenAI;

    // Simular que o `recordStep` interno vai jogar um log por baixo e não subir erro:
    vi.mocked(tracing.recordStep).mockImplementationOnce(() => { throw new Error('DB DOWN'); });

    await runWithAiContext({ runId: 'test-run-id' }, async () => {
      const res = await generateWithRetry(aiMock, {
        model: 'gemini-1.5-flash',
        contents: 'Test prompt',
      });
      expect(res.text).toBe('Mock response');
    });

    expect(tracing.recordStep).toHaveBeenCalled();
  });
});
