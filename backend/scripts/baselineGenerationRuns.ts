/**
 * Baseline de custo e tempo por deck — SOMENTE LEITURA.
 *
 * Lê GenerationRun/GenerationStep (e conta slides) do Postgres, estima o custo com a
 * mesma função que a tela do editor usa e escreve docs/benchmark/BASELINE-DESIGNER.md.
 *
 * Por que `pg` direto e não Prisma: o Prisma às vezes falha neste ambiente, e para uma
 * leitura de relatório o cliente cru é mais simples e controla a transação.
 *
 * Garantias (todas testadas em src/__tests__/generationBaseline.test.ts):
 *  - a conexão abre com BEGIN READ ONLY + SET TRANSACTION READ ONLY (o Postgres recusa escrita);
 *  - toda instrução passa por assertReadOnlySql (só SELECT/BEGIN READ ONLY/SET/ROLLBACK);
 *  - nunca dá COMMIT; termina sempre em ROLLBACK;
 *  - se as tabelas de rastro não existem, diz isso e sai sem criar nada e sem escrever arquivo.
 *
 * Uso (a partir de backend/, com o ambiente carregado por VOCÊ):
 *   DATABASE_URL=... pnpm exec tsx scripts/baselineGenerationRuns.ts [--since 2026-08-03] [--out caminho.md]
 * Ver docs/benchmark/README.md.
 */
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { config } from '../src/config';
import {
  aggregateBaseline,
  collectBaseline,
  renderBaselineMarkdown,
  renderNoTablesMessage,
} from '../src/lib/generationBaseline';

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Host/base sem usuário e senha: o dono confere ONDE está conectando sem vazar credencial no terminal. */
function describeTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch {
    return '(DATABASE_URL não é uma URL válida)';
  }
}

async function main(): Promise<number> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL não definido. Carregue o ambiente antes de rodar (ver docs/benchmark/README.md).');
    return 1;
  }

  const since = argValue('--since');
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    console.error('--since deve ser uma data no formato AAAA-MM-DD.');
    return 1;
  }

  const outPath = path.resolve(argValue('--out') ?? path.resolve(__dirname, '../../docs/benchmark/BASELINE-DESIGNER.md'));

  console.log(`Conectando (somente leitura) em ${describeTarget(databaseUrl)}`);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await collectBaseline(client, config.aiModelPrices, { since });

    if (result.kind === 'no-tables') {
      console.error(renderNoTablesMessage(result.missing));
      return 2;
    }
    if (result.kind === 'empty') {
      console.error(
        `Não há gerações de deck concluídas neste recorte (falhas: ${result.counts.failed}, em andamento: ${result.counts.running}). Nenhum arquivo foi escrito.`,
      );
      return 3;
    }

    const aggregate = aggregateBaseline(result.metrics);
    // Lista a tabela de preços vigente inteira: quem lê o relatório precisa saber de onde saiu a conta.
    const md = renderBaselineMarkdown(aggregate, {
      generatedAt: new Date().toISOString(),
      counts: result.counts,
      since: result.since,
      prices: config.aiModelPrices,
    });

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, md, 'utf8');
    console.log(`Baseline escrito em ${outPath} (${result.metrics.length} gerações).`);
    return 0;
  } finally {
    await client.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // Só a mensagem: o erro do pg pode carregar a connection string.
    console.error('Falha ao gerar o baseline:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
