import { describe, it, expect } from 'vitest';
import {
  backgroundLayers,
  drawableElements,
  positionStyle,
  shapeStyle,
  typographyAndBox,
  safeUrl,
} from './style';
import type { ElementNode, SlideNode } from './types';

/**
 * Paridade com `backend/src/lib/designIR/compiler.ts`, que é o renderizador de VERDADE
 * (o que vira PNG no export e o que o reviewer visual enxerga).
 *
 * O bug que estes testes existem para impedir: o canvas do editor desenhava 11
 * propriedades de estilo e ignorava sombra, rotação, opacidade, letterSpacing, borda,
 * gradiente, shapes e grupos. Mas o sanitizador da IA aceita qualquer CSS. Então
 * "adiciona uma sombra no título" era gravado no IR, saía no PNG, e NÃO aparecia na
 * tela — a IA parecia estar mentindo. Se o editor voltar a renderizar um subconjunto,
 * é aqui que tem de quebrar.
 */

function elemento(over: Partial<ElementNode> = {}): ElementNode {
  return {
    id: 'e1',
    type: 'text',
    role: 'title',
    bounds: { x: 10, y: 20, width: 300, height: 100 },
    zIndex: 1,
    style: {},
    ...over,
  } as ElementNode;
}

describe('typographyAndBox — o estilo que o editor ignorava', () => {
  it('desenha os campos que o canvas antigo deixava cair', () => {
    const css = typographyAndBox({
      boxShadow: '0 4px 20px rgba(0,0,0,.3)',
      opacity: 0.5,
      letterSpacing: 2,
      lineHeight: 1.2,
      textTransform: 'uppercase',
      textDecoration: 'underline',
      italic: true,
      padding: 24,
      backdropFilter: 'blur(4px)',
    });

    expect(css.boxShadow).toBe('0 4px 20px rgba(0,0,0,.3)');
    expect(css.opacity).toBe(0.5);
    expect(css.letterSpacing).toBe(2);
    expect(css.lineHeight).toBe(1.2);
    expect(css.textTransform).toBe('uppercase');
    expect(css.textDecoration).toBe('underline');
    expect(css.fontStyle).toBe('italic');
    expect(css.padding).toBe(24);
    expect(css.backdropFilter).toBe('blur(4px)');
  });

  it('monta a borda como o compilador (shorthand com defaults)', () => {
    expect(typographyAndBox({ borderWidth: 2 }).border).toBe('2px solid #000');
    expect(typographyAndBox({ borderWidth: 3, borderStyle: 'dashed', borderColor: '#f00' }).border)
      .toBe('3px dashed #f00');
  });

  it('acrescenta a família de fallback na fonte, como o compilador', () => {
    expect(typographyAndBox({ fontFamily: 'Poppins' }).fontFamily).toBe('Poppins, sans-serif');
  });
});

describe('positionStyle', () => {
  it('aplica a rotação — o canvas antigo simplesmente não girava nada', () => {
    const css = positionStyle(elemento({ bounds: { x: 0, y: 0, width: 10, height: 10, rotation: 45 } }));
    expect(css.transform).toBe('rotate(45deg)');
  });

  it('elemento invisível não é desenhado', () => {
    expect(positionStyle(elemento({ visible: false })).display).toBe('none');
  });

  it('arredonda os bounds como o compilador', () => {
    const css = positionStyle(elemento({ bounds: { x: 10.6, y: 20.4, width: 300.5, height: 100.2 } }));
    expect(css.left).toBe(11);
    expect(css.top).toBe(20);
  });
});

describe('backgroundLayers — camadas, não um background no container', () => {
  it('gradiente vira camada', () => {
    const [fundo] = backgroundLayers({ type: 'gradient', gradient: 'linear-gradient(#000,#fff)' });
    expect(fundo!.background).toBe('linear-gradient(#000,#fff)');
  });

  it('imagem COM overlay produz DUAS camadas — aplicar o fundo no container mataria o overlay', () => {
    const camadas = backgroundLayers({
      type: 'image',
      src: 'https://x/y.png',
      overlay: 'rgba(0,0,0,.5)',
    });
    expect(camadas).toHaveLength(2);
    expect(camadas[0]!.backgroundImage).toBe('url("https://x/y.png")');
    expect(camadas[1]!.background).toBe('rgba(0,0,0,.5)');
  });

  it('imagem sem src válido cai na cor, como o compilador', () => {
    const [fundo] = backgroundLayers({ type: 'image', src: 'javascript:alert(1)', color: '#123456' });
    expect(fundo!.background).toBe('#123456');
    expect(fundo!.backgroundImage).toBeUndefined();
  });
});

describe('safeUrl', () => {
  it('bloqueia javascript:', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('JavaScript:alert(1)')).toBeNull();
  });

  it('deixa passar http(s), data: e caminho absoluto', () => {
    expect(safeUrl('https://a/b.png')).toBe('https://a/b.png');
    expect(safeUrl('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
    expect(safeUrl('/local.png')).toBe('/local.png');
  });
});

describe('shapes', () => {
  it('círculo e triângulo têm a mesma forma do compilador', () => {
    expect(shapeStyle(elemento({ type: 'shape', shapeType: 'circle' })).borderRadius).toBe('50%');
    expect(shapeStyle(elemento({ type: 'shape', shapeType: 'triangle' })).clipPath)
      .toBe('polygon(50% 0, 100% 100%, 0 100%)');
  });
});

describe('drawableElements', () => {
  it('ordena por zIndex — quem está por cima tem de ficar por cima', () => {
    const ids = drawableElements([
      elemento({ id: 'topo', zIndex: 9 }),
      elemento({ id: 'fundo', zIndex: 1 }),
    ]).map((e) => e.id);
    expect(ids).toEqual(['fundo', 'topo']);
  });

  it('ACHATA grupos: os filhos têm bounds em coordenadas do canvas', () => {
    // Renderizar um grupo como container daria offset duplo. O compilador achata; aqui
    // também. O canvas antigo nem desenhava grupos — os filhos sumiam da tela.
    const grupo = elemento({
      id: 'g',
      type: 'group',
      children: [elemento({ id: 'filho-a', zIndex: 2 }), elemento({ id: 'filho-b', zIndex: 1 })],
    });

    const ids = drawableElements([grupo]).map((e) => e.id);
    expect(ids).toEqual(['filho-b', 'filho-a']);
    expect(ids).not.toContain('g');
  });
});

describe('o slide inteiro', () => {
  it('um slide com sombra + rotação + gradiente produz CSS para TODOS eles', () => {
    const slide: SlideNode = {
      id: 's1',
      background: { type: 'gradient', gradient: 'linear-gradient(#111,#333)' },
      elements: [
        elemento({
          id: 'titulo',
          bounds: { x: 0, y: 0, width: 100, height: 50, rotation: -3 },
          style: { boxShadow: '0 2px 8px #000', fontSize: 90, opacity: 0.9 },
        }),
      ],
    };

    expect(backgroundLayers(slide.background)[0]!.background).toBe('linear-gradient(#111,#333)');

    const el = drawableElements(slide.elements)[0]!;
    expect(positionStyle(el).transform).toBe('rotate(-3deg)');
    const css = typographyAndBox(el.style);
    expect(css.boxShadow).toBe('0 2px 8px #000');
    expect(css.opacity).toBe(0.9);
    expect(css.fontSize).toBe(90);
  });
});
