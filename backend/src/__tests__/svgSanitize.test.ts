import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';
import {
  sanitizeSvg,
  sanitizeCss,
  prepareStorableFile,
  looksLikeSvg,
  InvalidSvgError,
  MAX_SVG_BYTES,
  SANITIZE_WORKER_TIMEOUT_MS,
} from '../lib/svgSanitize';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XMLNS = 'xmlns="http://www.w3.org/2000/svg"';
const XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"';

const window = new JSDOM('').window;

function parseXml(svg: string): Document {
  const doc = new window.DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.getElementsByTagName('parsererror').length, 'a saída precisa ser XML bem-formado').toBe(0);
  return doc;
}

const PROIBIDOS = ['script', 'foreignobject', 'iframe', 'object', 'embed', 'form', 'animate', 'set', 'link', 'meta', 'base'];
const RASTER = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i;

/**
 * Asserção estrutural em cima da saída PARSEADA, não de trecho de string: é o que o
 * browser executaria. Um payload "neutralizado" só conta se nada disto sobrar.
 */
function assertNeutro(svg: string): Document {
  const doc = parseXml(svg);
  expect(doc.documentElement.localName).toBe('svg');
  expect(doc.documentElement.namespaceURI).toBe(SVG_NS);

  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    const tag = el.localName.toLowerCase();
    expect(el.namespaceURI, `<${tag}> fora do namespace SVG`).toBe(SVG_NS);
    expect(PROIBIDOS, `elemento proibido <${tag}>`).not.toContain(tag);

    for (const attr of Array.from(el.attributes)) {
      const nome = attr.name.toLowerCase();
      const valor = attr.value.trim();
      expect(nome.startsWith('on'), `atributo de evento ${nome}`).toBe(false);
      if (nome === 'href' || nome.endsWith(':href')) {
        expect(valor.startsWith('#') || RASTER.test(valor), `href não interno: ${valor.slice(0, 40)}`).toBe(true);
      }
      expect(/^(?:java|vb)script:/i.test(valor.replace(/\s+/g, '')), `esquema script em ${nome}`).toBe(false);
      if (nome === 'style' || /url\s*\(/i.test(valor)) {
        expect(valor).not.toMatch(/@import/i);
        for (const m of valor.matchAll(/url\(\s*["']?([^)"']*)/gi)) {
          expect(m[1]!.trim().startsWith('#') || RASTER.test(m[1]!.trim()), `url() externo em ${nome}`).toBe(true);
        }
      }
    }
    if (tag === 'style') {
      const css = el.textContent ?? '';
      expect(css).not.toMatch(/@import/i);
      for (const m of css.matchAll(/url\(\s*["']?([^)"']*)/gi)) {
        expect(m[1]!.trim().startsWith('#') || RASTER.test(m[1]!.trim()), 'url() externo em <style>').toBe(true);
      }
    }
  }
  return doc;
}

// ── (a) Payloads que PRECISAM ser neutralizados ────────────────────────────────

describe('sanitizeSvg — payloads de XSS neutralizados', () => {
  // Os três que a anotação de 02/08 registrou como bypass do sanitizeSvg antigo.
  const ANOTACAO_0208: Array<[string, string]> = [
    ['fechamento de script com espaço antes do >', `<svg ${XMLNS}><rect width="10" height="10"/><script>alert(1)</script ></svg>`],
    ['onload sem aspas', `<svg ${XMLNS} onload=alert(1)><rect width="10" height="10"/></svg>`],
    ['svg/onload com barra no lugar do espaço', `<svg/onload=alert(1) ${XMLNS}><rect width="10" height="10"/></svg>`],
  ];

  const OUTROS: Array<[string, string]> = [
    ['script dentro do svg', `<svg ${XMLNS}><g><script>alert(document.domain)</script><rect width="10" height="10"/></g></svg>`],
    ['a com xlink:href javascript:', `<svg ${XMLNS} ${XLINK}><a xlink:href="javascript:alert(1)"><text x="1" y="9">x</text></a></svg>`],
    ['a com href javascript:', `<svg ${XMLNS}><a href="javascript:alert(1)"><text x="1" y="9">x</text></a></svg>`],
    ['image com href javascript:', `<svg ${XMLNS}><image href="javascript:alert(1)" width="10" height="10"/></svg>`],
    ['foreignObject com iframe', `<svg ${XMLNS}><foreignObject width="100" height="100"><iframe src="javascript:alert(1)"></iframe><body onload="alert(1)"></body></foreignObject></svg>`],
    ['style com @import de URL externa', `<svg ${XMLNS}><style>@import url("https://evil.example/x.css"); .a{fill:red}</style><rect class="a" width="10" height="10"/></svg>`],
    ['set com attributeName onmouseover', `<svg ${XMLNS}><rect width="10" height="10"><set attributeName="onmouseover" to="alert(1)"/></rect></svg>`],
    ['animate com values javascript:', `<svg ${XMLNS}><a href="#x"><animate attributeName="href" values="javascript:alert(1)" dur="1s" fill="freeze"/><text x="1" y="9">x</text></a></svg>`],
    ['animateTransform mirando evento', `<svg ${XMLNS}><rect width="10" height="10"><animateTransform attributeName="onclick" to="alert(1)"/></rect></svg>`],
    ['entidades numéricas em javascript:', `<svg ${XMLNS} ${XLINK}><a xlink:href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)"><text x="1" y="9">x</text></a></svg>`],
    ['entidade de tab dentro de javascript:', `<svg ${XMLNS}><a href="jav&#x09;ascript:alert(1)"><text x="1" y="9">x</text></a></svg>`],
    ['case misturado ScRiPt', `<svg ${XMLNS}><ScRiPt>alert(1)</ScRiPt><rect width="10" height="10"/></svg>`],
    ['CDATA embrulhando script', `<svg ${XMLNS}><![CDATA[<script>alert(1)</script>]]><rect width="10" height="10"/></svg>`],
    ['CDATA que fecha o style e abre script', `<svg ${XMLNS}><style><![CDATA[</style><script>alert(1)</script>]]></style></svg>`],
    ['use apontando para URL externa', `<svg ${XMLNS} ${XLINK}><use href="https://evil.example/x.svg#a"/><use xlink:href="//evil.example/x.svg#a"/></svg>`],
    ['style="" com url() externo', `<svg ${XMLNS}><rect width="10" height="10" style="fill:url(https://evil.example/x); stroke:red"/></svg>`],
    ['fill="url(http…)" externo', `<svg ${XMLNS}><rect width="10" height="10" fill="url(http://evil.example/x#a)"/></svg>`],
    ['a com data:text/html', `<svg ${XMLNS}><a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="><text x="1" y="9">x</text></a></svg>`],
    ['CSS com escape hexadecimal (\\75rl)', `<svg ${XMLNS}><style>.a{background:\\75rl(https://evil.example/x)}</style><rect class="a"/></svg>`],
    ['onload com quebra de linha e tab', `<svg ${XMLNS}\nonload\n=\n"alert(1)"\t><rect width="10" height="10"/></svg>`],
    ['script com href/xlink:href de dados', `<svg ${XMLNS} ${XLINK}><script href="data:text/javascript,alert(1)"/><script xlink:href="data:text/javascript,alert(1)"/></svg>`],
    ['object, embed e form direto no svg', `<svg ${XMLNS}><object data="javascript:alert(1)"></object><embed src="javascript:alert(1)"/><form action="javascript:alert(1)"><input/></form></svg>`],
    ['mXSS clássico com style e id', `<svg ${XMLNS}><style><a id="</style><img src=x onerror=alert(1)>"></style></svg>`],
    ['svg dentro de página HTML', `<html><body><svg onload="alert(1)" ${XMLNS}><rect width="10" height="10"/></svg></body></html>`],
    ['elemento com prefixo apontando para XHTML', `<svg ${XMLNS} xmlns:x="http://www.w3.org/1999/xhtml"><x:script>alert(1)</x:script><rect width="10" height="10"/></svg>`],
    ['DOCTYPE com entidade', `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "<script>alert(1)</script>">]><svg ${XMLNS}><text>&x;</text></svg>`],
  ];

  for (const [nome, payload] of [...ANOTACAO_0208, ...OUTROS]) {
    it(`neutraliza: ${nome}`, async () => {
      const r = await sanitizeSvg(payload);
      assertNeutro(r.svg);
      // O buffer devolvido é exatamente o texto (é ele que vai ao R2).
      expect(r.buffer.toString('utf-8')).toBe(r.svg);
    });
  }

  it('os três bypasses da anotação de 02/08 saem sem script nem onload no texto final', async () => {
    for (const [, payload] of ANOTACAO_0208) {
      const { svg } = await sanitizeSvg(payload);
      expect(svg).not.toMatch(/<script/i);
      expect(svg).not.toMatch(/onload/i);
    }
  });

  it('relata o que removeu', async () => {
    const { removed } = await sanitizeSvg(`<svg ${XMLNS} onload=alert(1)><script>alert(1)</script><a href="javascript:alert(1)"><text>x</text></a></svg>`);
    const nomes = removed.map((r) => r.name.toLowerCase()).join(' | ');
    expect(nomes).toContain('script');
    expect(nomes).toContain('onload');
    expect(nomes).toContain('href');
    expect(removed.length).toBeGreaterThanOrEqual(3);
  });

  it('@import removido mas o resto do CSS do <style> continua', async () => {
    const { svg } = await sanitizeSvg(`<svg ${XMLNS}><style>@import url("https://evil.example/x.css"); .a{fill:red}</style><rect class="a" width="10" height="10"/></svg>`);
    const doc = assertNeutro(svg);
    expect(doc.getElementsByTagName('style')[0]!.textContent).toContain('.a{fill:red}');
  });

  it('use interno (#id) é mantido; use externo perde só o href', async () => {
    const { svg } = await sanitizeSvg(`<svg ${XMLNS} ${XLINK}><defs><g id="m"><rect width="5" height="5"/></g></defs><use href="#m"/><use xlink:href="#m"/><use href="https://evil.example/x.svg#m"/></svg>`);
    const doc = parseXml(svg);
    const uses = Array.from(doc.getElementsByTagName('use'));
    expect(uses).toHaveLength(3);
    expect(uses[0]!.getAttribute('href')).toBe('#m');
    expect(uses[1]!.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe('#m');
    expect(uses[2]!.hasAttribute('href')).toBe(false);
  });
});

describe('sanitizeSvg — entradas que não são SVG', () => {
  it('lança InvalidSvgError (tipado) quando não sobra raiz <svg>', async () => {
    for (const lixo of [
      '<html><body><script>alert(1)</script></body></html>',
      '<script><svg></script>',
      'texto qualquer',
      '',
      '<foreignObject><svg/></foreignObject>',
    ]) {
      await expect(sanitizeSvg(lixo), lixo).rejects.toThrow(InvalidSvgError);
    }
  });

  it('o erro carrega code INVALID_SVG para o errorHandler decidir o HTTP', async () => {
    try {
      await sanitizeSvg('nada');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidSvgError);
      expect((e as InvalidSvgError).code).toBe('INVALID_SVG');
    }
  });

  it('recusa binário/UTF-16 (NUL no conteúdo) em vez de decodificar como lixo', async () => {
    const utf16 = Buffer.from(`<svg ${XMLNS} onload="alert(1)"></svg>`, 'utf16le');
    await expect(sanitizeSvg(utf16)).rejects.toThrow(InvalidSvgError);
  });

  it('aceita Buffer com BOM UTF-8', async () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`<svg ${XMLNS} viewBox="0 0 1 1"><rect width="1" height="1"/></svg>`)]);
    const { svg } = await sanitizeSvg(buf);
    expect(parseXml(svg).documentElement.getAttribute('viewBox')).toBe('0 0 1 1');
  });
});

// ── (b) Conteúdo legítimo preservado ────────────────────────────────────────────

const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const LOGO_BRANDBOOK = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: Adobe Illustrator 27 -->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg version="1.1" id="Layer_1" ${XMLNS} ${XLINK} x="0px" y="0px" viewBox="0 0 240 80" preserveAspectRatio="xMidYMid meet" xml:space="preserve" role="img" aria-label="Logo Marca" data-name="Logo">
  <title>Logo Marca</title>
  <desc>Logotipo horizontal</desc>
  <defs>
    <linearGradient id="grad1" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="240" y2="0" gradientTransform="rotate(10)">
      <stop offset="0" stop-color="#C2103F"/>
      <stop offset="1" style="stop-color:#3A0D1B;stop-opacity:0.9"/>
    </linearGradient>
    <radialGradient id="rad1" cx="40" cy="40" r="40" xlink:href="#grad1"/>
    <clipPath id="clip1"><rect x="0" y="0" width="80" height="80"/></clipPath>
    <mask id="mask1"><rect width="80" height="80" fill="#fff"/></mask>
    <filter id="soft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur in="SourceGraphic" stdDeviation="1.5"/></filter>
    <symbol id="mark" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="url(#rad1)"/></symbol>
    <style type="text/css"><![CDATA[
      .st0{fill:url(#grad1);}
      .st1{font-family:'Monument Extended',sans-serif;font-size:22px;fill:#3A0D1B;}
      .wordmark > .st1{letter-spacing:0.05em;}
    ]]></style>
  </defs>
  <g id="icone" clip-path="url(#clip1)" mask="url(#mask1)" filter="url(#soft)">
    <use href="#mark" x="0" y="0" width="80" height="80"/>
    <use xlink:href="#mark" x="10" y="10" width="20" height="20" transform="rotate(5)"/>
  </g>
  <g class="wordmark">
    <path class="st0" d="M100,10 L140,10 L120,40 Z"/>
    <text class="st1" x="90" y="60" text-anchor="start">ASSI&#160;NATURA <tspan dy="2" font-weight="700">2026</tspan></text>
  </g>
  <image width="1" height="1" xlink:href="data:image/png;base64,${PNG_1x1}"/>
</svg>`;

/** Descrição semântica da árvore: elemento + atributos (ordenados) + texto. Sem xmlns/comentários. */
function descrever(node: Element, prof = 0): string[] {
  const attrs = Array.from(node.attributes)
    .filter((a) => !a.name.startsWith('xmlns'))
    .map((a) => `${a.name}=${a.value.replace(/\s+/g, ' ').trim()}`)
    .sort();
  const texto = Array.from(node.childNodes)
    .filter((n) => n.nodeType === 3 || n.nodeType === 4)
    .map((n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('|');
  const linha = `${' '.repeat(prof)}${node.localName}[${attrs.join(';')}]${texto ? `{${texto}}` : ''}`;
  return [linha, ...Array.from(node.children).flatMap((c) => descrever(c, prof + 1))];
}

describe('sanitizeSvg — conteúdo legítimo de brandbook sai semanticamente intacto', () => {
  it('mesma árvore de elementos, atributos e textos (compara estrutura, não a string)', async () => {
    const entrada = parseXml(LOGO_BRANDBOOK);
    const { svg } = await sanitizeSvg(LOGO_BRANDBOOK);
    const saida = parseXml(svg);
    expect(descrever(saida.documentElement)).toEqual(descrever(entrada.documentElement));
  });

  it('não relata nada como removido', async () => {
    const { removed } = await sanitizeSvg(LOGO_BRANDBOOK);
    expect(removed).toEqual([]);
  });

  it('mantém viewBox, preserveAspectRatio, namespaces e ids', async () => {
    const { svg } = await sanitizeSvg(LOGO_BRANDBOOK);
    const saida = parseXml(svg);
    const root = saida.documentElement;
    expect(root.getAttribute('viewBox')).toBe('0 0 240 80');
    expect(root.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect(root.namespaceURI).toBe(SVG_NS);
    expect(root.getAttributeNS('http://www.w3.org/2000/xmlns/', 'xlink')).toBe('http://www.w3.org/1999/xlink');
    for (const id of ['grad1', 'rad1', 'clip1', 'mask1', 'soft', 'mark', 'icone']) {
      expect(saida.getElementById(id) ?? saida.querySelector(`[id="${id}"]`), `#${id}`).toBeTruthy();
    }
  });

  it('preserva o CSS interno e o raster embutido em base64', async () => {
    const { svg } = await sanitizeSvg(LOGO_BRANDBOOK);
    const saida = parseXml(svg);
    const css = saida.getElementsByTagName('style')[0]!.textContent ?? '';
    expect(css).toContain('.st0{fill:url(#grad1);}');
    expect(css).toContain("'Monument Extended'");
    expect(css).toContain('.wordmark > .st1');
    const img = saida.getElementsByTagName('image')[0]!;
    expect(img.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe(`data:image/png;base64,${PNG_1x1}`);
  });

  it('o espaço não separável não vira &nbsp; (entidade inexistente em XML)', async () => {
    const { svg } = await sanitizeSvg(LOGO_BRANDBOOK);
    const saida = parseXml(svg);
    expect(svg).not.toContain('&nbsp;');
    expect(saida.getElementsByTagName('text')[0]!.textContent).toContain(String.fromCharCode(0xa0) + 'NATURA');
  });

  it('continua rasterizável pelo sharp (é o que o pipeline faz depois)', async () => {
    const { svg } = await sanitizeSvg(LOGO_BRANDBOOK);
    const png = await sharp(Buffer.from(svg), { failOnError: false }).png().toBuffer();
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBeGreaterThan(0);
  });

  it('é idempotente: sanitizar o resultado devolve o mesmo SVG', async () => {
    const { svg } = await sanitizeSvg(LOGO_BRANDBOOK);
    const outra = await sanitizeSvg(svg);
    expect(outra.svg).toBe(svg);
  });

  it('SVG mínimo sem xmlns declarado sai com o namespace correto (senão o browser não renderiza)', async () => {
    const r = await sanitizeSvg('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>');
    expect(r.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });
});

describe('sanitizeCss', () => {
  it('mantém CSS comum e remove só o que carrega de fora', () => {
    const { css, issues } = sanitizeCss('.a{fill:#fff;font-family:"Aileron"} .b{fill:url(#g)} .c{background:url(https://x.test/a.png)}');
    expect(css).toContain('.a{fill:#fff;font-family:"Aileron"}');
    expect(css).toContain('.b{fill:url(#g)}');
    expect(css).not.toContain('x.test');
    expect(issues.length).toBe(1);
  });

  it('não decodifica escape legítimo quando não há nada escondido', () => {
    const { css, issues } = sanitizeCss('.md\\:flex{fill:red}');
    expect(css).toBe('.md\\:flex{fill:red}');
    expect(issues).toEqual([]);
  });

  it('@import sem ";" antes de um bloco também é removido (antes sobrevivia ao stripCss)', () => {
    // A garantia "nenhum @import externo sobrevive" era falsa: o regex antigo só parava
    // em ";" ou fim de string, então "@import" sem ";" antes do próximo "{"/"}" nunca
    // combinava e ficava intacto no CSS gravado.
    const { css, issues } = sanitizeCss(`@import 'https://evil.example/x.css'{.a{fill:red}}`);
    expect(css).not.toMatch(/@import/i);
    expect(css).not.toContain('evil.example');
    expect(issues).toContain('@import');
  });
});

// ── Pool piscina + timeout: a fronteira de segurança contra DoS ─────────────────
// (o preflight de tokenização foi REMOVIDO — ver svgSanitize.ts) ────────────────
//
// Três rodadas de revisão adversarial foram gastas corrigindo bypass atrás de bypass
// num `preflightCheck` escrito à mão que tentava replicar regras de tokenização do
// HTML5 (self-closing, foreign content, CDATA opaco, pilha de fechamento, agregação de
// CSS) só para rejeitar ANTES de montar a árvore no jsdom. Cada correção pontual abria
// um bypass novo — sinal de que reimplementar um parser adversarialmente correto por
// patch pontual não converge. O preflight foi removido (não substituído por uma
// versão mais esperta): a garantia contra payload lento agora é estrutural — o teto de
// tempo POR TAREFA do pool piscina (`SANITIZE_WORKER_TIMEOUT_MS`), que mata a thread
// inteira se estourar, não importa qual caminho do parser o payload explora.
//
// Os dois testes abaixo reproduzem os dois tipos de custo já medidos nas rodadas
// anteriores (aninhamento profundo — custo do jsdom/DOMPurify percorrendo a árvore — e
// CSS quase do tamanho do teto de arquivo — custo do stripCss mesmo com o lookahead já
// limitado) e provam que, SEM preflight nenhum, o pool ainda corta o tempo bem antes do
// que o payload levaria se rodasse até o fim (13-35s medidos nas rodadas anteriores).
describe('sanitizeSvg — pool com timeout é a fronteira de segurança (sem preflight de tokenização)', () => {
  // Generoso o bastante pra não ser "flaky" em CI sob CPU MUITO concorrente (rodando a
  // suíte inteira em paralelo — dezenas de arquivos de teste, vários subindo suas
  // próprias threads jsdom/piscina — e sem preflight o payload roda até o teto de
  // verdade, não é cortado no primeiro microssegundo) — mas continua bem abaixo dos
  // 13-35s que estes payloads levavam pra completar antes desta rodada.
  const TETO_MS = SANITIZE_WORKER_TIMEOUT_MS + 3000;
  const XMLNS_LOCAL = 'xmlns="http://www.w3.org/2000/svg"';

  /** Tempo real com Date.now() antes/depois — sem fake timers, é o event loop de verdade. */
  async function medir<T>(fn: () => Promise<T>): Promise<{ ms: number; erro?: unknown }> {
    const t0 = Date.now();
    try {
      await fn();
      return { ms: Date.now() - t0 };
    } catch (erro) {
      return { ms: Date.now() - t0, erro };
    }
  }

  it('aninhamento profundo (<g> repetido, 50.000 níveis) é cortado pelo teto do pool, não processado até o fim', async () => {
    const n = 50_000; // a mesma escala que levava ~35s antes desta rodada (sem preflight).
    const payload = `<svg ${XMLNS_LOCAL}>${'<g>'.repeat(n)}${'</g>'.repeat(n)}</svg>`;

    const { ms, erro } = await medir(() => sanitizeSvg(payload));

    expect(erro).toBeInstanceOf(InvalidSvgError);
    expect((erro as InvalidSvgError).code).toBe('INVALID_SVG');
    expect(ms, `levou ${ms}ms (teto ${TETO_MS}ms)`).toBeLessThan(TETO_MS);
  }, 15_000);

  it('CSS quase do tamanho do teto de arquivo (2MB, "url(" sem fechar repetido) é cortado pelo teto do pool', async () => {
    const alvo = MAX_SVG_BYTES - 2000; // perto do teto de bytes do arquivo inteiro.
    const css = 'url('.repeat(Math.ceil(alvo / 4));
    const payload = `<svg ${XMLNS_LOCAL}><style>${css}</style><rect width="1" height="1"/></svg>`;

    const { ms, erro } = await medir(() => sanitizeSvg(payload));

    expect(erro).toBeInstanceOf(InvalidSvgError);
    expect(ms, `levou ${ms}ms (teto ${TETO_MS}ms) — sem preflight, isto levava mais de 10s síncronos antes desta rodada`).toBeLessThan(TETO_MS);
  }, 15_000);

  it('(controle) SVG legítimo de brandbook continua sanitizado corretamente e rápido, sem preflight nenhum', async () => {
    const t0 = Date.now();
    const { removed, svg } = await sanitizeSvg(LOGO_BRANDBOOK);
    const ms = Date.now() - t0;
    expect(removed).toEqual([]);
    expect(parseXml(svg).documentElement.getAttribute('viewBox')).toBe('0 0 240 80');
    // Bem abaixo do teto (não é "quase timeout") mesmo sob CPU concorrente — a
    // sanitização em si custa poucos ms; a folga é pra escalonamento sob contenção.
    expect(ms, `levou ${ms}ms (bem abaixo do teto de ${SANITIZE_WORKER_TIMEOUT_MS}ms)`).toBeLessThan(SANITIZE_WORKER_TIMEOUT_MS - 1000);
  }, 10_000);

  it('SANITIZE_WORKER_TIMEOUT_MS e MAX_SVG_BYTES são exportados para calibrar estes testes', () => {
    expect(SANITIZE_WORKER_TIMEOUT_MS).toBeGreaterThan(0);
    expect(MAX_SVG_BYTES).toBeGreaterThan(0);
  });
});

// ── Regressão B1: SVG legítimo concorrente não é penalizado por payload lento ───
// (achado de uma revisão adversarial independente sobre o commit anterior, que usava
// UM worker persistente com fila escrita à mão) ─────────────────────────────────
//
// Bug relatado e reproduzido de forma determinística contra o código anterior: com um
// worker ÚNICO e uma fila manual, o timer de CADA chamada começava no ENFILEIRAMENTO
// (quando a mensagem era enviada), não quando o worker de fato começava a processá-la.
// Duas chamadas concorrentes (upload de dois usuários diferentes, por rotas
// diferentes) competiam pela MESMA fila — um SVG legítimo e trivial enfileirado atrás
// de um payload lento era rejeitado por timeout JUNTO com o payload lento, mesmo sem
// ter custado nada de verdade.
//
// piscina, configurado para crescer sob demanda até `maxThreads` (>=2 — ver
// `getPool()`), despacha duas chamadas concorrentes para DUAS threads ociosas, não
// para a mesma fila: o SVG legítimo roda em paralelo de verdade com o payload lento,
// não atrás dele. Este teste dispara os dois AO MESMO TEMPO e mede o tempo de parede
// real do legítimo (Date.now(), sem fake timers) — ele precisa terminar rápido e com
// sucesso, independentemente do que acontece com o payload lento.
describe('sanitizeSvg — concorrência: SVG legítimo não é penalizado por payload lento concorrente (B1)', () => {
  const XMLNS_LOCAL = 'xmlns="http://www.w3.org/2000/svg"';

  it('SVG legítimo disparado ao mesmo tempo que um payload lento termina rápido e com sucesso', async () => {
    const n = 50_000; // mesmo payload lento do describe acima — leva até SANITIZE_WORKER_TIMEOUT_MS até o pool matar a thread.
    const payloadLento = `<svg ${XMLNS_LOCAL}>${'<g>'.repeat(n)}${'</g>'.repeat(n)}</svg>`;
    const svgLegitimo = `<svg ${XMLNS_LOCAL} viewBox="0 0 10 10"><rect width="10" height="10" fill="#c2103f"/></svg>`;

    const [lento, legitimo] = await Promise.allSettled([
      sanitizeSvg(payloadLento),
      (async () => {
        const t0 = Date.now();
        const resultado = await sanitizeSvg(svgLegitimo);
        return { resultado, ms: Date.now() - t0 };
      })(),
    ]);

    // A garantia central deste teste: o legítimo teve SUCESSO e foi RÁPIDO. Se ele
    // tivesse competido pela mesma fila/timer do payload lento (o bug B1), teria sido
    // rejeitado por timeout ou levado quase o mesmo tempo do payload lento (perto de
    // SANITIZE_WORKER_TIMEOUT_MS) — em vez de rodar em paralelo, numa thread própria.
    expect(legitimo.status, 'o SVG legítimo não pode falhar por causa do payload lento concorrente').toBe('fulfilled');
    if (legitimo.status === 'fulfilled') {
      // Bem abaixo do teto — a folga extra (contra o teste isolado acima) é porque
      // aqui há DUAS tarefas competindo por CPU de verdade (uma delas pesada).
      expect(legitimo.value.ms, `o legítimo levou ${legitimo.value.ms}ms rodando ao lado do payload lento`).toBeLessThan(SANITIZE_WORKER_TIMEOUT_MS - 1500);
      expect(legitimo.value.resultado.removed).toEqual([]);
      expect(parseXml(legitimo.value.resultado.svg).documentElement.getAttribute('viewBox')).toBe('0 0 10 10');
    }

    // O payload lento (numa thread separada, em paralelo) ainda é cortado pelo teto do
    // pool — não "escapa" do timeout só porque outra tarefa concorrente é rápida.
    expect(lento.status).toBe('rejected');
    if (lento.status === 'rejected') {
      expect(lento.reason).toBeInstanceOf(InvalidSvgError);
    }
  }, SANITIZE_WORKER_TIMEOUT_MS + 5_000);
});

// ── Política de gravação (tipo declarado pelo cliente não manda) ────────────────

describe('prepareStorableFile', () => {
  const svgSujo = Buffer.from(`<svg ${XMLNS} onload="alert(1)"><script>alert(1)</script><rect width="1" height="1"/></svg>`);

  it('SVG declarado como text/html é tratado como SVG: higienizado e servido como image/svg+xml', async () => {
    const r = await prepareStorableFile({ buffer: svgSujo, fileName: 'logo.svg', mimeType: 'text/html' });
    expect(r.mimeType).toBe('image/svg+xml');
    assertNeutro(r.buffer.toString('utf-8'));
    expect(r.contentDisposition).toBe('attachment');
  });

  it('SVG disfarçado de octet-stream/sem extensão é descoberto pelo conteúdo', async () => {
    const r = await prepareStorableFile({ buffer: svgSujo, fileName: 'arquivo', mimeType: 'application/octet-stream' });
    expect(r.mimeType).toBe('image/svg+xml');
    assertNeutro(r.buffer.toString('utf-8'));
  });

  it('HTML de verdade nunca sai como text/html: vira download', async () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const r = await prepareStorableFile({ buffer: html, fileName: 'pagina.html', mimeType: 'text/html; charset=utf-8' });
    expect(r.mimeType).toBe('application/octet-stream');
    expect(r.contentDisposition).toBe('attachment');
    expect(r.buffer).toBe(html);
  });

  it('xml/xhtml também viram download', async () => {
    for (const mimeType of ['application/xhtml+xml', 'text/xml', 'application/xml']) {
      const r = await prepareStorableFile({ buffer: Buffer.from('<a/>'), fileName: 'x.xml', mimeType });
      expect(r.mimeType).toBe('application/octet-stream');
    }
  });

  it('raster e outros tipos passam intactos (sem sniff, sem copiar)', async () => {
    const png = Buffer.from(PNG_1x1, 'base64');
    const r = await prepareStorableFile({ buffer: png, fileName: 'a.png', mimeType: 'image/png' });
    expect(r.buffer).toBe(png);
    expect(r.mimeType).toBe('image/png');
    expect(r.contentDisposition).toBeUndefined();
    const pptx = await prepareStorableFile({ buffer: Buffer.from('x'), fileName: 'a.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    expect(pptx.mimeType).toContain('presentationml');
  });

  it('arquivo .svg que não é SVG lança InvalidSvgError', async () => {
    await expect(prepareStorableFile({ buffer: Buffer.from('<html><script>alert(1)</script></html>'), fileName: 'x.svg', mimeType: 'image/svg+xml' })).rejects.toThrow(InvalidSvgError);
  });

  it('buffer já higienizado por sanitizeSvg não é reprocessado', async () => {
    const limpo = (await sanitizeSvg(svgSujo)).buffer;
    const r = await prepareStorableFile({ buffer: limpo, fileName: 'a.svg', mimeType: 'image/svg+xml' });
    expect(r.buffer).toBe(limpo);
  });

  it('looksLikeSvg enxerga prólogo XML, comentário e doctype antes do <svg', () => {
    expect(looksLikeSvg(Buffer.from(LOGO_BRANDBOOK))).toBe(true);
    expect(looksLikeSvg(Buffer.from('<!doctype html><html><svg></svg></html>'))).toBe(false);
  });
});
