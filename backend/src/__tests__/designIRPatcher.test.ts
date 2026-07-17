import { describe, it, expect } from 'vitest';
import { applyPatch, applyPatchToSlide } from '../lib/designIR/patcher';
import { sanitizeIRPatch } from '../lib/designIR/aiPatch';
import type { DesignIR, SlideNode, IRPatch } from '../lib/designIR/types';

/**
 * O patcher do servidor é espelho de `frontend/src/lib/designIR/patcher.ts`.
 *
 * Ele existe porque o chat da Fábrica não tem canvas do outro lado: quando a IA edita
 * por lá, alguém precisa APLICAR o patch no servidor. Se as duas cópias divergirem, a
 * MESMA instrução produz designs diferentes conforme a tela em que foi pedida — e nada
 * avisa. Estes testes travam o contrato.
 */

function slideDeTeste(): SlideNode {
  return {
    id: 'slide-1',
    background: { type: 'solid', color: '#ffffff' },
    elements: [
      {
        id: 'titulo',
        type: 'text',
        role: 'title',
        content: 'Olá',
        bounds: { x: 100, y: 100, width: 800, height: 200 },
        style: { fontSize: 64, color: '#111111', fontFamily: 'Inter' },
        zIndex: 2,
      },
      {
        id: 'fundo',
        type: 'shape',
        role: 'decoration',
        bounds: { x: 0, y: 0, width: 1080, height: 1080 },
        style: { backgroundColor: '#eeeeee' },
        zIndex: 1,
      },
    ],
  } as SlideNode;
}

function irDeTeste(): DesignIR {
  return {
    version: 1,
    width: 1080,
    height: 1080,
    fonts: ['Inter'],
    tokens: { colors: {}, fonts: {}, spacing: {}, borderRadius: {} },
    slides: [slideDeTeste()],
  } as DesignIR;
}

describe('patcher do IR (servidor)', () => {
  it('aplica update-style MESCLANDO o estilo, sem apagar o que não foi citado', () => {
    const ir = irDeTeste();
    const patch = {
      ops: [{ op: 'update-style', slideId: 'slide-1', elementId: 'titulo', style: { fontSize: 120 } }],
    } as unknown as IRPatch;

    const novo = applyPatch(ir, patch);
    const titulo = novo.slides[0]!.elements[0]!;

    expect(titulo.style.fontSize).toBe(120);
    // A cor e a fonte NÃO foram citadas — têm de sobreviver. Um patch que troca o
    // objeto de estilo inteiro apagaria a direção de arte a cada ajuste.
    expect(titulo.style.color).toBe('#111111');
    expect(titulo.style.fontFamily).toBe('Inter');
  });

  it('é IMUTÁVEL: o IR original não é tocado (o undo/redo depende disso)', () => {
    const ir = irDeTeste();
    const antes = JSON.stringify(ir);

    applyPatch(ir, {
      ops: [{ op: 'update-content', slideId: 'slide-1', elementId: 'titulo', content: 'Mudou' }],
    } as unknown as IRPatch);

    expect(JSON.stringify(ir)).toBe(antes);
  });

  it('não mexe em slide que não foi citado', () => {
    const ir = irDeTeste();
    ir.slides.push({ ...slideDeTeste(), id: 'slide-2' });

    const novo = applyPatch(ir, {
      ops: [{ op: 'update-content', slideId: 'slide-1', elementId: 'titulo', content: 'Só o primeiro' }],
    } as unknown as IRPatch);

    expect(novo.slides[0]!.elements[0]!.content).toBe('Só o primeiro');
    expect(novo.slides[1]!.elements[0]!.content).toBe('Olá');
  });

  it('op desconhecida é no-op — não corrompe o design', () => {
    const ir = irDeTeste();
    const novo = applyPatch(ir, { ops: [{ op: 'formatar-o-disco' }] } as unknown as IRPatch);
    expect(novo).toEqual(ir);
  });

  it('applyPatchToSlide edita um slide solto (o caminho que o brain usa)', () => {
    const slide = slideDeTeste();
    const novo = applyPatchToSlide(slide, {
      ops: [{ op: 'update-background', slideId: 'slide-1', background: { type: 'solid', color: '#000000' } }],
    } as unknown as IRPatch);

    expect(novo.background).toEqual({ type: 'solid', color: '#000000' });
    expect(slide.background).toEqual({ type: 'solid', color: '#ffffff' }); // original intacto
  });
});

describe('sanitizeIRPatch — a barreira entre o LLM e o design', () => {
  const elementIds = new Set(['titulo', 'fundo']);

  it('FORÇA o slideId real: o modelo não escolhe em que slide mexe', () => {
    const { ops } = sanitizeIRPatch(
      { ops: [{ op: 'update-content', slideId: 'slide-DE-OUTRO-DECK', elementId: 'titulo', content: 'x' }] },
      'slide-1',
      elementIds,
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]!.slideId).toBe('slide-1');
  });

  it('descarta elementId que não existe (o modelo alucina ids)', () => {
    const { ops } = sanitizeIRPatch(
      { ops: [{ op: 'update-content', elementId: 'nao-existe', content: 'x' }] },
      'slide-1',
      elementIds,
    );
    expect(ops).toHaveLength(0);
  });

  it('bloqueia ops estruturais: uma instrução ambígua não pode custar um slide', () => {
    const { ops } = sanitizeIRPatch(
      {
        ops: [
          { op: 'remove-slide', slideId: 'slide-1' },
          { op: 'add-slide', slide: {} },
          { op: 'update-tokens', tokens: {} },
        ],
      },
      'slide-1',
      elementIds,
    );
    expect(ops).toHaveLength(0);
  });

  it('descarta op malformada (update-style sem style)', () => {
    const { ops } = sanitizeIRPatch(
      { ops: [{ op: 'update-style', elementId: 'titulo' }] },
      'slide-1',
      elementIds,
    );
    expect(ops).toHaveLength(0);
  });

  it('resposta sem ops vira lista vazia — e quem chama tem de DIZER que falhou', () => {
    expect(sanitizeIRPatch({}, 'slide-1', elementIds).ops).toHaveLength(0);
    expect(sanitizeIRPatch(null, 'slide-1', elementIds).ops).toHaveLength(0);
    expect(sanitizeIRPatch({ ops: 'nao-e-array' }, 'slide-1', elementIds).ops).toHaveLength(0);
  });

  it('teto de 40 ops: uma resposta delirante não reescreve o slide inteiro', () => {
    const muitas = Array.from({ length: 100 }, () => ({
      op: 'update-style', elementId: 'titulo', style: { fontSize: 10 },
    }));
    expect(sanitizeIRPatch({ ops: muitas }, 'slide-1', elementIds).ops).toHaveLength(40);
  });
});
