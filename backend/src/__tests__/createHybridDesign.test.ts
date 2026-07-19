import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from './client';

// Teste de CARACTERIZAÇÃO de createHybridDesign — trava a sequência de eventos e o
// resultado ANTES de a função migrar para services/designGeneration.ts (Fase 3).
// generateDesignDocument/reviewDesignDocument são mockados para NÃO chamar o
// callback do Gemini, então o pipeline fica determinístico sem tocar a IA real.

const generateDesignDocumentMock = vi.fn();
const reviewDesignDocumentMock = vi.fn();

vi.mock('../lib/designDocument', () => ({
  generateDesignDocument: (...args: unknown[]) => generateDesignDocumentMock(...args),
  reviewDesignDocument: (...args: unknown[]) => reviewDesignDocumentMock(...args),
  DesignDocumentValidationError: class DesignDocumentValidationError extends Error {},
  generateWithRetry: vi.fn(),
}));

vi.mock('../lib/brandContext', () => ({
  resolveBrandContext: vi.fn(async () => ({ name: 'Marca', slug: 'marca', colors: [], primaryFonts: [] })),
  buildBrandContextSummary: vi.fn(() => ''),
  buildBrandAssistantInstruction: vi.fn(() => ''),
}));

// Importado depois dos mocks (que são hoisted pelo vitest de qualquer forma).
import { createHybridDesign } from '../routes/ai';
import type { CreateEvent } from '../lib/generationEvents';

const baseArgs = () => ({
  message: 'faça um carrossel',
  answers: { tom: 'moderno' },
  brand: { id: 'brand-1', slug: 'marca', config: {} } as never,
  slideCount: 3,
  width: 1080,
  height: 1080,
  userId: 'user-1',
});

describe('createHybridDesign (caracterização)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateDesignDocumentMock.mockResolvedValue({ kind: 'hybrid-design', version: 1, source: 'codegen', document: { pages: ['orig'] } });
    reviewDesignDocumentMock.mockResolvedValue({ pages: ['revisado'] });
    prismaMock.post.create = vi.fn().mockResolvedValue({ id: 'post-42' });
  });

  it('emite a sequência de eventos esperada e retorna postId/content (review OK)', async () => {
    const events: CreateEvent[] = [];
    const res = await createHybridDesign({ ...baseArgs(), send: (e) => events.push(e) });

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'plan',
      'plan-step', 'plan-step', 'plan-step',
      'thinking',           // DesignDocument inicial gerado
      'plan-step', 'plan-step',
      'thinking',           // Quality Review concluído
      'thinking',           // DesignDocument salvo
      'hybrid-document',
      'plan-step',
      'done',
    ]);

    const done = events.at(-1);
    expect(done).toMatchObject({ type: 'done', postId: 'post-42', mode: 'hybrid' });
    expect(res.postId).toBe('post-42');
    // review OK: o document vira o revisado
    expect(res.content.document).toEqual({ pages: ['revisado'] });
  });

  it('review que falha → fallback silencioso mantém o document original (sem quebrar)', async () => {
    reviewDesignDocumentMock.mockRejectedValue(new Error('review pifou'));
    const events: CreateEvent[] = [];
    const res = await createHybridDesign({ ...baseArgs(), send: (e) => events.push(e) });

    // ainda conclui com sucesso
    expect(events.at(-1)).toMatchObject({ type: 'done', postId: 'post-42' });
    // document permanece o original (o review não sobrescreveu)
    expect(res.content.document).toEqual({ pages: ['orig'] });
    // o thinking do fallback aparece
    const thinkings = events.filter((e): e is Extract<CreateEvent, { type: 'thinking' }> => e.type === 'thinking').map((e) => e.text);
    expect(thinkings.some((t) => t.includes('Mantendo design original'))).toBe(true);
  });

  it('persiste o post com o tipo certo (carousel para slideCount > 1)', async () => {
    await createHybridDesign({ ...baseArgs(), slideCount: 3, send: () => {} });
    expect(prismaMock.post.create).toHaveBeenCalledTimes(1);
    const data = (prismaMock.post.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(data.type).toBe('CAROUSEL');
    expect(data.brandId).toBe('brand-1');
  });
});
