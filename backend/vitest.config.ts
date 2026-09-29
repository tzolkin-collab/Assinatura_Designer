import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    // Teto de processos concorrentes (blocker A — revisão adversarial sobre de0d9a6):
    // o pool default (`forks`) roda cada arquivo de teste num processo Node SEPARADO,
    // até `os.availableParallelism()` (12 núcleos nesta máquina) de uma vez. Vários
    // arquivos chamam sanitizeSvg de verdade (svgSanitize.test.ts,
    // svgSanitizeConcorrencia.test.ts, svgWritePoints.test.ts, r2SvgGuard.test.ts) e
    // CADA UM sobe seu PRÓPRIO pool piscina (module-level — até 4 worker_threads,
    // ver SANITIZE_POOL_MAX_THREADS em lib/svgSanitize.ts) DENTRO do seu processo — ou
    // seja, no pior caso (~12 forks rodando ao mesmo tempo, ~4 deles com pool próprio)
    // a máquina via até ~12 processos + ~16 threads extras disputando 12 núcleos.
    // Isto NÃO acontece em produção (um processo só, um pool só, persistente) — é
    // artefato do ambiente de teste, e foi a causa raiz de testes de timing (o de
    // concorrência B1 — ver svgSanitizeConcorrencia.test.ts) flakarem ao rodar a
    // suíte INTEIRA mas passarem sempre isolados.
    //
    // Não existe em vitest um jeito de "só este arquivo roda sozinho, nada mais ao
    // mesmo tempo" sem serializar TUDO (`fileParallelism: false`, proibitivamente
    // lento pros outros ~55 arquivos que não têm nada a ver com isto). O nível real
    // de controle disponível é global: quantos arquivos rodam em paralelo no MÁXIMO.
    // Reduzir isto para bem menos que o número de núcleos deixa MENOS pools piscina
    // coexistindo no pior caso, e cada um com mais CPU real disponível — na prática,
    // suficiente para a suíte parar de flakar (ver 5 rodadas completas no relatório).
    // maxWorkers=4 foi escolhido por corresponder ao próprio SANITIZE_POOL_MAX_THREADS:
    // mantém o paralelismo alto o bastante para a suíte não ficar exageradamente
    // lenta, mas baixo o bastante para nunca ter mais do que ~1-2 pools piscina
    // (até 4 threads cada) disputando os núcleos ao mesmo tempo.
    //
    // NOTA: `poolOptions.forks.maxForks` (a opção "clássica") foi REMOVIDA no Vitest 4
    // — vira aviso de depreciação e é SILENCIOSAMENTE ignorada (a suíte roda sem
    // nenhum teto, como se a opção não existisse). `maxWorkers` é a opção de topo
    // correta nesta versão.
    maxWorkers: 4,
  },
});
