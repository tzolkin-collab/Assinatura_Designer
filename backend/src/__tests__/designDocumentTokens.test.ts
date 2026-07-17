import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import { prismaMock } from './client';
import { app } from '../app';
import jwt from 'jsonwebtoken';
import { generateWithRetry } from '../lib/geminiRetry';
import { config } from '../config';

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
    sign: vi.fn(() => 'jwt'),
    JsonWebTokenError: class JsonWebTokenError extends Error {},
  },
}));

vi.mock('../lib/geminiRetry', () => ({
  generateWithRetry: vi.fn(),
  generateStreamWithRetry: vi.fn(),
  humanizeGeminiError: vi.fn((e) => e),
}));

// Esta rota gera o documento INTEIRO num JSON só e era a única sem teto de saída
// nem limite de thinking: o Gemini assume 8192 quando `maxOutputTokens` falta, o
// modelo pro gasta boa parte disso pensando e o deck chegava truncado
// (finishReason MAX_TOKENS → "did not contain valid JSON").
// O teste trava o contrato ENVIADO à API — é onde o bug morava.
describe('generate-design-document: orçamento de tokens enviado ao Gemini', () => {
  const mockedVerify = jwt.verify as unknown as Mock;
  const mockedGenerate = generateWithRetry as unknown as Mock;

  beforeEach(() => {
    vi.resetAllMocks();
    mockedVerify.mockReturnValue({ userId: 'u1', email: 'u@test.com' });
    prismaMock.brand.findUnique.mockResolvedValue({
      id: 'brand-1',
      slug: 'marca',
      name: 'Marca',
      userId: 'u1',
      config: { colors: ['#000'], primaryFonts: ['Inter'] },
      refs: [],
    });
    prismaMock.brandMember.findUnique.mockResolvedValue({
      role: 'OWNER',
      brandId: 'brand-1',
      userId: 'u1',
    });
  });

  it('envia maxOutputTokens e thinkingBudget na chamada de geração', async () => {
    mockedGenerate.mockResolvedValue({ text: '{}', candidates: [{ finishReason: 'STOP' }] });

    await request(app)
      .post('/api/ai/marca/generate-design-document')
      .set('Authorization', 'Bearer token')
      .send({ prompt: 'um deck institucional', format: 'presentation', slideCount: 6 });

    expect(mockedGenerate).toHaveBeenCalled();
    const cfg = mockedGenerate.mock.calls[0]![1].config;
    expect(cfg.maxOutputTokens).toBe(32768);
    expect(cfg.thinkingConfig).toEqual({ thinkingBudget: config.geminiThinkingBudget });
    // O que já existia não pode ter sido perdido no spread.
    expect(cfg.responseMimeType).toBe('application/json');
    expect(cfg.systemInstruction).toBeTruthy();
  });
});
