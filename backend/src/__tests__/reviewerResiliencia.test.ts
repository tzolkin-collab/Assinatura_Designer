import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/htmlRaster.js', () => ({ renderHtmlToBase64: vi.fn() }));
vi.mock('../lib/geminiRetry.js', () => ({
  generateWithRetry: vi.fn(),
  humanizeGeminiError: vi.fn((e) => e),
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class { models = { generateContent: vi.fn() }; },
  Type: {}, Schema: {},
}));
vi.mock('../lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { runHtmlReviewer } from '../agents/reviewer/index';
import { renderHtmlToBase64 } from '../lib/htmlRaster.js';
import { generateWithRetry } from '../lib/geminiRetry.js';

const conteudo = {
  kind: 'html-design' as const,
  version: 1 as const,
  width: 1080,
  height: 1080,
  format: 'carousel' as const,
  fonts: ['Inter'],
  slides: Array.from({ length: 5 }, (_, i) => ({ html: `<div>slide ${i}</div>` })),
};

const reprova = {
  text: JSON.stringify({
    approved: false, score: 40,
    deviations: [{ slideIndex: 0, problem: 'contraste ruim', fix: 'escurecer fundo' }],
    feedback: 'precisa ajuste',
  }),
};

beforeEach(() => vi.clearAllMocks());

describe('runHtmlReviewer — um slide quebrado não desliga o QA', () => {
  it('reprova normalmente mesmo com um slide falhando ao renderizar', async () => {
    // Regressão: era `Promise.all` cru. Uma única falha do chromium rejeitava a
    // amostra inteira, caía no catch e a função retornava `approved: true` — a
    // etapa que existe pra REPROVAR arte ruim se desligava sozinha e carimbava
    // aprovado, em silêncio.
    let n = 0;
    vi.mocked(renderHtmlToBase64).mockImplementation(async () => {
      n += 1;
      if (n === 2) throw new Error('chromium morreu neste slide');
      return 'base64-fake';
    });
    vi.mocked(generateWithRetry).mockResolvedValue(reprova as never);

    const r = await runHtmlReviewer(conteudo, 'marca', 'objetivo');

    expect(r.approved).toBe(false);
    expect(r.score).toBe(40);
    // O crítico foi chamado com a amostra parcial, em vez de ser pulado.
    expect(generateWithRetry).toHaveBeenCalled();
  });

  it('só aprova por segurança quando NENHUM slide renderiza', async () => {
    vi.mocked(renderHtmlToBase64).mockRejectedValue(new Error('chromium fora do ar'));

    const r = await runHtmlReviewer(conteudo, 'marca', 'objetivo');

    expect(r.approved).toBe(true);
    expect(r.feedback).toBe('Revisão visual indisponível');
    // Sem imagem nenhuma, não faz sentido gastar chamada de crítica.
    expect(generateWithRetry).not.toHaveBeenCalled();
  });
});
