import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseRequestedSlideCount } from '../agents/pipeline';
import { runPlanner, MAX_SLIDES } from '../agents/planner/index';
import { generateWithRetry } from '../lib/geminiRetry';

// Mock geminiRetry para controlar as respostas das chamadas à API da Gemini
vi.mock('../lib/geminiRetry', () => ({
  generateWithRetry: vi.fn(),
  humanizeGeminiError: vi.fn(err => err),
}));

describe('Planejamento de Apresentação de 50 Slides', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('parseRequestedSlideCount', () => {
    it('deve extrair 50 slides corretamente de briefings em vários formatos', () => {
      expect(parseRequestedSlideCount('Crie uma apresentação de 50 slides sobre finanças')).toBe(50);
      expect(parseRequestedSlideCount('Gere um deck com 50 laminas institucionais')).toBe(50);
      expect(parseRequestedSlideCount('Preciso de 50 paginas para o pitch de vendas')).toBe(50);
      expect(parseRequestedSlideCount('Carrossel de 50 telas')).toBe(50);
    });

    it('deve clamar ao valor máximo permitido (MAX_SLIDES)', () => {
      expect(parseRequestedSlideCount(`Gere uma apresentação de ${MAX_SLIDES + 50} slides`)).toBe(MAX_SLIDES);
    });

    it('deve retornar undefined quando nenhuma contagem é informada', () => {
      expect(parseRequestedSlideCount('Apresentação institucional sobre inovação')).toBeUndefined();
    });
  });

  describe('runPlanner com 50 slides (chunking)', () => {
    it('deve dividir a geração em chunks e retornar exatamente 50 slides ordenados', async () => {
      const mockGenerate = generateWithRetry as any;

      // Mocking 3 chamadas da API do Gemini para os chunks (20, 20, 10 slides)
      mockGenerate.mockImplementation(async (aiInstance: any, options: any) => {
        const text = options.contents[0].parts[0].text;

        // Chunk 1: Slides 1 a 20
        if (text.includes('slides de 1 a 20')) {
          const chunk1 = Array.from({ length: 20 }, (_, i) => ({
            title: `Slide ${i + 1}`,
            goal: `Goal ${i + 1}`,
            layout_type: i === 0 ? 'title-hero' : 'content-split',
            order: i + 1,
          }));
          return { text: JSON.stringify(chunk1) };
        }

        // Chunk 2: Slides 21 a 40
        if (text.includes('slides de 21 a 40')) {
          const chunk2 = Array.from({ length: 20 }, (_, i) => ({
            title: `Slide ${i + 21}`,
            goal: `Goal ${i + 21}`,
            layout_type: 'content-split',
            order: i + 21,
          }));
          return { text: JSON.stringify(chunk2) };
        }

        // Chunk 3: Slides 41 a 50
        if (text.includes('slides de 41 a 50')) {
          const chunk3 = Array.from({ length: 10 }, (_, i) => ({
            title: `Slide ${i + 41}`,
            goal: `Goal ${i + 41}`,
            layout_type: i === 9 ? 'closing' : 'content-split',
            order: i + 41,
          }));
          return { text: JSON.stringify(chunk3) };
        }

        return { text: '[]' };
      });

      const skeleton = await runPlanner({
        brief: 'Apresentação com 50 slides sobre o ecossistema financeiro local',
        brandContext: 'Paleta de cores: Azul e Prata',
        format: 'presentation',
        targetSlideCount: 50,
      });

      // Validações
      expect(skeleton).toHaveLength(50);
      expect(mockGenerate).toHaveBeenCalledTimes(3); // 20 + 20 + 10 slides = 3 chunks

      // Verifica se a ordenação sequencial foi mantida e se os bookends foram garantidos
      expect(skeleton[0].order).toBe(1);
      expect(skeleton[0].layout_type).toBe('title-hero'); // Slide 1 deve ser capa

      expect(skeleton[49].order).toBe(50);
      expect(skeleton[49].layout_type).toBe('closing'); // Slide 50 deve ser encerramento

      // Verifica se todos estão ordenados de 1 a 50 de forma estritamente crescente
      for (let i = 0; i < 50; i++) {
        expect(skeleton[i].order).toBe(i + 1);
        expect(skeleton[i].title).toBe(`Slide ${i + 1}`);
      }
    });
  });
});
