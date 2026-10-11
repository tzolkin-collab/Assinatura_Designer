import { describe, it, expect } from 'vitest';
import { AMANDA_COELHO_MEMORY } from '../lib/designerBrain/seeds/amandaCoelho.js';
import { AMANDA_COELHO_PROFILE } from '../lib/designerBrain/seeds/amandaCoelhoProfile.js';
import { officialFontsFor } from '../lib/designerBrain/fontNotice.js';
import { resolveProjectMemory } from '../lib/designerBrain/pipelineContext.js';
import { planProfileLoad, reportProfile } from '../lib/brandProfileLoad.js';
import { renderProjectMemory } from '../lib/brandProfile.js';

// A ficha da Amanda tem de dizer EXATAMENTE o que a memória da Gabriela diz: só dividida em seções.
// Enquanto o seed existir, este teste é o que impede as duas versões de se afastarem.

const seedLines = AMANDA_COELHO_MEMORY.split('\n');
const after = (title: string): string => {
  const i = seedLines.indexOf(title);
  if (i < 0) throw new Error(`seção ausente no seed: ${title}`);
  return seedLines[i + 1]!;
};

describe('ficha da Amanda Coelho', () => {
  it('é válida pelo schema', () => {
    const r = reportProfile(AMANDA_COELHO_PROFILE);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it('os textos longos são idênticos aos do seed, palavra por palavra', () => {
    expect(AMANDA_COELHO_PROFILE.essence).toBe(after('ESSÊNCIA'));
    expect(AMANDA_COELHO_PROFILE.artDirection).toBe(after('COMPOSIÇÃO'));
    expect(AMANDA_COELHO_PROFILE.realPhoto).toBe(after('FOTOGRAFIA'));
    expect(AMANDA_COELHO_PROFILE.graphicElements).toBe(after('ELEMENTOS'));
    expect(AMANDA_COELHO_PROFILE.approvalCriterion).toBe(after('CRITÉRIO FINAL'));
  });

  it('a paleta tem as mesmas 4 cores, nome e função do seed', () => {
    for (const c of AMANDA_COELHO_PROFILE.palette!) {
      expect(AMANDA_COELHO_MEMORY).toContain(`${c.hex} ${c.name} — ${c.role}.`);
    }
    expect(AMANDA_COELHO_PROFILE.palette).toHaveLength(4);
    const hexNoSeed = AMANDA_COELHO_MEMORY.match(/#[0-9A-Fa-f]{6}/g)!.map((h) => h.toUpperCase());
    expect(AMANDA_COELHO_PROFILE.palette!.map((c) => c.hex).sort()).toEqual([...new Set(hexNoSeed)].sort());
  });

  it('a tipografia é a do seed: Queens e Aeonik, cada uma com a sua função', () => {
    const [queens, aeonik] = AMANDA_COELHO_PROFILE.typography!;
    expect(AMANDA_COELHO_MEMORY).toContain(`Queens: ${queens!.role!.replace(' Queens = personalidade.', '')}`);
    expect(AMANDA_COELHO_MEMORY).toContain(`Aeonik: ${aeonik!.role!.replace(' Aeonik = clareza.', '')}`);
    expect(AMANDA_COELHO_MEMORY).toContain('Queens = personalidade. Aeonik = clareza.');
  });

  it('o que evitar: cada item vem da lista do seed, e nada foi acrescentado além da regra de cores', () => {
    const evitar = after('EVITAR');
    const [regraCores, ...itens] = AMANDA_COELHO_PROFILE.neverDo!;
    expect(regraCores).toBe('Não introduzir outras cores dominantes.');
    expect(AMANDA_COELHO_MEMORY).toContain(regraCores!);
    for (const item of itens) expect(evitar.toLowerCase()).toContain(item.toLowerCase());
    // Reconstruir a lista junta deve reproduzir o seed (sem perder item).
    const juntos = itens.join(', ').toLowerCase() + '.';
    expect(evitar.toLowerCase()).toBe(juntos);
  });

  it('a memória renderizada traz todos os trechos da memória original', () => {
    const rendered = renderProjectMemory('Amanda Coelho', AMANDA_COELHO_PROFILE);
    for (const trecho of [after('ESSÊNCIA'), after('COMPOSIÇÃO'), after('FOTOGRAFIA'), after('ELEMENTOS'), after('CRITÉRIO FINAL')]) {
      expect(rendered).toContain(trecho);
    }
    expect(rendered).toContain('#410C1C');
    expect(rendered).toContain('Queens');
  });

  it('não inventa o que a memória original não tem: tom, logo, manual e collab ficam pendentes', () => {
    expect(AMANDA_COELHO_PROFILE.writingDirection).toBeUndefined();
    expect(AMANDA_COELHO_PROFILE.logo).toBeUndefined();
    expect(AMANDA_COELHO_PROFILE.visualManual).toBeUndefined();
    expect(AMANDA_COELHO_PROFILE.collabRules).toBeUndefined();
    const r = reportProfile(AMANDA_COELHO_PROFILE);
    expect(r.ready).toBe(false);
    expect(r.pendingRequired).toEqual(['Manual visual']); // o único obrigatório que falta: precisa da imagem na biblioteca
  });

  it('o aviso de fonte oficial continua igual ao de hoje (Queens e Aeonik)', () => {
    expect(officialFontsFor('amanda-coelho', AMANDA_COELHO_PROFILE)).toEqual(officialFontsFor('amanda-coelho'));
  });

  it('com a ficha carregada, o cérebro usa a ficha e não depende mais do seed', () => {
    const memoria = resolveProjectMemory('amanda-coelho', '', AMANDA_COELHO_PROFILE, 'Amanda Coelho');
    expect(memoria).toContain('PROJETO: Amanda Coelho');
    expect(memoria).not.toBe(AMANDA_COELHO_MEMORY);
  });
});

describe('planProfileLoad', () => {
  it('sem ficha: cria', () => expect(planProfileLoad({ existing: null, force: false })).toBe('create'));
  it('com ficha já salva: recusa, para não apagar o trabalho de alguém', () => {
    expect(planProfileLoad({ existing: { essence: 'x' }, force: false })).toBe('refuse-exists');
  });
  it('só sobrescreve com pedido explícito', () => {
    expect(planProfileLoad({ existing: { essence: 'x' }, force: true })).toBe('overwrite');
  });
});

describe('reportProfile', () => {
  it('ficha inválida: relata o erro e não devolve dados', () => {
    const r = reportProfile({ palette: [{ hex: 'azul' }] });
    expect(r.valid).toBe(false);
    expect(r.data).toBeNull();
    expect(r.errors.join(' ')).toContain('palette');
  });
});
