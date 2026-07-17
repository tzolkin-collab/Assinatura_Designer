import { describe, it, expect } from 'vitest';
import { sanitizeSlideHtml, sanitizeSlideCss } from '../lib/htmlDesign.js';

describe('sanitizeSlideHtml (verificação da correção)', () => {
  it('bloqueia script sem tag de fechamento (o bypass que existia)', () => {
    expect(sanitizeSlideHtml('<script src="http://evil/x.js">')).not.toMatch(/script/i);
  });
  it('bloqueia script em maiusculas sem fechamento', () => {
    expect(sanitizeSlideHtml('<SCRIPT SRC="http://evil/x.js">')).not.toMatch(/script/i);
  });
  it('bloqueia handlers e iframes', () => {
    const out = sanitizeSlideHtml('<svg onload=alert(1)></svg><iframe srcdoc="<script>x</script>"></iframe>');
    expect(out).not.toMatch(/onload|iframe|script/i);
  });
  it('preserva o design: estilos inline, SVG e imagem data:', () => {
    const out = sanitizeSlideHtml('<div style="color:#fff"><svg><circle cx="5"/></svg><img src="data:image/png;base64,AAA"></div>');
    expect(out).toMatch(/style="color/);
    expect(out).toMatch(/svg|circle/);
    expect(out).toMatch(/data:image\/png/);
  });
});

describe('sanitizeSlideCss (verificação da correção)', () => {
  it('impede fechar o <style> e emendar tag', () => {
    expect(sanitizeSlideCss('body{}</style><script src="http://evil/x.js">')).not.toMatch(/<\/style>|<script/i);
  });
  it('remove @import e expression', () => {
    expect(sanitizeSlideCss('@import url("http://evil/x.css"); a{width:expression(alert(1))}')).not.toMatch(/@import|expression\(/i);
  });
  it('preserva CSS legitimo, inclusive seletor com >', () => {
    const out = sanitizeSlideCss('.a > .b { color: #fff; background: url(data:image/png;base64,AAA); }');
    expect(out).toContain('.a > .b');
    expect(out).toContain('#fff');
  });
});
