import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPlanner } from '../agents/planner/index';
import { generateWithRetry } from '../lib/geminiRetry';

vi.mock('../lib/geminiRetry', () => ({
  generateWithRetry: vi.fn(),
  humanizeGeminiError: vi.fn((err) => err),
}));

describe('Planner — imageHint (seam pro imageResolver)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('preserva o imageHint que o modelo devolveu para o slide', async () => {
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify([
        { title: 'Capa', goal: 'Abrir', layout_type: 'title-hero', order: 1 },
        { title: 'Produto', goal: 'Mostrar o produto', layout_type: 'content-split', order: 2, imageHint: 'foto do produto em uso, luz natural' },
        { title: 'CTA', goal: 'Fechar', layout_type: 'closing', order: 3 },
      ]),
    });

    const skeleton = await runPlanner({ brief: 'lançamento de produto', brandContext: 'Marca X', format: 'carousel' });

    expect(skeleton[1]!.imageHint).toBe('foto do produto em uso, luz natural');
    expect(skeleton[0]!.imageHint).toBeUndefined();
    expect(skeleton[2]!.imageHint).toBeUndefined();
  });

  it('imageHint em branco vira ausente (não sobra string vazia disparando o imageResolver à toa)', async () => {
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify([
        { title: 'Capa', goal: 'Abrir', layout_type: 'title-hero', order: 1, imageHint: '   ' },
      ]),
    });

    const skeleton = await runPlanner({ brief: 'brief qualquer', brandContext: '', format: 'carousel' });

    expect(skeleton[0]!.imageHint).toBeUndefined();
  });

  it('maioria dos slides sem imageHint (comportamento default esperado — nem todo slide pede imagem)', async () => {
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify([
        { title: 'Capa', goal: 'Abrir', layout_type: 'title-hero', order: 1 },
        { title: 'Dados', goal: 'Mostrar métricas', layout_type: 'metrics', order: 2 },
      ]),
    });

    const skeleton = await runPlanner({ brief: 'relatório', brandContext: '', format: 'presentation' });

    expect(skeleton.every((s) => s.imageHint === undefined)).toBe(true);
  });
});
