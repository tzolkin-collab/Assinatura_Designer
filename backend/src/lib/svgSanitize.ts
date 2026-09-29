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
import Piscina, { isWorkerThread } from 'piscina';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Teto BEM abaixo do multer (10MB): árvore funda + CSS adversarial dentro deste teto já
// mediu até 35s de custo (jsdom/DOMPurify) num payload só — e todo POST de upload/asset/
// brandbook/chat passa por aqui. Um brandbook real (mesmo com raster embutido em
// base64) fica bem abaixo de 2MB; o multer segue aceitando até 10MB no corpo da
// requisição, mas o que chega aqui é recusado cedo, sem tokenizar nada.
//
// Isto NÃO é a fronteira de segurança contra DoS — é só um atalho de custo (barato,
// não precisa entender markup) para recusar o óbvio antes de pagar até a serialização
// pro worker. A fronteira de verdade é o teto de TEMPO do pool piscina, mais abaixo:
// qualquer payload que passe deste teto de bytes ainda está limitado pelo timeout por
// tarefa, então nenhuma precisão de tokenização é necessária aqui.
export const MAX_SVG_BYTES = 2 * 1024 * 1024;

const LIMITE_MB = Math.round(MAX_SVG_BYTES / (1024 * 1024));

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

// ── Pool piscina: teto de TEMPO estrutural para a sanitização inteira ──────────
//
// Por que existe: três rodadas de revisão adversarial corrigiram bypasses cada vez
// mais sutis num `preflightCheck` que reimplementava à mão a tokenização HTML5 (pilha
// de nomes, foreign content, CDATA opaco, contagem agregada de CSS) só para rejeitar
// ANTES de montar a árvore no jsdom. Cada rodada fechou um furo e abriu outro — sinal
// de que o problema real (parsear HTML5/XML de forma adversarialmente correta) é dos
// browsers, não de um scanner de uma passada. O preflight morreu (ver mais abaixo,
// "MAX_SVG_BYTES"): a garantia de segurança agora é estrutural, não por precisão de
// parsing.
//
// A função que faz o trabalho pesado de verdade (jsdom + DOMPurify + `enforce()`) roda
// dentro de um pool `piscina` de worker_threads, com um teto de tempo por tarefa via
// `AbortSignal`. Ao estourar, piscina mata a thread que está rodando a tarefa
// (`worker.terminate()` por baixo) — é a ÚNICA forma de preemptar um laço síncrono
// travado, já que nem Promise nem timer interrompem um `while` rodando de verdade — e o
// chamador recebe o mesmo InvalidSvgError de sempre. Não importa qual payload
// adversarial (catalogado ou futuro) explora o parser: o pior caso deixa de ser "trava
// a API por segundos" e vira "rejeita rápido com erro".
//
// Por que um POOL (>=2 threads) e não um worker único: a rodada anterior usava UM
// worker persistente com fila manual, e o timer de cada chamada começava no
// ENFILEIRAMENTO, não no início real do processamento — duas chamadas concorrentes (dois
// uploads de usuários diferentes) competiam pela mesma fila, e um SVG legítimo e
// trivial enfileirado atrás de um payload lento era rejeitado por timeout mesmo sem ter
// custado nada de verdade (bug B1, reproduzido de forma determinística e coberto pelo
// teste de concorrência abaixo). Com >=2 threads, piscina despacha cada chamada
// concorrente para uma thread OCIOSA (e cresce o pool sob demanda até `maxThreads`
// antes de enfileirar) — os dois SVGs rodam em paralelo de verdade, não competem pelo
// mesmo timer.
//
// Por que 5000ms: brandbook real (mesmo com árvore/CSS grandes) sanitiza na casa de
// baixos milissegundos — 5s é generoso o bastante para não ser "flaky" mesmo sob CPU
// MUITO concorrente (medido: rodando a suíte inteira em paralelo — dezenas de arquivos
// de teste, cada um podendo subir suas próprias threads jsdom/piscina — uma tarefa
// trivial ocasionalmente levou pouco mais de 3s só de espera de escalonamento, sem
// nenhum trabalho de verdade; 5s absorve essa margem) — e ainda assim fica uma ordem de
// grandeza abaixo dos 13-35s medidos pelos payloads adversariais catalogados nas
// rodadas anteriores.
export const SANITIZE_WORKER_TIMEOUT_MS = 5000;

// Tamanho do pool: jsdom é pesado de memória (cada thread mantém sua própria janela —
// ver `getEnv()`), então o pool fica PEQUENO de propósito — não baseado em
// `os.availableParallelism()` (o padrão do piscina), que em produção poderia subir
// dezenas de threads jsdom simultâneas. minThreads=2 mantém DUAS threads sempre
// quentes: é o mínimo pra que duas chamadas concorrentes (o cenário do bug B1) nunca
// precisem esperar o pool crescer sob demanda — se fosse 1, a segunda chamada
// concorrente pagaria o custo de subir uma thread nova (spawn + jsdom) na hora exata da
// corrida. maxThreads=4 é o suficiente pra absorver uma rajada maior de uploads
// concorrentes sem enfileirar atrás de um payload lento — e ainda deixa memória de
// sobra para o resto do processo da API.
const SANITIZE_POOL_MIN_THREADS = 2;
const SANITIZE_POOL_MAX_THREADS = 4;

/**
 * Sob `tsx watch` (dev) e `vitest` (teste) este arquivo roda como `.ts` — o
 * worker_threads nativo do Node não entende TypeScript sozinho. `tsx/cjs` é o hook de
 * registro do tsx (já é devDependency) para CommonJS; passamos explicitamente em vez
 * de confiar que o processo pai já foi iniciado com ele (nem sempre é o caso — depender
 * disso quebraria em silêncio se o comando de dev/teste mudasse). Em produção
 * (`dist/lib/svgSanitize.js`, compilado por `tsc`) `__filename` termina em `.js`: o
 * Node carrega nativamente, sem tocar em `tsx` (que nem é dependency de produção).
 * piscina aceita `execArgv` na configuração do pool e repassa pra cada Worker que cria.
 */
function buildWorkerExecArgv(): string[] | undefined {
  if (!__filename.endsWith('.ts')) return undefined;
  return [...process.execArgv, '--require', 'tsx/cjs'];
}

// Resultado que a tarefa do worker devolve pro pool. Por que NÃO lançar InvalidSvgError
// direto de dentro da tarefa: `postMessage` entre threads faz structured clone do valor,
// e um Error (mesmo subclasse) chega do outro lado como um `Error` genérico — perde
// `instanceof InvalidSvgError`, `.code` e até `.name` (verificado: `structuredClone` de
// uma subclasse de Error com propriedade própria zera nome e propriedade extra). Por
// isso a tarefa sempre RESOLVE com este objeto discriminado, e é a thread principal
// (`sanitizeViaWorker`) que reconstrói o InvalidSvgError de verdade a partir de
// `message` — exatamente como a rodada anterior já fazia com o Worker manual.
type WorkerResult =
  | { ok: true; svg: string; removed: SvgRemoval[] }
  | { ok: false; message: string };

let pool: Piscina<string, WorkerResult> | null = null;

/**
 * Cria o pool só na thread principal. `isWorkerThread` é o equivalente do piscina
 * para o `isMainThread` do `node:worker_threads` que a rodada anterior usava — fica
 * `true` só dentro das threads do próprio pool, que reexecutam este arquivo do zero
 * (ver o export default no fim). Sem esta guarda, uma chamada indevida de dentro do
 * worker criaria um pool NOVO dentro do próprio worker — pool dentro de pool.
 */
function getPool(): Piscina<string, WorkerResult> {
  if (isWorkerThread) {
    // Defesa em profundidade: nada dentro do worker deveria chamar isto (a tarefa do
    // worker usa `sanitizeSvgSemProtecao` direto — ver o export default abaixo), mas se
    // algum código futuro chamar `sanitizeSvg` de dentro de um worker por engano, falha
    // alto e cedo em vez de criar um pool dentro de outro pool recursivamente.
    throw new Error('getPool() não deve ser chamado de dentro de um worker thread do próprio pool.');
  }
  if (!pool) {
    pool = new Piscina<string, WorkerResult>({
      filename: __filename,
      minThreads: SANITIZE_POOL_MIN_THREADS,
      maxThreads: SANITIZE_POOL_MAX_THREADS,
      execArgv: buildWorkerExecArgv(),
    });
  }
  return pool;
}

/**
 * Encerra o pool de sanitização de SVG. Chamado no shutdown do servidor (ver
 * server.ts), no mesmo espírito de `closeQueue`/`closeEventBus`: espera as tarefas em
 * andamento terminarem antes de derrubar as threads. Não faz nada se o pool nunca foi
 * criado (processo que nunca sanitizou um SVG, ou já encerrado).
 */
export async function closeSvgSanitizePool(): Promise<void> {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.close();
}

/**
 * Roda jsdom + DOMPurify + `enforce()` (a função exportada como default no fim deste
 * arquivo, que é o que o pool piscina de fato executa em cada worker thread) com o teto
 * de parede `SANITIZE_WORKER_TIMEOUT_MS`, via `AbortSignal.timeout` — o padrão do
 * próprio piscina para tarefas canceláveis (ver README: "Cancelable Tasks"). Se a
 * tarefa já estiver RODANDO quando o sinal dispara, piscina mata a thread inteira (não
 * há como interromper só uma mensagem no meio de um laço síncrono); se ainda estiver
 * na fila, só é removida sem gastar uma thread.
 */
async function sanitizeViaWorker(text: string): Promise<{ svg: string; removed: SvgRemoval[] }> {
  let result: WorkerResult;
  try {
    result = await getPool().run(text, { signal: AbortSignal.timeout(SANITIZE_WORKER_TIMEOUT_MS) });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new InvalidSvgError(`Sanitização de SVG excedeu o tempo máximo (${SANITIZE_WORKER_TIMEOUT_MS}ms) — recusado por segurança.`);
    }
    // Thread morreu por outro motivo (erro não tratado, exit inesperado etc.): mesma
    // regra de antes — fail-closed com InvalidSvgError, nunca deixa o erro cru escapar.
    throw new InvalidSvgError(`Sanitização de SVG interrompida: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!result.ok) throw new InvalidSvgError(result.message);
  return { svg: result.svg, removed: result.removed };
}

// ── API ─────────────────────────────────────────────────────────────────────────

/**
 * Devolve o SVG limpo e a lista do que foi removido. Lança InvalidSvgError se, depois
 * da limpeza, não sobrar uma raiz <svg> bem-formada — se qualquer etapa (inclusive um
 * erro inesperado do jsdom/DOMPurify) não puder garantir que o resultado é seguro — ou
 * se a sanitização (que roda num pool de threads separado, ver acima) excede o teto de
 * tempo.
 *
 * Assíncrona: o trabalho pesado (jsdom + DOMPurify + enforce) roda dentro de um pool
 * `piscina` de `worker_threads`, não neste thread — é o que permite matar a thread da
 * tarefa (via `AbortSignal`, sem derrubar as outras tarefas do pool) se um payload
 * adversarial travar o parser por tempo demais.
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
 * O trabalho pesado de verdade: jsdom + DOMPurify + `enforce()`. SEM proteção de tempo
 * própria — quem chama isto (o export default no fim do arquivo, dentro da thread do
 * pool) é que pode ser `terminate()`ado de fora pelo `AbortSignal` do piscina. Devolve
 * só `{ svg, removed }` — não `buffer` — porque o Buffer "de verdade" (o que entra no
 * WeakSet `jaHigienizados`) é construído na thread principal, depois da mensagem
 * voltar do worker; ver o comentário em `sanitizeSvg`.
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

// ── Modo worker: este mesmo arquivo é o script que o pool piscina executa ──────
//
// Padrão comum em Node pra não precisar de um segundo arquivo compilado à parte (que
// teria que existir tanto em `dist/` quanto sob o transform do vitest, com os dois
// caminhos de resolução sincronizados manualmente): `filename: __filename` (em
// `getPool`, acima) faz o piscina reexecutar este mesmo arquivo do zero DENTRO de cada
// worker thread e procurar o export default para usar como tarefa. `isWorkerThread` é
// `true` só aí dentro — é por isso que `getPool` só cria o pool quando ela é `false`
// (thread principal): sem essa guarda, cada worker tentaria criar seu PRÓPRIO pool
// recursivamente. Tudo acima (`export function`, `export class` etc.) roda de novo
// nesta cópia, mas ninguém de fora importa ela — só esta função default é chamada,
// pelo próprio piscina.
export default async function sanitizeSvgWorkerTask(text: string): Promise<WorkerResult> {
  try {
    const { svg, removed } = sanitizeSvgSemProtecao(text);
    return { ok: true, svg, removed };
  } catch (err) {
    // Mesma regra de antes: InvalidSvgError passa a mensagem adiante; qualquer outra
    // coisa (TypeError de remoção, erro interno do jsdom numa árvore patológica etc.)
    // vira o mesmo "não consigo garantir que isto é seguro" em vez de propagar um erro
    // cru (que o structured clone entre threads desfiguraria de qualquer forma — ver o
    // comentário em `WorkerResult`).
    const message = err instanceof InvalidSvgError
      ? err.message
      : `Falha inesperada ao higienizar SVG: ${err instanceof Error ? err.message : String(err)}`;
    return { ok: false, message };
  }
}
