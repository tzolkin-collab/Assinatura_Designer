import { describe, it, expect, vi, beforeEach } from 'vitest';

// A pesquisa de concorrentes foi removida: as referências analisadas (modelo Reference, que segue
// no banco sem leitor) não entram mais no contexto que chega ao artista nem ao planejador.

const h = vi.hoisted(() => ({
  query: null as unknown,
}));

vi.mock('../lib/prisma.js', () => ({
  default: {
    brand: {
      findUnique: vi.fn(async (q: unknown) => {
        h.query = q;
        return {
          id: 'b1', name: 'Marca X', slug: 'marca-x', parentBrandId: null,
          config: { guidelines: 'Tom direto', agentPrompt: '', colors: ['#111111'], primaryFonts: ['Inter'], logoUrl: null, presentationConfig: null },
          // Mesmo que o banco devolvesse linhas de referência, nada disso pode virar texto de prompt.
          refs: [{ name: 'Concorrente X', archetype: 'O Criador', toneOfVoice: 'Direto', density: 'Alta', palette: ['#FF0000'], insightsText: 'Insight' }],
          assets: [],
        };
      }),
    },
    asset: { findMany: vi.fn(async () => []) },
  },
}));

import { buildBrandAssistantInstruction, buildBrandContextSummary, resolveBrandContext } from '../lib/brandContext.js';

beforeEach(() => {
  h.query = null;
});

describe('contexto da marca sem referências de concorrentes', () => {
  it('a consulta não carrega mais as referências analisadas', async () => {
    await resolveBrandContext('marca-x');
    const include = (h.query as { include: Record<string, unknown> }).include;
    expect(include).not.toHaveProperty('refs');
    expect(include).toHaveProperty('config');
    expect(include).toHaveProperty('assets');
  });

  it('o contexto resolvido não tem o campo references', async () => {
    const ctx = await resolveBrandContext('marca-x');
    expect(ctx).not.toHaveProperty('references');
  });

  it('nem o resumo do planejador nem a instrução do assistente falam de referências analisadas', async () => {
    const ctx = await resolveBrandContext('marca-x');
    const textos = [buildBrandContextSummary(ctx), buildBrandAssistantInstruction(ctx)].join('\n');
    expect(textos).toContain('Marca X');
    expect(textos).not.toMatch(/Referências analisadas|Analyzed References|Concorrente X|O Criador/);
  });
});
