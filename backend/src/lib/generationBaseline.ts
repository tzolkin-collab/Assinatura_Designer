import type { ModelPrice } from '../config.js';
import { estimateRunCost, type CostStepInput } from './generationCost.js';

/**
 * Baseline de geração: quanto custa e quanto demora, de fato, um deck do Designer.
 *
 * Tudo aqui é puro, menos `collectBaseline`, que recebe o cliente do banco por
 * parâmetro. O script (scripts/baselineGenerationRuns.ts) só liga o `pg` e escreve o
 * arquivo; a lógica que decide o que é lido, como é agregado e como vira Markdown mora
 * aqui para poder ser testada com dados de exemplo e um cliente falso.
 *
 * SOMENTE LEITURA. Além de a transação abrir como READ ONLY (o Postgres recusa qualquer
 * escrita), toda instrução passa por `assertReadOnlySql`: se alguém acrescentar um
 * INSERT/UPDATE/DDL aqui no futuro, o teste e a execução quebram antes de chegar ao banco.
 */

// ── Cliente e leitura ────────────────────────────────────────────────────────────

/** O mínimo do `pg.Client` que usamos. Deixa o teste passar um falso sem mock de módulo. */
export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

const ALLOWED_SQL = /^\s*(SELECT|BEGIN READ ONLY|SET TRANSACTION READ ONLY|SET LOCAL statement_timeout|ROLLBACK)\b/i;
const FORBIDDEN_SQL = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|COMMIT)\b/i;

/** Barra qualquer instrução que não seja leitura pura. Chamada antes de TODA query. */
export function assertReadOnlySql(sql: string): void {
  if (!ALLOWED_SQL.test(sql) || FORBIDDEN_SQL.test(sql)) {
    throw new Error(`Instrução recusada: o baseline é somente leitura. SQL: ${sql.slice(0, 80)}`);
  }
}

/** Uma run de geração de deck, como vem do banco. */
export interface BaselineRun {
  id: string;
  postId: string | null;
  format: string | null;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
}

export type BaselineFormat = 'presentation' | 'carousel' | 'other';

/** As métricas de UMA run, já calculadas. */
export interface RunMetrics {
  runId: string;
  format: BaselineFormat;
  durationMs: number | null;
  costUsd: number;
  tokens: number;
  slides: number | null;
  images: number;
  partial: boolean;
}

export interface BaselineCounts {
  completed: number;
  failed: number;
  running: number;
}

export type BaselineResult =
  | { kind: 'no-tables'; missing: string[] }
  | { kind: 'empty'; counts: BaselineCounts }
  | { kind: 'ok'; metrics: RunMetrics[]; counts: BaselineCounts; since: string | null };

const TABLES = ['GenerationRun', 'GenerationStep', 'slides'] as const;
const STEP_BATCH = 400;

const num = (v: unknown): number => Number(v) || 0;

export function toFormat(format: string | null | undefined): BaselineFormat {
  return format === 'presentation' || format === 'carousel' ? format : 'other';
}

/**
 * Lê as runs de geração de deck (feature `pipeline`, COMPLETED), os steps e a contagem
 * de slides, e devolve as métricas por run.
 *
 * Se as tabelas de rastro não existirem (migration ainda não aplicada no banco), diz
 * isso em vez de tentar criar ou consultar — `to_regclass` não falha quando falta tabela.
 */
export async function collectBaseline(
  client: SqlClient,
  prices: Record<string, ModelPrice>,
  opts: { since?: string } = {},
): Promise<BaselineResult> {
  const q = async (sql: string, values?: unknown[]) => {
    assertReadOnlySql(sql);
    return client.query(sql, values);
  };

  await q('BEGIN READ ONLY');
  try {
    // Cinto e suspensório: BEGIN READ ONLY já basta, mas o pedido é explícito e é barato.
    await q('SET TRANSACTION READ ONLY');
    // Um SELECT que trava numa tabela de produção não pode ficar pendurado para sempre.
    await q("SET LOCAL statement_timeout = '120000'");

    const missing: string[] = [];
    for (const table of TABLES) {
      const r = await q('SELECT to_regclass($1) IS NOT NULL AS existe', [`public."${table}"`]);
      if (!r.rows[0]?.existe) missing.push(table);
    }
    if (missing.length > 0) return { kind: 'no-tables', missing };

    const since = opts.since ?? null;
    const statusRows = await q(
      `SELECT status::text AS status, COUNT(*)::int AS n
         FROM "GenerationRun"
        WHERE feature = 'pipeline' AND ($1::timestamp IS NULL OR "startedAt" >= $1::timestamp)
        GROUP BY status`,
      [since],
    );
    const counts: BaselineCounts = { completed: 0, failed: 0, running: 0 };
    for (const row of statusRows.rows) {
      if (row.status === 'COMPLETED') counts.completed = num(row.n);
      else if (row.status === 'FAILED') counts.failed = num(row.n);
      else if (row.status === 'RUNNING') counts.running = num(row.n);
    }

    const runsRes = await q(
      `SELECT id, "postId", format,
              "startedAt" AT TIME ZONE 'UTC' AS "startedAt",
              "finishedAt" AT TIME ZONE 'UTC' AS "finishedAt"
         FROM "GenerationRun"
        WHERE feature = 'pipeline' AND status = 'COMPLETED'
          AND ($1::timestamp IS NULL OR "startedAt" >= $1::timestamp)
        ORDER BY "startedAt"`,
      [since],
    );
    // O Prisma grava timestamp SEM fuso, em UTC. Sem o AT TIME ZONE o pg leria como hora
    // local da máquina que roda o script, e uma run que cruza mudança de horário sairia errada.
    const runs = runsRes.rows as unknown as BaselineRun[];
    if (runs.length === 0) return { kind: 'empty', counts };

    // Steps em lotes: um IN gigante estoura o limite de parâmetros com muitas runs.
    const stepsByRun = new Map<string, CostStepInput[]>();
    for (let i = 0; i < runs.length; i += STEP_BATCH) {
      const ids = runs.slice(i, i + STEP_BATCH).map((r) => r.id);
      const stepsRes = await q(
        `SELECT "runId", kind::text AS kind, role, model, "inputTokens", "outputTokens", error, metadata
           FROM "GenerationStep"
          WHERE "runId" = ANY($1::text[])`,
        [ids],
      );
      for (const row of stepsRes.rows) {
        const runId = String(row.runId);
        const list = stepsByRun.get(runId) ?? [];
        list.push(row as unknown as CostStepInput);
        stepsByRun.set(runId, list);
      }
    }

    const postIds = [...new Set(runs.map((r) => r.postId).filter((p): p is string => Boolean(p)))];
    const slidesByPost = new Map<string, number>();
    for (let i = 0; i < postIds.length; i += STEP_BATCH) {
      const slidesRes = await q(
        `SELECT post_id, COUNT(*)::int AS n FROM slides WHERE post_id = ANY($1::text[]) GROUP BY post_id`,
        [postIds.slice(i, i + STEP_BATCH)],
      );
      for (const row of slidesRes.rows) slidesByPost.set(String(row.post_id), num(row.n));
    }

    return { kind: 'ok', metrics: buildRunMetrics(runs, stepsByRun, slidesByPost, prices), counts, since };
  } finally {
    // Nunca COMMIT: não há nada a gravar, e o ROLLBACK devolve a conexão limpa.
    await q('ROLLBACK').catch(() => undefined);
  }
}

// ── Métricas por run ─────────────────────────────────────────────────────────────

export function buildRunMetrics(
  runs: BaselineRun[],
  stepsByRun: Map<string, CostStepInput[]>,
  slidesByPost: Map<string, number>,
  prices: Record<string, ModelPrice>,
): RunMetrics[] {
  return runs.map((run) => {
    const est = estimateRunCost(run, stepsByRun.get(run.id) ?? [], prices);
    return {
      runId: run.id,
      format: toFormat(run.format),
      durationMs: est.durationMs,
      costUsd: est.totalUsd,
      tokens: est.inputTokens + est.outputTokens,
      // Contagem ATUAL do deck (a tabela de slides não guarda a do momento da geração).
      slides: run.postId && slidesByPost.has(run.postId) ? slidesByPost.get(run.postId)! : null,
      images: est.imageCount,
      partial: est.partial,
    };
  });
}

// ── Estatística ──────────────────────────────────────────────────────────────────

/** Mediana; par de valores centrais é a média dos dois. null se não há amostra. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Percentil por posto mais próximo (nearest-rank): o valor que existe na amostra.
 * Com poucas runs, interpolar inventaria um número que nenhum deck teve.
 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1]!;
}

export interface MetricSummary {
  /** Quantas runs entraram nesta métrica (duração e slides podem faltar em algumas). */
  n: number;
  median: number | null;
  p90: number | null;
}

export function summarize(values: Array<number | null | undefined>): MetricSummary {
  const clean = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return { n: clean.length, median: median(clean), p90: percentile(clean, 90) };
}

export interface FormatAggregate {
  runs: number;
  partialRuns: number;
  durationMs: MetricSummary;
  costUsd: MetricSummary;
  tokens: MetricSummary;
  slides: MetricSummary;
  images: MetricSummary;
}

export type BaselineAggregate = Record<BaselineFormat, FormatAggregate>;

export function aggregateBaseline(metrics: RunMetrics[]): BaselineAggregate {
  const out = {} as BaselineAggregate;
  for (const format of ['presentation', 'carousel', 'other'] as const) {
    const rows = metrics.filter((m) => m.format === format);
    out[format] = {
      runs: rows.length,
      partialRuns: rows.filter((m) => m.partial).length,
      durationMs: summarize(rows.map((m) => m.durationMs)),
      costUsd: summarize(rows.map((m) => m.costUsd)),
      tokens: summarize(rows.map((m) => m.tokens)),
      slides: summarize(rows.map((m) => m.slides)),
      images: summarize(rows.map((m) => m.images)),
    };
  }
  return out;
}

// ── Markdown ─────────────────────────────────────────────────────────────────────

const nf = (digits: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function fmtDuration(ms: number | null): string {
  if (ms === null) return '—';
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return sec === 0 ? `${min}min` : `${min}min ${sec}s`;
}

export function fmtUsd(v: number | null): string {
  return v === null ? '—' : `US$ ${nf(4).format(v)}`;
}

export function fmtCount(v: number | null): string {
  return v === null ? '—' : nf(v % 1 === 0 ? 0 : 1).format(v);
}

const FORMAT_LABEL: Record<BaselineFormat, string> = {
  presentation: 'Apresentação',
  carousel: 'Carrossel',
  other: 'Outros / sem formato registrado',
};

export interface BaselineMeta {
  generatedAt: string;
  counts: BaselineCounts;
  since: string | null;
  /** Preços usados (só dos modelos que aparecem), para o leitor saber de onde saiu a conta. */
  prices: Record<string, ModelPrice>;
}

export function renderBaselineMarkdown(agg: BaselineAggregate, meta: BaselineMeta): string {
  const total = agg.presentation.runs + agg.carousel.runs + agg.other.runs;
  const lines: string[] = [
    '# Baseline do Designer IA — custo e tempo por deck',
    '',
    `> Gerado em ${meta.generatedAt} por \`backend/scripts/baselineGenerationRuns.ts\` (somente leitura).`,
    `> Amostra: **${total}** gerações de deck concluídas` +
      (meta.since ? ` desde ${meta.since}` : '') +
      ` (feature \`pipeline\`, status COMPLETED). No mesmo recorte: ${meta.counts.failed} falharam e ${meta.counts.running} ainda constam como em andamento.`,
    '> **Tudo aqui é ESTIMATIVA**, não fatura: o custo é tokens gravados × tabela de preços de `backend/src/config.ts`.',
    '',
  ];

  for (const format of ['presentation', 'carousel', 'other'] as const) {
    const a = agg[format];
    if (a.runs === 0) continue;
    lines.push(`## ${FORMAT_LABEL[format]} — ${a.runs} geraç${a.runs === 1 ? 'ão' : 'ões'}`, '');
    lines.push('| Métrica | Amostra | Mediana | p90 |', '|---|---:|---:|---:|');
    lines.push(`| Duração | ${a.durationMs.n} | ${fmtDuration(a.durationMs.median)} | ${fmtDuration(a.durationMs.p90)} |`);
    lines.push(`| Custo estimado | ${a.costUsd.n} | ${fmtUsd(a.costUsd.median)} | ${fmtUsd(a.costUsd.p90)} |`);
    lines.push(`| Tokens (entrada + saída) | ${a.tokens.n} | ${fmtCount(a.tokens.median)} | ${fmtCount(a.tokens.p90)} |`);
    lines.push(`| Slides | ${a.slides.n} | ${fmtCount(a.slides.median)} | ${fmtCount(a.slides.p90)} |`);
    lines.push(`| Imagens geradas | ${a.images.n} | ${fmtCount(a.images.median)} | ${fmtCount(a.images.p90)} |`);
    lines.push('');
    if (a.partialRuns > 0) {
      lines.push(
        `_${a.partialRuns} de ${a.runs} tiveram custo PARCIAL (modelo sem preço na tabela ou chamada sem contagem de tokens): o custo dessas está subestimado._`,
        '',
      );
    }
  }

  const models = Object.entries(meta.prices);
  if (models.length > 0) {
    lines.push('## Preços usados (US$ por 1M de tokens)', '', '| Modelo | Entrada | Saída |', '|---|---:|---:|');
    for (const [model, p] of models) lines.push(`| \`${model}\` | ${p.input} | ${p.output} |`);
    lines.push('');
  }

  lines.push(
    '## Como ler (e o que este número NÃO é)',
    '',
    '- **Estimativa, não fatura.** A fatura real é a do Google; a tabela de preços envelhece.',
    '- **Raciocínio (thinking) só entra em gerações recentes.** O Gemini cobra esses tokens como saída, mas o rastro só passou a gravá-los depois de `feat(tracing)` — antes, o custo do artista está subestimado. Use `--since` com a data em que isso entrou no ar para um recorte mais fiel.',
    '- **Slides = contagem atual do deck**, não a do momento da geração (o usuário pode ter apagado ou acrescentado slides depois).',
    '- **Duração** = `finishedAt − startedAt` do run de geração; não inclui edições posteriores do deck.',
    '- **p90** é por posto mais próximo (o valor de uma geração real da amostra); com poucas gerações ele é quase o máximo.',
    '- O baseline cobre só a geração inicial do deck (`pipeline`). Edições por chat e por slide têm runs próprios e não entram aqui.',
    '',
  );
  return lines.join('\n');
}

export function renderNoTablesMessage(missing: string[]): string {
  return (
    `As tabelas de rastro não existem neste banco (faltam: ${missing.join(', ')}). ` +
    'Isso quer dizer que a migration 20260802081926_add_generation_tracing ainda não foi aplicada aqui, ' +
    'então não há histórico de gerações para medir. Nada foi criado nem alterado.'
  );
}
