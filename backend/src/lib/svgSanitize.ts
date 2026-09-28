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

// Teto BEM abaixo do multer (10MB): uma revisão adversarial (lente "robustez") mediu
// que árvore funda + CSS adversarial dentro deste teto antigo já travava o event loop
// por até 35s SÍNCRONO — e todo POST de upload/asset/brandbook/chat passa por aqui. Um
// brandbook real (mesmo com raster embutido em base64) fica bem abaixo de 2MB; o multer
// segue aceitando até 10MB no corpo da requisição, mas o que chega aqui é recusado cedo.
export const MAX_SVG_BYTES = 2 * 1024 * 1024;

// Profundidade máxima de aninhamento de tags (<svg><g><g>...). Medido: 1000 níveis
// (3KB) = 307ms; 10000 (30KB) = 13s; 50000 (150KB) = 35s — quadrático, porque a poda de
// nó do DOMPurify/jsdom caminha a árvore. 256 é generoso para brandbook/ícone real (que
// raramente passa de 10-15 níveis) e recusa em microssegundos via `preflightCheck`,
// antes de montar qualquer árvore.
export const MAX_SVG_DEPTH = 256;

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

// Tetos de busca à frente para os regex abaixo (em caracteres). Nenhum @import/url()/
// image-set() legítimo passa disso — brandbook real usa no máximo um caminho de arquivo
// ou um data-URI de raster pequeno. Existem para trocar `*`/`*?` sem limite (que faz o
// motor de regex retroceder byte a byte quando NÃO acha o terminador, e falha de novo a
// cada nova ocorrência do gatilho) por um retrocesso de tamanho fixo: uma revisão
// adversarial mediu que repetir "@import" seguido de "{" sem ";" (ou "url("/"url(\""/
// "image-set(" sem fechar) faz o tempo crescer QUADRATICAMENTE com o tamanho da entrada
// (16KB=150ms, 256KB=13,6s). Com o teto, cada ocorrência custa no máximo O(teto), então
// o total volta a ser O(tamanho do CSS).
const CSS_IMPORT_LOOKAHEAD = 500;
const CSS_URL_LOOKAHEAD = 2048;

function stripCss(css: string, issues: string[]): string {
  let out = css;

  // Termina em `;`, `{`, `}` ou fim da string — o que vier primeiro — em vez de exigir
  // `;` especificamente. Antes, "@import 'x'" sem ";" antes do bloco seguinte não
  // combinava com o regex e SOBREVIVIA à limpeza (a garantia "nenhum @import externo
  // sobrevive" era falsa); `{`/`}` como parada também fecha esse bypass.
  out = out.replace(new RegExp(`@import\\b[^;{}]{0,${CSS_IMPORT_LOOKAHEAD}}(?:;|(?=[{}])|$)`, 'gi'), () => {
    issues.push('@import');
    return '';
  });

  out = out.replace(
    new RegExp(`url\\(\\s*(?:"([^"]{0,${CSS_URL_LOOKAHEAD}})"|'([^']{0,${CSS_URL_LOOKAHEAD}})'|([^)]{0,${CSS_URL_LOOKAHEAD}}))\\s*\\)`, 'gi'),
    (whole, dq, sq, bare) => {
      const target = String(dq ?? sq ?? bare ?? '');
      if (cssUrlAllowed(target)) return whole;
      issues.push(`url(${target.length > 40 ? `${target.slice(0, 40)}…` : target})`);
      // `url(#)` é sintaxe válida e não aponta para lugar nenhum: a declaração continua
      // parseável, só perde o recurso.
      return 'url(#)';
    },
  );

  out = out.replace(new RegExp(`(?:-webkit-)?image-set\\s*\\([^)]{0,${CSS_URL_LOOKAHEAD}}\\)`, 'gi'), () => {
    issues.push('image-set()');
    return 'none';
  });

  out = out.replace(new RegExp(`(?:-moz-)?(?:behavior|binding)\\s*:[^;}]{0,${CSS_IMPORT_LOOKAHEAD}}`, 'gi'), () => {
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

  // Nós que já saíram da árvore nesta passada — removidos diretamente ou órfãos porque
  // um ancestral saiu. `querySelectorAll` devolve em ordem de documento (pai antes dos
  // filhos), então quando chegamos num nó o status do pai já está decidido: um Set com
  // `has()` em O(1) troca o `root.contains(el)` antigo, que é O(profundidade) e, dentro
  // do laço sobre todos os elementos, virava O(n²) em árvore funda — o mesmo tipo de
  // quadrático que o preflight de profundidade evita lá na entrada.
  const removidos = new Set<Node>();

  for (const el of elements) {
    if (el !== root) {
      const pai = el.parentNode;
      // `el.remove()` só desliga `el` do pai; os FILHOS de `el` continuam com
      // `parentNode === el`, então o órfão se propaga automaticamente pela lista sem
      // precisar caminhar a árvore de novo.
      if (pai && removidos.has(pai)) {
        removidos.add(el);
        continue;
      }
    }

    const tag = el.localName.toLowerCase();

    if (el !== root) {
      const foraDoSvg = el.namespaceURI !== SVG_NS;
      if (foraDoSvg || tag.includes(':') || FORBIDDEN_TAGS.has(tag)) {
        removed.push({ kind: 'element', name: `<${tag}>`, reason: foraDoSvg ? 'fora do namespace SVG' : 'elemento proibido' });
        el.remove();
        removidos.add(el);
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
        removidos.add(el);
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

// ── Preflight (O(n), antes de qualquer árvore) ──────────────────────────────────

const LIMITE_MB = Math.round(MAX_SVG_BYTES / (1024 * 1024));

function toText(input: string | Buffer): string {
  if (typeof input !== 'string') {
    if (input.length > MAX_SVG_BYTES) throw new InvalidSvgError(`SVG muito grande (limite de ${LIMITE_MB}MB).`);
    // NUL no meio = UTF-16 ou binário. Decodificar como UTF-8 viraria lixo que o
    // parser ignora — melhor recusar do que gravar algo que o browser lê diferente.
    if (input.includes(0)) throw new InvalidSvgError('Arquivo não é um SVG em texto (UTF-8).');
    return semBom(input.toString('utf-8'));
  }
  if (Buffer.byteLength(input, 'utf-8') > MAX_SVG_BYTES) throw new InvalidSvgError(`SVG muito grande (limite de ${LIMITE_MB}MB).`);
  return semBom(input);
}

/**
 * Verificação O(n) num único passe pelo texto, ANTES de montar qualquer árvore no
 * jsdom — sem regex sobre o documento inteiro, só um contador de profundidade que soma
 * em tag de abertura e subtrai em tag de fechamento/self-closing. Existe porque a poda
 * de nó do DOMPurify/jsdom é O(profundidade) por nó tocado: uma revisão adversarial
 * mediu 1000 níveis de `<g>` (3KB) em 307ms, 10000 (30KB) em 13s e 50000 (150KB) em
 * 35s — SÍNCRONO, no event loop inteiro, em toda rota que grava SVG (upload, /assets,
 * brandbook, anexo de chat). Rejeitar aqui custa microssegundos.
 *
 * Não é um parser XML de verdade — não precisa ser: o pior caso de errar por falta de
 * rigor num markup exótico é subcontar profundidade, e isso ainda cai no teto de
 * tamanho (MAX_SVG_BYTES) e no try/catch de `sanitizeSvg`. Não há caminho em que um
 * erro de contagem aqui vire uma sanitização insegura, só uma rejeição tardia.
 */
function preflightCheck(text: string): void {
  const len = text.length;
  let depth = 0;
  let i = 0;

  while (i < len) {
    const lt = text.indexOf('<', i);
    if (lt === -1) break;
    const next = text.charCodeAt(lt + 1);

    if (next === 0x2f /* / */) {
      // tag de fechamento: </tag>
      const gt = text.indexOf('>', lt + 2);
      if (gt === -1) break;
      if (depth > 0) depth--;
      i = gt + 1;
      continue;
    }

    if (next === 0x21 /* ! */) {
      // comentário, CDATA ou DOCTYPE — não é elemento, não conta para profundidade.
      if (text.startsWith('<!--', lt)) {
        const end = text.indexOf('-->', lt + 4);
        i = end === -1 ? len : end + 3;
      } else if (text.startsWith('<![CDATA[', lt)) {
        const end = text.indexOf(']]>', lt + 9);
        i = end === -1 ? len : end + 3;
      } else {
        const gt = text.indexOf('>', lt + 2);
        i = gt === -1 ? len : gt + 1;
      }
      continue;
    }

    if (next === 0x3f /* ? */) {
      // <?xml version="1.0"?>
      const end = text.indexOf('?>', lt + 2);
      i = end === -1 ? len : end + 2;
      continue;
    }

    // Tag de abertura ou self-closing: acha o '>' não citado (ignora '>' dentro de um
    // valor de atributo entre aspas, ex.: title="a > b").
    let j = lt + 1;
    let aspas = 0; // 0 = fora de aspas; senão, o código do caractere de aspa aberta.
    while (j < len) {
      const c = text.charCodeAt(j);
      if (aspas) {
        if (c === aspas) aspas = 0;
      } else if (c === 0x22 || c === 0x27 /* " ou ' */) {
        aspas = c;
      } else if (c === 0x3e /* > */) {
        break;
      }
      j++;
    }
    if (j >= len) break; // tag nunca fecha: deixa o jsdom decidir (ou rejeitar) o resto.

    const autoFechada = text.charCodeAt(j - 1) === 0x2f /* '/' logo antes do '>' */;
    if (!autoFechada) {
      depth++;
      if (depth > MAX_SVG_DEPTH) {
        throw new InvalidSvgError(`SVG excede a profundidade máxima de aninhamento (${MAX_SVG_DEPTH}).`);
      }
    }
    i = j + 1;
  }
}

// ── API ─────────────────────────────────────────────────────────────────────────

/**
 * Devolve o SVG limpo e a lista do que foi removido. Lança InvalidSvgError se, depois
 * da limpeza, não sobrar uma raiz <svg> bem-formada — ou se qualquer etapa (inclusive
 * um erro inesperado do jsdom/DOMPurify) não puder garantir que o resultado é seguro.
 */
export function sanitizeSvg(input: string | Buffer): SanitizeSvgResult {
  const text = toText(input);
  if (!/<svg[\s/>]/i.test(text)) throw new InvalidSvgError('Conteúdo não é um SVG (raiz <svg> não encontrada).');
  preflightCheck(text);

  try {
    return sanitizeSvgSemProtecao(text);
  } catch (err) {
    if (err instanceof InvalidSvgError) throw err;
    // Nada do que o jsdom/DOMPurify podem lançar numa árvore patológica (TypeError de
    // remoção, erro de parse interno etc.) pode escapar como 500: vira o mesmo "não
    // consigo garantir que isto é seguro" dos outros throws. Com o preflight acima,
    // árvores fundas demais nem chegam aqui — isto cobre qualquer outra entrada que
    // passe pelo preflight sem disparar o teto e ainda assim confunda o parser.
    throw new InvalidSvgError(`Falha inesperada ao higienizar SVG: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function sanitizeSvgSemProtecao(text: string): SanitizeSvgResult {
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
