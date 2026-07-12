// ═══════════════════════════════════════════════════════════════════════════════
// Design IR — Patcher
// ═══════════════════════════════════════════════════════════════════════════════
// Aplica um IRPatch (lista de ops) sobre um DesignIR de forma IMUTÁVEL: retorna um
// novo IR, sem mutar o anterior (essencial pro undo/redo e pra reconciliação do
// React no editor). Cada op cobre uma variante de IRPatchOp definida em ./types.

import type {
  DesignIR,
  IRPatch,
  IRPatchOp,
  SlideNode,
  ElementNode,
} from './types';

// Reescreve (imutável) o slide de id `slideId`; slides não citados passam intactos.
function mapSlide(ir: DesignIR, slideId: string, fn: (slide: SlideNode) => SlideNode): SlideNode[] {
  return ir.slides.map((slide) => (slide.id === slideId ? fn(slide) : slide));
}

// Reescreve (imutável) o elemento de id `elementId` dentro de um slide.
function mapElement(slide: SlideNode, elementId: string, fn: (el: ElementNode) => ElementNode): SlideNode {
  return { ...slide, elements: slide.elements.map((el) => (el.id === elementId ? fn(el) : el)) };
}

function applyOp(ir: DesignIR, op: IRPatchOp): DesignIR {
  switch (op.op) {
    case 'update-element':
      return { ...ir, slides: mapSlide(ir, op.slideId, (s) => mapElement(s, op.elementId, (el) => ({ ...el, ...op.changes }))) };

    case 'update-style':
      return { ...ir, slides: mapSlide(ir, op.slideId, (s) => mapElement(s, op.elementId, (el) => ({ ...el, style: { ...el.style, ...op.style } }))) };

    case 'update-content':
      return { ...ir, slides: mapSlide(ir, op.slideId, (s) => mapElement(s, op.elementId, (el) => ({ ...el, content: op.content }))) };

    case 'update-bounds':
      return { ...ir, slides: mapSlide(ir, op.slideId, (s) => mapElement(s, op.elementId, (el) => ({ ...el, bounds: { ...el.bounds, ...op.bounds } }))) };

    case 'update-background':
      return { ...ir, slides: mapSlide(ir, op.slideId, (s) => ({ ...s, background: op.background })) };

    case 'add-element':
      return {
        ...ir,
        slides: mapSlide(ir, op.slideId, (s) => {
          const elements = [...s.elements];
          const at = op.afterElementId ? elements.findIndex((e) => e.id === op.afterElementId) : -1;
          if (at >= 0) elements.splice(at + 1, 0, op.element);
          else elements.push(op.element);
          return { ...s, elements };
        }),
      };

    case 'remove-element':
      return { ...ir, slides: mapSlide(ir, op.slideId, (s) => ({ ...s, elements: s.elements.filter((e) => e.id !== op.elementId) })) };

    case 'reorder-element':
      return { ...ir, slides: mapSlide(ir, op.slideId, (s) => mapElement(s, op.elementId, (el) => ({ ...el, zIndex: op.newZIndex }))) };

    case 'add-slide': {
      const slides = [...ir.slides];
      const at = op.afterSlideId ? slides.findIndex((s) => s.id === op.afterSlideId) : -1;
      if (at >= 0) slides.splice(at + 1, 0, op.slide);
      else slides.push(op.slide);
      return { ...ir, slides };
    }

    case 'remove-slide':
      return { ...ir, slides: ir.slides.filter((s) => s.id !== op.slideId) };

    case 'update-tokens':
      return { ...ir, tokens: { ...ir.tokens, ...op.tokens } };

    default:
      // Op desconhecida: no-op defensivo (mantém o IR intacto em vez de quebrar).
      return ir;
  }
}

export function applyPatch(ir: DesignIR, patch: IRPatch): DesignIR {
  if (!patch || !Array.isArray(patch.ops)) return ir;
  return patch.ops.reduce(applyOp, ir);
}
