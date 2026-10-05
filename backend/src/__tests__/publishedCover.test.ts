import { describe, it, expect } from 'vitest';
import { coverFromHtmlRender } from '../lib/publishedCover';
import { buildSlideDocument } from '../lib/htmlDesign';

describe('coverFromHtmlRender', () => {
  it('lê as dimensões do documento que o próprio sistema gera', () => {
    const doc = buildSlideDocument({ html: '<h1>Oi</h1>' }, ['Inter'], 1920, 1080);
    expect(coverFromHtmlRender(doc)).toMatchObject({ width: 1920, height: 1080, html: doc });
  });

  it('funciona também para formatos de carrossel', () => {
    const doc = buildSlideDocument({ html: '<p>x</p>' }, ['Inter'], 1080, 1350);
    expect(coverFromHtmlRender(doc)).toMatchObject({ width: 1080, height: 1350 });
  });

  it('sem documento, vazio ou sem dimensões legíveis: null', () => {
    expect(coverFromHtmlRender(null)).toBeNull();
    expect(coverFromHtmlRender(undefined)).toBeNull();
    expect(coverFromHtmlRender('')).toBeNull();
    expect(coverFromHtmlRender('<html><body>sem tamanho</body></html>')).toBeNull();
  });

  it('recusa dimensões absurdas', () => {
    expect(coverFromHtmlRender('html,body{width:5px;height:5px')).toBeNull();
  });

  it('recusa um documento gigante, para a lista não inflar', () => {
    const grande = `html,body{width:1920px;height:1080px${'x'.repeat(250_000)}`;
    expect(coverFromHtmlRender(grande)).toBeNull();
  });

  it('extrai o primeiro título do slide, sem tags nem espaços sobrando', () => {
    const doc = buildSlideDocument({ html: '<div><h1 class="t">A Arte da <em>Curadoria</em>\n  Estratégica</h1><h2>outro</h2></div>' }, ['Inter'], 1920, 1080);
    expect(coverFromHtmlRender(doc)!.title).toBe('A Arte da Curadoria Estratégica');
  });

  it('não confunde com texto do <style> e devolve null quando não há título', () => {
    const doc = buildSlideDocument({ html: '<p>só parágrafo</p>', css: '.h1{color:red}' }, ['Inter'], 1920, 1080);
    expect(coverFromHtmlRender(doc)!.title).toBeNull();
  });

  it('corta títulos longos', () => {
    const doc = buildSlideDocument({ html: `<h1>${'palavra '.repeat(40)}</h1>` }, ['Inter'], 1920, 1080);
    const t = coverFromHtmlRender(doc)!.title!;
    expect(t.length).toBeLessThanOrEqual(90);
    expect(t.endsWith('…')).toBe(true);
  });
});
