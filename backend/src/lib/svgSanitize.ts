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
import { Worker, isMainThread, parentPort } from 'node:worker_threads';

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

// Teto de elementos TOTAIS no documento — profundidade sozinha não basta. Medido contra
// o código sem este teto: 20.000 elementos-irmãos rasos (`<rect/>` repetido, ~560KB) =
// 1,8s; 30.000 (~840KB) = 2,0s; 40.000 (~1,12MB) = 3,1s; 62.914 (~1,68MB, ainda abaixo
// do teto de bytes) = ~4,9s — tudo com profundidade 1, então MAX_SVG_DEPTH não pega.
// 5000 é generoso pra um ícone/logo real (dezenas a poucas centenas de elementos) e
// mantém o pior caso do preflight bem abaixo de 1s.
export const MAX_SVG_ELEMENTS = 5000;

// Teto para o total de bytes de CSS agregado (soma de todo conteúdo de <style> + todo
// valor de style="") ANTES de rodar qualquer regex de limpeza sobre eles. O lookahead
// limitado do stripCss (abaixo) já elimina o crescimento QUADRÁTICO do bug antigo, mas
// o fator constante do pior caso ("url(" repetido sem fechar) ainda é caro: medido já
// com o lookahead limitado, 256KB desse CSS = ~1,7s e 512KB = ~3,3s (cresce linear,
// ~6,6ms/KB) — um <style> ocupando quase o teto inteiro de 2MB (MAX_SVG_BYTES) travaria
// o event loop por mais de 10s SÍNCRONO, a mesma ordem de grandeza do bug que esta
// rodada deveria ter eliminado. CSS de brandbook real (cores, fontes, classes) fica na
// casa de poucos KB; 64KB é folgado e limita o pior caso a ~400ms.
export const MAX_CSS_BYTES = 64 * 1024;

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

// Os únicos 14 void elements do HTML Living Standard: nunca têm filhos de verdade, o
// parser HTML5 os trata como "auto-fechados" apareça ou não a barra "/>", e um
// `</br>` solto nunca reabre nada. Fora deste conjunto (e fora de foreign content —
// ver FOREIGN_ROOTS), a barra final num elemento comum é só ruído: a tag ABRE
// normalmente e tudo que vier depois fica aninhado dentro dela.
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// Raízes que entram em "foreign content" (SVG/MathML). Só dentro delas — ou nelas
// mesmas — o parser HTML5 realmente honra "/>" para fechar qualquer elemento comum
// (<rect/>, <g/>...). Fora disso, mesmo com a barra, o elemento abre e aninha.
const FOREIGN_ROOTS = new Set(['svg', 'math']);

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
 * jsdom — sem regex custoso sobre o documento inteiro, só um scanner de tags que:
 *  1. empilha o NOME de cada tag realmente aberta (para profundidade e para validar
 *     tag de fechamento por nome — ver abaixo);
 *  2. só considera "/>" self-closing quando a tag é um void element HTML conhecido OU
 *     já estamos dentro de uma raiz <svg>/<math> (foreign content) — replicando a regra
 *     real do parser HTML5 que o jsdom usa. Fora disso, mesmo com a barra, a tag ABRE e
 *     tudo que vier depois fica aninhado nela — era exatamente esse o furo: `<div/>`
 *     repetido antes da raiz <svg> parecia raso pro contador antigo e continuava
 *     genuinamente profundo na árvore real;
 *  3. só desempilha numa tag de fechamento se o NOME bater com algo já aberto (busca a
 *     pilha de cima para baixo, como o algoritmo HTML5 "any other end tag") — sem isso,
 *     `<g></b>` repetido (fechamento que nunca corresponde a nada) decrementava um
 *     contador ingênuo a cada par e nunca estourava o teto, enquanto os `<g>` ficavam
 *     genuinamente empilhados na árvore que o jsdom monta;
 *  4. conta o total de tags de abertura vistas (nunca decrementa) — cobre LARGURA, não
 *     só profundidade: um documento raso com dezenas de milhares de elementos-irmãos
 *     passa batido pelo teto de profundidade mas ainda é caro pra jsdom+DOMPurify+
 *     enforce (que roda duas vezes);
 *  5. soma o total de bytes de CSS (conteúdo de <style> + valor de style="") visto até
 *     agora — o lookahead limitado do stripCss elimina o crescimento quadrático, mas o
 *     fator constante ainda é caro o bastante pra travar o event loop por segundos bem
 *     dentro do teto de 2MB do arquivo inteiro.
 *
 * Existe porque a poda de nó do DOMPurify/jsdom é O(profundidade) por nó tocado (1000
 * níveis de `<g>` = 307ms; 50000 = 35s SÍNCRONO) em toda rota que grava SVG (upload,
 * /assets, brandbook, anexo de chat). Rejeitar aqui custa microssegundos a milissegundos.
 *
 * Não é um parser HTML5 completo (não modela elementos "especiais" que abortam a busca
 * de fechamento mais cedo, nem integration points) — não precisa ser: o pior caso de
 * errar por falta de rigor num markup exótico é subcontar profundidade/largura/CSS, e
 * isso ainda cai no teto de tamanho (MAX_SVG_BYTES) e no try/catch de `sanitizeSvg`. A
 * combinação nome-na-pilha + contador monotônico de largura fecha os bypasses
 * concretos relatados sem precisar reimplementar o algoritmo de árvore de elementos
 * "especiais" do parser inteiro.
 */
function preflightCheck(text: string): void {
  const len = text.length;
  let i = 0;

  // Nomes das tags REALMENTE abertas (não self-closing, não void) — ver ponto 1 acima.
  const pilha: string[] = [];
  // Quantas raízes <svg>/<math> abertas de verdade estão na pilha agora.
  let foreignDepth = 0;
  // Contagem TOTAL de tags de abertura vistas — nunca decrementa (ponto 4 acima).
  let totalAberturas = 0;
  // Soma de bytes de CSS vistos até agora (ponto 5 acima).
  let cssTotal = 0;
  // Regex local (não module-level) pra não compartilhar `lastIndex` entre chamadas —
  // reaproveitada dentro desta única passada via `lastIndex` (ver uso abaixo).
  const FECHO_STYLE_RE = /<\/style/gi;

  const estourouCss = () => {
    if (cssTotal > MAX_CSS_BYTES) {
      throw new InvalidSvgError(`SVG excede o teto de CSS agregado (${Math.round(MAX_CSS_BYTES / 1024)}KB).`);
    }
  };

  while (i < len) {
    const lt = text.indexOf('<', i);
    if (lt === -1) break;
    const next = text.charCodeAt(lt + 1);

    if (next === 0x2f /* / */) {
      // Tag de fechamento: só desempilha se o NOME bater com algo já aberto (ponto 3).
      const gt = text.indexOf('>', lt + 2);
      if (gt === -1) break;
      const nomeFechamentoMatch = /^[^\s/>]*/.exec(text.slice(lt + 2, gt));
      const nomeFechamento = (nomeFechamentoMatch ? nomeFechamentoMatch[0] : '').toLowerCase();
      for (let k = pilha.length - 1; k >= 0; k--) {
        if (pilha[k] === nomeFechamento) {
          const fechados = pilha.splice(k);
          for (const nome of fechados) if (FOREIGN_ROOTS.has(nome)) foreignDepth--;
          break;
        }
      }
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

    const tagTexto = text.slice(lt + 1, j);
    const nomeMatch = /^[^\s/>]*/.exec(tagTexto);
    const nome = (nomeMatch ? nomeMatch[0] : '').toLowerCase();
    const hasSlash = text.charCodeAt(j - 1) === 0x2f /* '/' logo antes do '>' */;

    totalAberturas++;
    if (totalAberturas > MAX_SVG_ELEMENTS) {
      throw new InvalidSvgError(`SVG excede o número máximo de elementos (${MAX_SVG_ELEMENTS}).`);
    }

    // style="..." custa o mesmo regex caro do stripCss quando `enforce()` rodar; conta
    // pro teto agregado mesmo fora de um <style> (ponto 5). Regex com classe negada
    // ([^"]*), sem grupo aninhado repetido — não tem o backtracking catastrófico que
    // motivou o lookahead limitado do stripCss.
    const estiloAttrMatch = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tagTexto);
    if (estiloAttrMatch) {
      cssTotal += (estiloAttrMatch[1] ?? estiloAttrMatch[2] ?? '').length;
      estourouCss();
    }

    const ehVoid = VOID_ELEMENTS.has(nome);
    const emForeignContent = foreignDepth > 0 || FOREIGN_ROOTS.has(nome);
    const autoFechada = hasSlash && (ehVoid || emForeignContent);

    // <style> é "raw text" em HTML5: o conteúdo NUNCA é tag-parseado, só procurado
    // literalmente até o primeiro "</style" (nem aspas nem CDATA mudam isso — é
    // exatamente essa "burrice" que faz o mXSS clássico funcionar, coberto no teste
    // "mXSS clássico com style e id"). Só entra aqui se não veio self-closed (`<style/>`
    // de verdade é raro e não tem conteúdo pra pular).
    if (nome === 'style' && !hasSlash) {
      // Busca com regex+lastIndex no texto ORIGINAL (não `text.slice(j+1)`): um
      // documento pode ter até MAX_SVG_ELEMENTS tags <style>, e fatiar+`toLowerCase()`
      // do restante inteiro a cada uma seria O(tamanho restante) por tag — O(n²) no
      // total com muitos <style>, o mesmo tipo de custo quadrático que este arquivo
      // inteiro existe pra eliminar. `exec` com `lastIndex` não copia string nenhuma.
      FECHO_STYLE_RE.lastIndex = j + 1;
      const fechoMatch = FECHO_STYLE_RE.exec(text);
      const fim = fechoMatch ? fechoMatch.index : len;
      cssTotal += fim - (j + 1);
      estourouCss();
      if (fim >= len) { i = len; continue; }
      const gtFechamento = text.indexOf('>', fim);
      i = gtFechamento === -1 ? len : gtFechamento + 1;
      continue;
    }

    if (!autoFechada) {
      pilha.push(nome);
      if (FOREIGN_ROOTS.has(nome)) foreignDepth++;
      if (pilha.length > MAX_SVG_DEPTH) {
        throw new InvalidSvgError(`SVG excede a profundidade máxima de aninhamento (${MAX_SVG_DEPTH}).`);
      }
    }
    i = j + 1;
  }
}

// ── Worker: teto de TEMPO estrutural para a sanitização inteira ────────────────
//
// Por que existe: duas rodadas de revisão adversarial corrigiram 8 formas diferentes
// de fazer o preflightCheck (scanner de tags escrito à mão) subestimar profundidade,
// largura ou custo de CSS — e a cada rodada de patch pontual apareceu UM OU MAIS
// bypasses NOVOS (o mais recente até num trecho que a rodada anterior tinha acabado de
// escrever pra fechar o bypass de antes). Em nenhum caso a sanitização ficou insegura
// (o resultado final sempre foi InvalidSvgError ou conteúdo limpo) — o problema é
// sempre de TEMPO: com dezenas de KB, bem abaixo do teto de MAX_SVG_BYTES, o
// preflightCheck ou o jsdom/DOMPurify podem travar o event loop por 2 a 18 segundos
// SÍNCRONOS. Reimplementar à mão a tokenização adversarial de HTML5/XML tende a nunca
// convergir por patch pontual — é o problema que navegadores levaram anos e specs
// enormes para fechar.
//
// Em vez de perseguir bypass por bypass, a função inteira (preflightCheck + jsdom +
// DOMPurify + enforce) roda dentro de um `worker_threads` Worker com um teto de
// parede: se estourar, `worker.terminate()` interrompe a V8 NO MEIO de um laço
// síncrono — é a ÚNICA forma de preemptar JS single-thread, já que nem Promise nem
// timer conseguem interromper um `while` rodando de verdade — e o chamador recebe o
// mesmo InvalidSvgError de sempre. Não importa qual dos 5 bypasses catalogados (ou um
// futuro ainda não descoberto) o payload explora: o pior caso deixa de ser "trava a
// API por segundos" e vira "rejeita rápido com erro".
//
// Por que 3000ms: brandbook real (mesmo com árvore/CSS grandes) sanitiza na casa de
// baixos milissegundos — 3s é generoso o bastante para não ser "flaky" sob CPU
// concorrente — e ainda assim fica bem abaixo dos 2-18s medidos pelos bypasses.
export const SANITIZE_WORKER_TIMEOUT_MS = 3000;

interface WorkerRequest {
  id: number;
  text: string;
}

type WorkerResponse =
  | { id: number; ok: true; svg: string; removed: SvgRemoval[] }
  | { id: number; ok: false; message: string };

interface PendingJob {
  resolve: (result: { svg: string; removed: SvgRemoval[] }) => void;
  reject: (err: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingJobs = new Map<number, PendingJob>();
let nextJobId = 1;
// Worker ÚNICO e reaproveitado entre chamadas (não um por chamada): jsdom é pesado de
// carregar (é por isso que `getEnv()` acima já é preguiçoso) e subir uma thread nova a
// cada SVG pagaria esse custo toda vez. Como a sanitização em si já é síncrona dentro
// da thread (não há paralelismo real a ganhar processando duas ao mesmo tempo), um
// worker persistente processando mensagens em fila é o "pool simples" pedido, sem
// dependência nova. Se ele morrer (erro, exit ou terminate() por timeout), a próxima
// chamada sobe um novo — ver `getWorker`.
let worker: Worker | null = null;

/**
 * Sob `tsx watch` (dev) e `vitest` (teste) este arquivo roda como `.ts` — o
 * worker_threads nativo do Node não entende TypeScript sozinho. `tsx/cjs` é o hook de
 * registro do tsx (já é devDependency) para CommonJS; passamos explicitamente em vez
 * de confiar que o processo pai já foi iniciado com ele (nem sempre é o caso — depender
 * disso quebraria em silêncio se o comando de dev/teste mudasse). Em produção
 * (`dist/lib/svgSanitize.js`, compilado por `tsc`) `__filename` termina em `.js`: o
 * Node carrega nativamente, sem tocar em `tsx` (que nem é dependency de produção).
 */
function buildWorkerExecArgv(): string[] | undefined {
  if (!__filename.endsWith('.ts')) return undefined;
  return [...process.execArgv, '--require', 'tsx/cjs'];
}

function failAllPending(reason: unknown): void {
  for (const [id, job] of pendingJobs) {
    clearTimeout(job.timer);
    job.reject(reason);
    pendingJobs.delete(id);
  }
}

function spawnWorker(): Worker {
  const w = new Worker(__filename, { execArgv: buildWorkerExecArgv() });

  w.on('message', (msg: WorkerResponse) => {
    const job = pendingJobs.get(msg.id);
    if (!job) return; // já resolvido por timeout — a resposta chegou tarde demais.
    pendingJobs.delete(msg.id);
    clearTimeout(job.timer);
    if (msg.ok) job.resolve({ svg: msg.svg, removed: msg.removed });
    else job.reject(new InvalidSvgError(msg.message));
  });

  // Thread morreu (erro não tratado dentro dela, ou encerrou sozinha) fora do fluxo de
  // timeout normal: falha fechado tudo que estava pendente NESTE worker e força a
  // próxima chamada a subir um novo (nunca fica "preso" reusando uma thread morta).
  const onDeath = (detail: string) => {
    if (worker === w) worker = null;
    failAllPending(new InvalidSvgError(`Sanitização de SVG interrompida: ${detail}`));
  };
  w.on('error', (err) => onDeath(err.message));
  w.on('exit', (code) => {
    if (code !== 0) onDeath(`worker de sanitização encerrou com código ${code}`);
  });

  return w;
}

function getWorker(): Worker {
  if (!worker) worker = spawnWorker();
  return worker;
}

/**
 * Roda preflightCheck + jsdom + DOMPurify + enforce dentro do worker persistente, com
 * o teto de parede `SANITIZE_WORKER_TIMEOUT_MS`. Ao estourar, mata a thread INTEIRA
 * (não só esta mensagem — não há como interromper só uma mensagem no meio de um laço
 * síncrono) e rejeita com InvalidSvgError; qualquer outra chamada que já estivesse
 * enfileirada NESTE worker morre junto (fail-closed) e vê o mesmo erro — a próxima
 * chamada sobe um worker novo via `getWorker()`.
 */
function sanitizeViaWorker(text: string): Promise<{ svg: string; removed: SvgRemoval[] }> {
  return new Promise((resolve, reject) => {
    const id = nextJobId++;
    const w = getWorker();

    const timer = setTimeout(() => {
      pendingJobs.delete(id);
      w.terminate().catch(() => {
        // best-effort: já estamos rejeitando por timeout de qualquer forma.
      });
      reject(new InvalidSvgError(`Sanitização de SVG excedeu o tempo máximo (${SANITIZE_WORKER_TIMEOUT_MS}ms) — recusado por segurança.`));
    }, SANITIZE_WORKER_TIMEOUT_MS);
    // Não deixa o timer sozinho manter o processo Node vivo (irrelevante em produção,
    // mas evita travar `vitest`/scripts que aguardam o event loop esvaziar).
    timer.unref?.();

    pendingJobs.set(id, { resolve, reject, timer });
    w.postMessage({ id, text } satisfies WorkerRequest);
  });
}

// ── API ─────────────────────────────────────────────────────────────────────────

/**
 * Devolve o SVG limpo e a lista do que foi removido. Lança InvalidSvgError se, depois
 * da limpeza, não sobrar uma raiz <svg> bem-formada — se qualquer etapa (inclusive um
 * erro inesperado do jsdom/DOMPurify) não puder garantir que o resultado é seguro — ou
 * se a sanitização (que roda numa thread separada, ver acima) excede o teto de tempo.
 *
 * Assíncrona: o trabalho pesado (preflightCheck + jsdom + DOMPurify + enforce) roda
 * dentro de um `worker_threads` Worker, não neste thread — é o que permite matar a
 * thread (`terminate()`) sem derrubar o processo da API se um payload adversarial
 * travar o parser por tempo demais.
 */
export async function sanitizeSvg(input: string | Buffer): Promise<SanitizeSvgResult> {
  const text = toText(input);
  if (!/<svg[\s/>]/i.test(text)) throw new InvalidSvgError('Conteúdo não é um SVG (raiz <svg> não encontrada).');

  const { svg, removed } = await sanitizeViaWorker(text);
  // O buffer final é criado AQUI (thread principal), não dentro do worker: é ele que
  // entra no WeakSet `jaHigienizados` logo abaixo, e a identidade do objeto Buffer só
  // importa pra quem chama depois (`prepareStorableFile`) NESTE thread. Um Buffer
  // criado dentro do worker e devolvido por postMessage seria uma cópia por
  // structured clone — outra identidade — e o dedup abaixo nunca bateria.
  const buffer = Buffer.from(svg, 'utf-8');
  jaHigienizados.add(buffer);
  return { svg, buffer, removed };
}

/**
 * O trabalho pesado de verdade (preflightCheck já rodou antes de chamar isto — ver o
 * handler de worker no fim do arquivo). SEM proteção de tempo própria: quem chama
 * (o handler de worker) é que está dentro da thread que pode ser `terminate()`ada de
 * fora. Devolve só `{ svg, removed }` — não `buffer` — porque o Buffer "de verdade"
 * (o que entra no WeakSet `jaHigienizados`) é construído na thread principal, depois
 * do postMessage; ver o comentário em `sanitizeSvg`.
 */
function sanitizeSvgSemProtecao(text: string): { svg: string; removed: SvgRemoval[] } {
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

  return { svg, removed };
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
 *
 * Assíncrona porque `sanitizeSvg` agora roda num worker (ver acima) — todos os
 * chamadores precisam de `await`.
 */
export async function prepareStorableFile(input: { buffer: Buffer; fileName: string; mimeType: string }): Promise<StorableFile> {
  const mime = (input.mimeType || '').split(';')[0]!.trim().toLowerCase();
  const isSvg =
    mime === 'image/svg+xml' ||
    /\.svgz?$/i.test(input.fileName) ||
    (SNIFFABLE_MIMES.has(mime) && looksLikeSvg(input.buffer));

  if (isSvg) {
    if (jaHigienizados.has(input.buffer)) {
      return { buffer: input.buffer, mimeType: 'image/svg+xml', contentDisposition: 'attachment', removed: [] };
    }
    const { buffer, removed } = await sanitizeSvg(input.buffer);
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

// ── Modo worker: este mesmo arquivo é o script que roda dentro do Worker ───────
//
// Padrão comum em Node pra não precisar de um segundo arquivo compilado à parte (que
// teria que existir tanto em `dist/` quanto sob o transform do vitest, com os dois
// caminhos de resolução sincronizados manualmente): o módulo checa `isMainThread` e,
// se for a thread filha, vira um processador de mensagens em vez de só exportar a API
// pública. `new Worker(__filename)` (acima, em `spawnWorker`) reexecuta este arquivo
// do zero NESTA thread — `isMainThread` é `false` aqui dentro — então tudo acima
// (`export function`, `export class` etc.) roda de novo, só que ninguém do lado de
// fora importa esta cópia: só o bloco abaixo importa, o resto é reaproveitado por
// `preflightCheck`/`sanitizeSvgSemProtecao`/`InvalidSvgError` já estarem no escopo do
// módulo.
if (!isMainThread && parentPort) {
  const port = parentPort;
  port.on('message', (job: WorkerRequest) => {
    try {
      // A MESMA função que corria direto na API antes desta rodada — preflightCheck
      // primeiro (O(n), rejeita o óbvio rápido), depois jsdom/DOMPurify/enforce. A
      // diferença é só ONDE ela roda agora: aqui dentro, onde um `terminate()` de fora
      // consegue interromper no meio, não mais no thread que serve requisições HTTP.
      preflightCheck(job.text);
      const { svg, removed } = sanitizeSvgSemProtecao(job.text);
      port.postMessage({ id: job.id, ok: true, svg, removed } satisfies WorkerResponse);
    } catch (err) {
      // Mesma regra de antes: InvalidSvgError passa a mensagem adiante; qualquer outra
      // coisa (TypeError de remoção, erro interno do jsdom numa árvore patológica que
      // driblou o preflight etc.) vira o mesmo "não consigo garantir que isto é
      // seguro" em vez de derrubar a thread sem responder.
      const message = err instanceof InvalidSvgError
        ? err.message
        : `Falha inesperada ao higienizar SVG: ${err instanceof Error ? err.message : String(err)}`;
      port.postMessage({ id: job.id, ok: false, message } satisfies WorkerResponse);
    }
  });
}
