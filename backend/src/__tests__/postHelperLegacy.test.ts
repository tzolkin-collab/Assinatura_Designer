import { describe, it, expect } from 'vitest';
import { mergeSlidesIntoPost } from '../lib/postHelper';

// Posts anteriores à migração relacional guardam os slides dentro do blob `content`
// e têm a tabela `slides` vazia. O merge sobrescrevia o blob com a tabela sem checar
// se ela tinha algo: o deck existia no banco e chegava vazio em quem lê, derrubando
// export de PDF/ZIP e Canva ("Este design ainda não tem slides") em todo o acervo antigo.
const postLegado = (kind: string, chave: 'slides' | 'ir') =>
  ({
    id: 'p1',
    slides: [],
    content:
      chave === 'ir'
        ? { kind, ir: { slides: [{ id: 's1' }, { id: 's2' }] } }
        : { kind, slides: [{ id: 's1' }, { id: 's2' }] },
  }) as never;

describe('mergeSlidesIntoPost: acervo legado', () => {
  it('preserva os slides do blob quando a tabela relacional está vazia (html-design)', () => {
    const out = mergeSlidesIntoPost(postLegado('html-design', 'slides')) as never as {
      content: { slides: unknown[] };
    };
    expect(out.content.slides).toHaveLength(2);
  });

  it('preserva os slides do blob quando a tabela está vazia (ir-design legado)', () => {
    const out = mergeSlidesIntoPost(postLegado('ir-design', 'ir')) as never as {
      content: { ir: { slides: unknown[] } };
    };
    expect(out.content.ir.slides).toHaveLength(2);
  });

  it('a tabela continua vencendo o blob quando ela tem slides (post moderno)', () => {
    const post = {
      id: 'p2',
      slides: [
        { id: 'db2', position: 1, contentJson: { marcador: 'segundo' }, metadata: null },
        { id: 'db1', position: 0, contentJson: { marcador: 'primeiro' }, metadata: null },
      ],
      content: { kind: 'html-design', slides: [{ id: 'blob-antigo' }] },
    } as never;

    const out = mergeSlidesIntoPost(post) as never as {
      content: { slides: Array<{ id: string; marcador: string }> };
    };
    // Ordena por position e ignora o blob obsoleto.
    expect(out.content.slides.map((s) => s.marcador)).toEqual(['primeiro', 'segundo']);
    expect(out.content.slides.map((s) => s.id)).toEqual(['db1', 'db2']);
  });
});
