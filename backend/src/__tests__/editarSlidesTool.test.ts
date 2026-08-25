import { describe, it, expect, vi } from 'vitest';

// skills.ts arrasta prisma/redis/r2 no import. O alvo aqui é só a DECLARAÇÃO
// da ferramenta, que é dado puro — então esses módulos viram casca vazia.
vi.mock('../lib/prisma.js', () => ({ default: {} }));
vi.mock('../lib/redis.js', () => ({ getBrandMemory: vi.fn(), updateBrandMemory: vi.fn() }));
vi.mock('../lib/r2.js', () => ({ uploadFileToR2: vi.fn() }));
vi.mock('../lib/tokenCrypto.js', () => ({ tryDecryptToken: vi.fn(), encryptToken: vi.fn() }));
vi.mock('../lib/connectorOAuth.js', () => ({ refreshOAuthToken: vi.fn(), isTokenExpiringSoon: vi.fn() }));

const { brainTools } = await import('../agents/brain/skills');

const declaracoes = brainTools[0]!.functionDeclarations!;
const editar = declaracoes.find((d) => d.name === 'editarSlides');

describe('ferramenta editarSlides', () => {
  // Editar o deck era o único verbo central que não era ferramenta: ia como
  // `[EDIT]{json}` no meio da prosa, e um `]` no payload derrubava o parse
  // silenciosamente. Se alguém remover a declaração, isto quebra.
  it('está declarada como função de verdade', () => {
    expect(editar).toBeDefined();
  });

  it('exige a lista de edits', () => {
    expect(editar!.parameters?.required).toContain('edits');
  });

  it('exige index E instruction em cada item — um slide por item', () => {
    const item = (editar!.parameters?.properties?.edits as { items?: { required?: string[] } })?.items;
    expect(item?.required).toEqual(expect.arrayContaining(['index', 'instruction']));
  });

  // O caminho por marcador continua vivo como fallback e usa `index` como
  // índice de array (0-based). Se a ferramenta passar a expor 1-based sem
  // converter, os dois caminhos divergem em silêncio — o pior desfecho.
  it('documenta o index como 0-based, igual ao caminho antigo', () => {
    const props = (editar!.parameters?.properties?.edits as {
      items?: { properties?: { index?: { description?: string } } };
    })?.items?.properties;
    expect(props?.index?.description ?? '').toMatch(/zero|0/i);
  });

  it('não desalojou as outras ferramentas', () => {
    const nomes = declaracoes.map((d) => d.name);
    expect(nomes).toEqual(expect.arrayContaining([
      'editarSlides', 'updateBrandMemory', 'createAsanaTask', 'listAsanaProjects', 'generateRoteiroLink',
    ]));
  });
});
