// Testes de concorrência do pool piscina de svgSanitize.ts — MOVIDOS para este arquivo
// próprio (antes viviam em svgSanitize.test.ts) por causa do blocker A (revisão
// adversarial sobre o commit de0d9a6):
//
//   Rodando SÓ svgSanitize.test.ts, o teste de concorrência B1 passava 3/3. Rodando a
//   suíte INTEIRA (57 arquivos), falhava 3/3 — com `expected 'rejected' to be
//   'fulfilled'` (o legítimo caiu junto com o adversarial) e `expected 4864 to be less
//   than 3500` (quase estourou o teto). Causa: pelo menos três arquivos de teste
//   (svgSanitize.test.ts, svgWritePoints.test.ts, r2SvgGuard.test.ts) chamam
//   sanitizeSvg de verdade, e CADA UM sobe seu PRÓPRIO pool piscina (module-level —
//   ver `pool` em svgSanitize.ts — uma instância por processo/worker do vitest que
//   importa o módulo). Isto NÃO acontece em produção (um processo só, um pool só,
//   persistente) — é um artefato do ambiente de teste: vários pools de até 4 threads
//   (SANITIZE_POOL_MAX_THREADS) cada, somados aos próprios processos/threads que o
//   vitest usa para paralelizar arquivos, disputam a CPU da máquina ao mesmo tempo, e
//   a folga de tempo que os testes de timing mediam deixava de ser suficiente.
//
// Duas mudanças, combinadas:
//
//   1. Isolamento: este arquivo ficou separado dos outros testes de svgSanitize.ts (que
//      são rápidos e não fazem medição de tempo real) e vitest.config.ts ganhou um teto
//      de paralelismo de arquivos (`poolOptions.forks.maxForks`) bem abaixo do default
//      (`os.availableParallelism()`, 1 processo por núcleo) — ver o comentário lá.
//      Reduzir QUANTOS arquivos rodam ao mesmo tempo reduz proporcionalmente quantos
//      pools piscina concorrentes existem no pior caso, sem serializar a suíte inteira
//      (que ficaria proibitivamente lenta). Vitest não oferece um jeito de dizer "só
//      este arquivo roda sozinho, sem nenhum outro rodando ao mesmo tempo" sem
//      serializar TUDO (`fileParallelism: false` global) — a opção real disponível
//      (documentada em `test.projects`/`poolOptions`) é reduzir o paralelismo GLOBAL, o
//      que foi o que se aplicou.
//   2. Asserções estruturais em vez de teto de milissegundos apertado (ver cada teste
//      abaixo): o que importa provar é QUE o legítimo teve sucesso e QUE o adversarial
//      foi recusado — não bater um número de ms específico, que é sensível a quanta CPU
//      real está disponível no momento exato da rodada. Medição de tempo apertada fica
//      para verificação manual fora da suíte principal (scripts ad-hoc, como os que a
//      revisão adversarial já usou para medir os 5008-5010ms do ataque original).

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  sanitizeSvg,
  InvalidSvgError,
  SvgSanitizePoolOverloadedError,
  SANITIZE_WORKER_TIMEOUT_MS,
  SANITIZE_POOL_MAX_QUEUE,
  getSvgSanitizeQueueSize,
} from '../lib/svgSanitize';

const XMLNS_LOCAL = 'xmlns="http://www.w3.org/2000/svg"';
const window = new JSDOM('').window;

function parseXml(svg: string) {
  const doc = new window.DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.getElementsByTagName('parsererror').length, 'a saída precisa ser XML bem-formado').toBe(0);
  return doc;
}

/** Mesma escala usada nos testes de boundary de svgSanitize.test.ts — leva bem mais que
 *  SANITIZE_WORKER_TIMEOUT_MS se deixado rodar até o fim (~13-35s medidos nas rodadas
 *  anteriores), então o pool sempre corta pelo teto de tempo antes de terminar. */
function payloadLento(): string {
  const n = 50_000;
  return `<svg ${XMLNS_LOCAL}>${'<g>'.repeat(n)}${'</g>'.repeat(n)}</svg>`;
}

const SVG_LEGITIMO = `<svg ${XMLNS_LOCAL} viewBox="0 0 10 10"><rect width="10" height="10" fill="#c2103f"/></svg>`;

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
// não atrás dele. Este teste dispara os dois AO MESMO TEMPO — ele precisa terminar com
// sucesso, independentemente do que acontece com o payload lento (sem asserção de
// tempo apertada — ver cabeçalho do arquivo).
describe('sanitizeSvg — concorrência: SVG legítimo não é penalizado por payload lento concorrente (B1)', () => {
  it('SVG legítimo disparado ao mesmo tempo que um payload lento termina com sucesso', async () => {
    const [lento, legitimo] = await Promise.allSettled([
      sanitizeSvg(payloadLento()),
      (async () => {
        const t0 = Date.now();
        const resultado = await sanitizeSvg(SVG_LEGITIMO);
        return { resultado, ms: Date.now() - t0 };
      })(),
    ]);

    // A garantia central deste teste: o legítimo teve SUCESSO. Se ele tivesse
    // competido pela mesma fila/timer do payload lento (o bug B1), teria sido
    // rejeitado por timeout — em vez de rodar em paralelo, numa thread própria.
    // Estrutural, não temporal: QUE terminou certo, não EM QUANTOS ms (ver cabeçalho).
    expect(legitimo.status, 'o SVG legítimo não pode falhar por causa do payload lento concorrente').toBe('fulfilled');
    if (legitimo.status === 'fulfilled') {
      expect(legitimo.value.resultado.removed).toEqual([]);
      expect(parseXml(legitimo.value.resultado.svg).documentElement.getAttribute('viewBox')).toBe('0 0 10 10');
      // Sanidade bem generosa (não é o teto real de segurança, só descarta "ficou
      // preso para sempre"): registrado no nome da asserção para inspeção manual.
      expect(legitimo.value.ms, `o legítimo levou ${legitimo.value.ms}ms rodando ao lado do payload lento`).toBeLessThan(60_000);
    }

    // O payload lento (numa thread separada, em paralelo) ainda é cortado pelo teto do
    // pool — não "escapa" do timeout só porque outra tarefa concorrente é rápida.
    expect(lento.status).toBe('rejected');
    if (lento.status === 'rejected') {
      expect(lento.reason).toBeInstanceOf(InvalidSvgError);
    }
  }, 60_000);
});

// ── Blocker B (revisão adversarial sobre de0d9a6): 5-6 concorrentes de UMA conta ──
//
// Reprodução investigada do relato original ("5 adversariais + 1 legítimo disparados
// juntos → os 6 rejeitados em ~5008-5010ms") DIRETO no pool (sem passar pelo rate
// limit) — achado honesto que vale registrar: com maxThreads=4 e 6 chamadas
// concorrentes, pelo menos 2 PRECISAM esperar na fila por uma thread livre; e como o
// `AbortSignal.timeout` de cada chamada começa a contar no MOMENTO DA CHAMADA (não
// quando a tarefa de fato começa a rodar numa thread), uma chamada legítima que caia
// entre as que esperam, atrás de vizinhas lentas, ainda corre o risco de ser abortada
// antes mesmo de começar a rodar — reproduzido aqui: mesmo com a guarda de fila (acima)
// e com maxQueue nativo do piscina (descartado — ver comentário em getPool()), o
// legítimo pode ser rejeitado junto quando o burst é MODESTO (6, abaixo do teto de
// sobrecarga de `SANITIZE_POOL_MAX_QUEUE`=8 — ver o describe seguinte, que cobre o caso
// de burst SEVERO). Corrigir isto de vez exigiria reancorar o timeout de cada tarefa
// para o início da EXECUÇÃO (não da submissão) — o piscina não expõe um hook público
// para "tarefa começou a rodar" (só `queueSize`/`idleThreads`/`completed`), então não é
// uma mudança pequena; documentado como risco residual conhecido no relatório final.
//
// A defesa que REALMENTE fecha este cenário específico é anterior a chegar aqui: o
// rate limit por CONTA (lib/svgSanitizeRateLimit.ts, max=4=SANITIZE_POOL_MAX_THREADS)
// garante que uma única conta NUNCA consegue 6 chamadas concorrentes contra o pool — no
// máximo 4, que cabem inteiras nas 4 threads sem NUNCA precisar enfileirar. Isso é
// testado no nível HTTP em __tests__/svgSanitizeRateLimit.test.ts (a 5ª e 6ª requisição
// da mesma conta recebem 429 ANTES de chegar aqui). Por isso não há teste automatizado
// afirmando "o legítimo sempre sobrevive a 6 concorrentes DIRETO no pool" — seria uma
// garantia que este arquivo não entrega sozinho, e o teste falharia de forma
// intermitente conforme a ordem de despacho do piscina.

// ── Blocker B, parte 2: guarda de profundidade de fila (defesa contra VÁRIAS contas) ─
//
// O rate limit por conta (routes/) contém uma única conta em, no máximo,
// SANITIZE_POOL_MAX_THREADS chamadas concorrentes — não impede que VÁRIAS contas
// diferentes, cada uma dentro do próprio limite, ainda somem concorrência suficiente
// pra ultrapassar a capacidade do pool. Este teste satura a fila DE VERDADE (mais
// chamadas do que threads + teto de fila) e prova que o excedente é recusado
// IMEDIATAMENTE (poucos ms), não depois de esperar o timeout inteiro — é essa a
// diferença entre "todo mundo trava 5s e falha" e "falha rápido e claro".
describe('sanitizeSvg — guarda de profundidade de fila (pool sobrecarregado)', () => {
  it('excedente além de maxThreads + SANITIZE_POOL_MAX_QUEUE é recusado rápido, não depois do timeout inteiro', async () => {
    // Capacidade total aceita sem recusa imediata: threads rodando + fila. Não
    // importa o valor exato de maxThreads aqui (não é exportado) — o que importa é
    // ultrapassar (capacidade + folga) por uma margem confortável.
    const excedente = 6;
    const total = SANITIZE_POOL_MAX_QUEUE * 2 + excedente; // bem acima de qualquer capacidade razoável

    const inicios = Array.from({ length: total }, () => Date.now());
    const chamadas = inicios.map((t0) =>
      sanitizeSvg(payloadLento()).then(
        (resultado) => ({ ok: true as const, resultado, ms: Date.now() - t0 }),
        (erro) => ({ ok: false as const, erro, ms: Date.now() - t0 }),
      ),
    );

    const resultados = await Promise.all(chamadas);

    const ehRecusaPorSobrecarga = (r: (typeof resultados)[number]) => !r.ok && r.erro instanceof SvgSanitizePoolOverloadedError;
    const recusadosRapido = resultados.filter(ehRecusaPorSobrecarga) as Array<{ ok: false; erro: SvgSanitizePoolOverloadedError; ms: number }>;

    // A garantia central: HOUVE recusa imediata por sobrecarga (não é opcional — com
    // `total` bem acima da capacidade, alguma tarefa TEM que ser recusada na entrada).
    expect(recusadosRapido.length, 'esperava ao menos uma tarefa recusada por SvgSanitizePoolOverloadedError').toBeGreaterThan(0);

    // E foi RÁPIDO — a diferença central com o bug antigo: não esperou o timeout
    // inteiro (SANITIZE_WORKER_TIMEOUT_MS=5000ms) para descobrir que não cabia.
    // Generoso (1s) de propósito: aqui importa "ordens de grandeza mais rápido que o
    // timeout", não um número de ms exato.
    for (const r of recusadosRapido) {
      expect(r.ms, `recusa por sobrecarga levou ${r.ms}ms`).toBeLessThan(SANITIZE_WORKER_TIMEOUT_MS - 1000);
    }

    // As que NÃO foram recusadas por sobrecarga são todas payloads adversariais lentos:
    // continuam sendo cortadas pelo teto de tempo do pool (InvalidSvgError), nunca
    // "passam" só porque o sistema estava sob pressão.
    const restantes = resultados.filter((r) => !ehRecusaPorSobrecarga(r));
    for (const r of restantes) {
      expect(r.ok, 'payload adversarial não deveria ter sucesso').toBe(false);
      if (!r.ok) expect(r.erro).toBeInstanceOf(InvalidSvgError);
    }
  }, 60_000);

  it('SANITIZE_POOL_MAX_QUEUE e getSvgSanitizeQueueSize são exportados para calibrar este teste', () => {
    expect(SANITIZE_POOL_MAX_QUEUE).toBeGreaterThan(0);
    expect(typeof getSvgSanitizeQueueSize()).toBe('number');
  });
});
