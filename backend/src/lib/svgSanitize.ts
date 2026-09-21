// Higienização de SVG enviado por usuário ou produzido por IA.
//
// Por que existe: um SVG servido como `image/svg+xml` a partir do bucket público é
// um DOCUMENTO — quem abre a URL numa aba executa o <script>/onload que estiver
// dentro. O sanitizeSvg antigo (imageNormalizer.ts) era uma pilha de regex e caía em
// `</script >`, `onload=x` sem aspas e `<svg/onload=x>`; além disso só rodava antes de
// rasterizar, nunca nos SVGs que iam CRUS para o R2 (assets, brandbook, chat...).
//
// Como funciona, em três camadas — nenhuma depende de regex sobre o markup:
//  1. jsdom monta a árvore e o DOMPurify (perfil SVG) poda o que não é SVG inofensivo;
//  2. uma segunda passada NOSSA aplica o que o DOMPurify não cobre (href só interno,
//     url() só interno, CSS sem @import/url externo, sem animação que mude href/on*);
//  3. o resultado é serializado como XML de verdade (não innerHTML) e relido por um
//     parser XML: se não for bem-formado ou se a passada 2 ainda achar algo para
//     remover, falha fechado com InvalidSvgError em vez de gravar.

import createDOMPurify, { type WindowLike } from 'dompurify';
import { JSDOM } from 'jsdom';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Mesmo teto do multer (10MB): acima disso não vale a pena montar a árvore. */
export const MAX_SVG_BYTES = 10 * 1024 * 1024;

/**
 * O conteúdo não é um SVG utilizável (sem raiz <svg>, binário, grande demais ou
 * irrecuperável). O chamador decide a resposta HTTP — o errorHandler global mapeia
 * o `code` para 400.
 */
export class InvalidSvgError extends Error {
  readonly code = 'INVALID_SVG';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSvgError';
  }
}

export interface SvgRemoval {
  kind: 'element' | 'attribute' | 'style';
  /** Nome do elemento/atributo (ou o construto de CSS) que saiu. */
  name: string;
  reason: string;
}

export interface SanitizeSvgResult {
  svg: string;
  buffer: Buffer;
  removed: SvgRemoval[];
}

// ── Ambiente jsdom/DOMPurify (preguiçoso: só paga o custo quem sanitiza SVG) ────
let env: { window: JSDOM['window']; purify: ReturnType<typeof createDOMPurify> } | null = null;
function getEnv() {
  if (!env) {
    const window = new JSDOM('').window;
    env = { window, purify: createDOMPurify(window as unknown as WindowLike) };
  }
  return env;
}

// Buffers que ESTE módulo já higienizou. Sem isto, a rota sanitiza e o uploadFileToR2
// (que também protege, para quem esquecer) reprocessaria o mesmo SVG uma segunda vez.
const jaHigienizados = new WeakSet<Buffer>();

// Elementos que nunca ficam, mesmo se algum dia o perfil do DOMPurify os permitir.
const FORBIDDEN_TAGS = new Set([
  'script', 'foreignobject', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base',
  'audio', 'video', 'canvas', 'applet', 'frame', 'frameset', 'html', 'head', 'body',
  'handler', 'listener',
  // SMIL que troca atributo: <set attributeName=onmouseover>, <animate attributeName=href
  // values=javascript:...>. Animar logo de brandbook estático não compensa o risco.
  'animate', 'set',
]);

const RASTER_DATA_URI = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]*$/i;

// (Feito por código de caractere, não por classe de regex: os invisíveis Unicode no
// fonte são ilegíveis e o editor já os corrompeu uma vez.)
function semBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Tira o que o browser ignora dentro de um esquema de URL (`java\tscript:`, NBSP, zero-width). */
function compactar(value: string): string {
  let out = '';
  for (const ch of value) {
    const c = ch.charCodeAt(0);
    const ignorado =
      c <= 0x20 || (c >= 0x7f && c <= 0xa0) || c === 0x1680 || (c >= 0x2000 && c <= 0x200f) ||
      (c >= 0x2028 && c <= 0x202f) || c === 0x205f || (c >= 0x2060 && c <= 0x206f) || c === 0x3000 || c === 0xfeff;
    if (!ignorado) out += ch;
  }
  return out.toLowerCase();
}

// Esquema que executa ou embute documento, com a mesma tolerância dos browsers a
// espaço/controle no meio (`java\tscript:`).
function hasDangerousScheme(value: string): boolean {
  const compact = compactar(value);
  return /^(?:javascript|vbscript|livescript|mocha):/.test(compact) || /^data:(?:text\/html|application\/xhtml|text\/xml|application\/xml|image\/svg)/.test(compact);
}

// ── CSS ─────────────────────────────────────────────────────────────────────────
// <style> e style="" podem puxar recurso externo (@import, url()) ou, em engines
// antigas, executar (expression, behavior, -moz-binding). Aqui o alvo é o que carrega
// de fora; o resto do CSS (cores, fontes, classes) passa intacto.

function cssUrlAllowed(target: string): boolean {
  const t = target.trim();
  return t.startsWith('#') || RASTER_DATA_URI.test(t);
}

function stripCss(css: string, issues: string[]): string {
  let out = css;

  out = out.replace(/@import\b[^;{}]*(?:;|$)/gi, () => {
    issues.push('@import');
    return '';
  });

  out = out.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi, (whole, dq, sq, bare) => {
    const target = String(dq ?? sq ?? bare ?? '');
    if (cssUrlAllowed(target)) return whole;
    issues.push(`url(${target.length > 40 ? `${target.slice(0, 40)}…` : target})`);
    // `url(#)` é sintaxe válida e não aponta para lugar nenhum: a declaração continua
    // parseável, só perde o recurso.
    return 'url(#)';
  });

  out = out.replace(/(?:-webkit-)?image-set\s*\([^)]*\)/gi, () => {
    issues.push('image-set()');
    return 'none';
  });

  out = out.replace(/(?:-moz-)?(?:behavior|binding)\s*:[^;}]*/gi, () => {
    issues.push('behavior/binding');
    return '';
  });

  out = out.replace(/expression\s*\(/gi, () => {
    issues.push('expression()');
    return '(';
  });

  out = out.replace(/(?:java|vb)script\s*:/gi, () => {
    issues.push('esquema script:');
    return '';
  });

  return out;
}

function decodeCssEscapes(css: string): string {
  return css.replace(/\\([0-9a-fA-F]{1,6})\s?|\\([\s\S])/g, (_m, hex: string | undefined, ch: string | undefined) => {
    if (hex) {
      const cp = parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : String.fromCharCode(0xfffd);
    }
    return ch ?? '';
  });
}

/**
 * Limpa um trecho de CSS. Escapes (`\75rl(` é `url(` para o browser) escondem o alvo
 * do regex; por isso, se sobrar barra invertida, olhamos também a versão decodificada
 * e, só se ela revelar algo, ficamos com ela. Decodificar sempre mudaria seletor
 * legítimo (`.md\:flex`), então é o último recurso.
 */
export function sanitizeCss(css: string): { css: string; issues: string[] } {
  const issues: string[] = [];
  let out = stripCss(css, issues);

  if (out.includes('\\')) {
    const decodedIssues: string[] = [];
    const decoded = stripCss(decodeCssEscapes(out), decodedIssues);
    if (decodedIssues.length > 0) {
      issues.push(...decodedIssues.map((i) => `${i} (escapado)`));
      out = decoded;
    }
  }

  return { css: out, issues };
}

// ── Segunda passada (regras nossas) ─────────────────────────────────────────────

function enforce(root: Element, removed: SvgRemoval[]): void {
  const elements: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];

  for (const el of elements) {
    if (el !== root && !root.contains(el)) continue; // já saiu junto com um ancestral

    const tag = el.localName.toLowerCase();

    if (el !== root) {
      const foraDoSvg = el.namespaceURI !== SVG_NS;
      if (foraDoSvg || tag.includes(':') || FORBIDDEN_TAGS.has(tag)) {
        removed.push({ kind: 'element', name: `<${tag}>`, reason: foraDoSvg ? 'fora do namespace SVG' : 'elemento proibido' });
        el.remove();
        continue;
      }
    }

    // Animações restantes (animateTransform/Motion/Color) não podem mirar evento/href.
    if (tag.startsWith('animate')) {
      const alvo = (el.getAttribute('attributeName') ?? '').replace(/\s+/g, '').toLowerCase();
      const valores = ['values', 'from', 'to', 'by'].map((a) => el.getAttribute(a) ?? '');
      if (/^on/.test(alvo) || /href$/.test(alvo) || valores.some(hasDangerousScheme)) {
        removed.push({ kind: 'element', name: `<${tag}>`, reason: 'animação que altera evento/href' });
        el.remove();
        continue;
      }
    }

    if (tag === 'style') {
      const { css, issues } = sanitizeCss(el.textContent ?? '');
      if (issues.length > 0) {
        el.textContent = css;
        for (const issue of issues) removed.push({ kind: 'style', name: issue, reason: 'referência externa ou construto perigoso no CSS' });
      }
    }

    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;

      const remover = (reason: string) => {
        removed.push({ kind: 'attribute', name: `${name} (<${tag}>)`, reason });
        el.removeAttributeNode(attr);
      };

      if (name.startsWith('on')) {
        remover('manipulador de evento');
        continue;
      }

      if (name === 'href' || name.endsWith(':href')) {
        const v = value.trim();
        if (v.startsWith('#')) continue; // referência interna: <use href="#id">, gradiente herdado...
        if ((tag === 'image' || tag === 'feimage') && RASTER_DATA_URI.test(v)) continue; // raster embutido (Illustrator faz muito)
        remover(hasDangerousScheme(v) ? 'esquema perigoso no href' : 'referência externa');
        continue;
      }

      if (name === 'style') {
        const { css, issues } = sanitizeCss(value);
        if (issues.length > 0) {
          attr.value = css;
          for (const issue of issues) removed.push({ kind: 'style', name: issue, reason: 'referência externa ou construto perigoso no atributo style' });
        }
        continue;
      }

      if (hasDangerousScheme(value)) {
        remover('esquema perigoso');
        continue;
      }

      if (/url\s*\(/i.test(value)) {
        const issues: string[] = [];
        stripCss(value, issues);
        if (issues.length > 0) remover('url() externo');
      }
    }
  }
}

// ── API ─────────────────────────────────────────────────────────────────────────

function toText(input: string | Buffer): string {
  if (typeof input !== 'string') {
    if (input.length > MAX_SVG_BYTES) throw new InvalidSvgError('SVG muito grande (limite de 10MB).');
    // NUL no meio = UTF-16 ou binário. Decodificar como UTF-8 viraria lixo que o
    // parser ignora — melhor recusar do que gravar algo que o browser lê diferente.
    if (input.includes(0)) throw new InvalidSvgError('Arquivo não é um SVG em texto (UTF-8).');
    return semBom(input.toString('utf-8'));
  }
  if (Buffer.byteLength(input, 'utf-8') > MAX_SVG_BYTES) throw new InvalidSvgError('SVG muito grande (limite de 10MB).');
  return semBom(input);
}

/**
 * Devolve o SVG limpo e a lista do que foi removido. Lança InvalidSvgError se, depois
 * da limpeza, não sobrar uma raiz <svg> bem-formada.
 */
export function sanitizeSvg(input: string | Buffer): SanitizeSvgResult {
  const text = toText(input);
  if (!/<svg[\s/>]/i.test(text)) throw new InvalidSvgError('Conteúdo não é um SVG (raiz <svg> não encontrada).');

  const { window, purify } = getEnv();
  const removed: SvgRemoval[] = [];

  const body = purify.sanitize(text, {
    USE_PROFILES: { svg: true, svgFilters: true },
    // `use` fica de fora do perfil do DOMPurify por padrão; é indispensável em logo e
    // ícone (sprites). O que o torna seguro é a nossa regra de href só interno.
    ADD_TAGS: ['use'],
    // Atributos inofensivos que exportadores (Illustrator, Figma, Inkscape) emitem e o
    // perfil do DOMPurify não conhece; sem eles o logo perde mescla/traço fino.
    ADD_ATTR: ['role', 'focusable', 'vector-effect', 'mix-blend-mode', 'isolation', 'enable-background', 'transform-box', 'pointer-events'],
    FORBID_TAGS: [...FORBIDDEN_TAGS],
    FORBID_ATTR: ['srcdoc', 'formaction'],
    // O SVG não vai para um DOM vivo: proteção contra clobbering só apagaria ids
    // legítimos (`id="body"`, `id="images"`) e quebraria <use href="#...">.
    SANITIZE_DOM: false,
    // Elemento removido leva o conteúdo junto (metadados <i:pgf> do Illustrator etc.).
    KEEP_CONTENT: false,
    RETURN_DOM: true,
  }) as unknown as HTMLElement;

  for (const item of purify.removed as Array<{ element?: Node; attribute?: Attr | null; from?: Node }>) {
    if (item.element) {
      // Prólogo/DOCTYPE fazem o parser HTML abrir <body>/<head> que o próprio DOMPurify
      // descarta: é artefato do envelope, não conteúdo do SVG.
      if (/^(?:body|head|html|remove)$/i.test(item.element.nodeName)) continue;
      removed.push({ kind: 'element', name: `<${item.element.nodeName.toLowerCase()}>`, reason: 'fora do perfil SVG seguro' });
    } else {
      removed.push({ kind: 'attribute', name: `${item.attribute?.name.toLowerCase() ?? '?'} (<${item.from?.nodeName.toLowerCase() ?? '?'}>)`, reason: 'fora do perfil SVG seguro' });
    }
  }

  const roots = Array.from(body.children).filter((c) => c.localName === 'svg' && c.namespaceURI === SVG_NS);
  const root = roots[0];
  if (!root) throw new InvalidSvgError('Nada aproveitável restou do SVG depois da limpeza.');
  if (roots.length > 1) removed.push({ kind: 'element', name: '<svg> extra', reason: 'só a primeira raiz é mantida' });

  enforce(root, removed);

  // Serialização XML (não innerHTML): entidades e namespaces saem corretos e não há
  // re-parse HTML no caminho, então mutação de markup (mXSS) não se aplica.
  const svg = new window.XMLSerializer().serializeToString(root);

  // Verificação final: o que vamos gravar precisa ser XML válido e "estável" — uma
  // nova passada não pode encontrar nada para tirar. Se encontrar, há um furo: recusa.
  const parsed = new window.DOMParser().parseFromString(svg, 'image/svg+xml');
  const parsedRoot = parsed.documentElement;
  if (!parsedRoot || parsedRoot.localName !== 'svg' || parsedRoot.namespaceURI !== SVG_NS || parsed.getElementsByTagName('parsererror').length > 0) {
    throw new InvalidSvgError('O SVG não pôde ser reescrito como XML válido.');
  }
  const sobras: SvgRemoval[] = [];
  enforce(parsedRoot, sobras);
  if (sobras.length > 0) throw new InvalidSvgError('O SVG não pôde ser higienizado com segurança.');

  const buffer = Buffer.from(svg, 'utf-8');
  jaHigienizados.add(buffer);
  return { svg, buffer, removed };
}

// ── Decisão "isto é SVG?" e política de gravação ────────────────────────────────

// Tipos que o browser abre como documento ativo. SVG tem tratamento próprio; estes
// ficam como download (octet-stream + attachment) porque não há o que "limpar" em HTML
// arbitrário que o usuário mandou como arquivo bruto.
const ACTIVE_DOCUMENT_MIMES = new Set([
  'text/html', 'application/xhtml+xml', 'text/xml', 'application/xml', 'application/xslt+xml',
  'text/xsl', 'text/xslt', 'application/mathml+xml', 'application/rdf+xml',
]);

// Só nestes tipos vale espiar o conteúdo à procura de um SVG disfarçado. Raster
// declarado (image/png...) é servido como raster e o browser não o reinterpreta.
const SNIFFABLE_MIMES = new Set(['', 'application/octet-stream', 'text/plain', ...ACTIVE_DOCUMENT_MIMES]);

export function looksLikeSvg(buffer: Buffer): boolean {
  const head = semBom(buffer.subarray(0, 4096).toString('utf-8'));
  const semProlog = head.replace(/^(?:\s|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!doctype[^>]*>)+/i, '');
  return /^<svg[\s/>]/i.test(semProlog);
}

export interface StorableFile {
  buffer: Buffer;
  /** Content-Type que deve ir ao R2 — o cliente não escolhe (text/html vira download). */
  mimeType: string;
  /** Presente quando a URL aberta direto no browser deve baixar em vez de renderizar. */
  contentDisposition?: string;
  removed: SvgRemoval[];
}

/**
 * Decide o que realmente vai ao R2 para um arquivo cujo tipo é declarado pelo
 * cliente. SVG (por tipo, extensão OU conteúdo) é higienizado e sai como exatamente
 * `image/svg+xml`; documento ativo (html/xml) vira download; o resto passa como veio.
 * Lança InvalidSvgError se algo que se apresenta como SVG não for um.
 */
export function prepareStorableFile(input: { buffer: Buffer; fileName: string; mimeType: string }): StorableFile {
  const mime = (input.mimeType || '').split(';')[0]!.trim().toLowerCase();
  const isSvg =
    mime === 'image/svg+xml' ||
    /\.svgz?$/i.test(input.fileName) ||
    (SNIFFABLE_MIMES.has(mime) && looksLikeSvg(input.buffer));

  if (isSvg) {
    if (jaHigienizados.has(input.buffer)) {
      return { buffer: input.buffer, mimeType: 'image/svg+xml', contentDisposition: 'attachment', removed: [] };
    }
    const { buffer, removed } = sanitizeSvg(input.buffer);
    // `attachment`: <img>/CSS continuam carregando normalmente, mas abrir a URL direto
    // no browser baixa o arquivo em vez de executá-lo — uma segunda barreira caso um
    // dia a higienização falhe.
    return { buffer, mimeType: 'image/svg+xml', contentDisposition: 'attachment', removed };
  }

  if (ACTIVE_DOCUMENT_MIMES.has(mime)) {
    return { buffer: input.buffer, mimeType: 'application/octet-stream', contentDisposition: 'attachment', removed: [] };
  }

  return { buffer: input.buffer, mimeType: input.mimeType || 'application/octet-stream', removed: [] };
}
