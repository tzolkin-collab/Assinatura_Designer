import { describe, it, expect } from 'vitest';
import {
  aggregateBaseline,
  assertReadOnlySql,
  buildRunMetrics,
  collectBaseline,
  fmtDuration,
  fmtUsd,
  median,
  percentile,
  renderBaselineMarkdown,
  renderNoTablesMessage,
  summarize,
  toFormat,
  type BaselineRun,
  type RunMetrics,
  type SqlClient,
} from '../lib/generationBaseline.js';
import type { CostStepInput } from '../lib/generationCost.js';

const PRECOS = {
  'modelo-pro': { input: 2, output: 12 },
  'modelo-imagem': { input: 0.5, output: 60 },
};

// ── Cliente falso: registra tudo o que foi enviado e responde por padrão de SQL ──────
interface FakeOpts {
  tables?: string[];
  runs?: Array<Record<string, unknown>>;
  steps?: Array<Record<string, unknown>>;
  slides?: Array<Record<string, unknown>>;
  status?: Array<Record<string, unknown>>;
}

function fakeClient(opts: FakeOpts = {}) {
  const sent: string[] = [];
  const tables = opts.tables ?? ['GenerationRun', 'GenerationStep', 'slides'];
  const client: SqlClient = {
    async query(text, values) {
      sent.push(text);
      if (/to_regclass/.test(text)) {
        const wanted = String(values?.[0] ?? '');
        return { rows: [{ existe: tables.some((t) => wanted === `public."${t}"`) }] };
      }
      if (/GROUP BY status/.test(text)) return { rows: opts.status ?? [{ status: 'COMPLETED', n: (opts.runs ?? []).length }] };
      if (/FROM "GenerationRun"/.test(text)) return { rows: opts.runs ?? [] };
      if (/FROM "GenerationStep"/.test(text)) return { rows: opts.steps ?? [] };
      if (/FROM slides/.test(text)) return { rows: opts.slides ?? [] };
      return { rows: [] }; // BEGIN / SET / ROLLBACK
    },
  };
  return { client, sent };
}

const t0 = '2026-09-01T10:00:00.000Z';
const at = (sec: number) => new Date(Date.parse(t0) + sec * 1000).toISOString();

const runRow = (id: string, format: string | null, durSec: number, postId: string | null = `post-${id}`) => ({
  id,
  postId,
  format,
  startedAt: t0,
  finishedAt: at(durSec),
});

const artista = (runId: string, input: number, output: number) => ({
  runId, kind: 'MODEL', role: 'artist', model: 'modelo-pro', inputTokens: input, outputTokens: output, error: null, metadata: null,
});
const imagem = (runId: string) => ({
  runId, kind: 'IMAGE', role: null, model: 'modelo-imagem', inputTokens: 0, outputTokens: 1000, error: null, metadata: {},
});

describe('estatística', () => {
  it('mediana: ímpar pega o do meio, par faz a média dos dois centrais, vazio é null', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('p90 por posto mais próximo: devolve um valor que existe na amostra', () => {
    const dez = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(dez, 90)).toBe(9);
    expect(percentile([7], 90)).toBe(7);
    // 3 valores: ceil(0,9×3) = 3º → o máximo, sem interpolar um número que nenhuma run teve.
    expect(percentile([10, 20, 30], 90)).toBe(30);
    expect(percentile([], 90)).toBeNull();
  });

  it('summarize ignora null/undefined/NaN e conta a amostra real', () => {
    expect(summarize([10, null, 30, undefined, Number.NaN])).toEqual({ n: 2, median: 20, p90: 30 });
  });
});

describe('formatação', () => {
  it('duração legível e — para desconhecido', () => {
    expect(fmtDuration(45_000)).toBe('45s');
    expect(fmtDuration(120_000)).toBe('2min');
    expect(fmtDuration(150_000)).toBe('2min 30s');
    expect(fmtDuration(null)).toBe('—');
  });

  it('custo em US$ com vírgula decimal e 4 casas', () => {
    expect(fmtUsd(0.4321)).toBe('US$ 0,4321');
    expect(fmtUsd(null)).toBe('—');
  });

  it('formato desconhecido cai em "other", não some da conta', () => {
    expect(toFormat('presentation')).toBe('presentation');
    expect(toFormat('carousel')).toBe('carousel');
    expect(toFormat(null)).toBe('other');
    expect(toFormat('story')).toBe('other');
  });
});

describe('buildRunMetrics + aggregateBaseline (dados de exemplo)', () => {
  const runs: BaselineRun[] = [
    // Apresentações: 60s, 120s, 300s
    runRow('a', 'presentation', 60), runRow('b', 'presentation', 120), runRow('c', 'presentation', 300),
    // Carrossel: 30s
    runRow('d', 'carousel', 30),
  ] as unknown as BaselineRun[];

  const steps = new Map<string, CostStepInput[]>([
    ['a', [artista('a', 10_000, 0) as never]], // 0,02
    ['b', [artista('b', 20_000, 0) as never, imagem('b') as never]], // 0,04 + 0,06 = 0,10
    ['c', [artista('c', 50_000, 0) as never, imagem('c') as never, imagem('c') as never]], // 0,10 + 0,12 = 0,22
    ['d', [artista('d', 5_000, 0) as never]], // 0,01
  ]);
  const slides = new Map([['post-a', 10], ['post-b', 20], ['post-c', 50], ['post-d', 7]]);

  const metrics = buildRunMetrics(runs, steps, slides, PRECOS);
  const agg = aggregateBaseline(metrics);

  it('calcula custo, tokens, slides, imagens e duração por run', () => {
    const c = metrics.find((m) => m.runId === 'c')!;
    expect(c).toMatchObject({ format: 'presentation', durationMs: 300_000, costUsd: 0.22, tokens: 52_000, slides: 50, images: 2, partial: false });
  });

  it('agrega mediana e p90 por formato', () => {
    expect(agg.presentation.runs).toBe(3);
    expect(agg.presentation.durationMs).toEqual({ n: 3, median: 120_000, p90: 300_000 });
    expect(agg.presentation.costUsd).toEqual({ n: 3, median: 0.1, p90: 0.22 });
    expect(agg.presentation.slides.median).toBe(20);
    expect(agg.presentation.images).toEqual({ n: 3, median: 1, p90: 2 });
    expect(agg.carousel.runs).toBe(1);
    expect(agg.carousel.costUsd.median).toBe(0.01);
    expect(agg.other.runs).toBe(0);
  });

  it('run sem post ou sem contagem de slides não entra na métrica de slides (não vira 0)', () => {
    const m = buildRunMetrics(
      [runRow('x', 'presentation', 10, null), runRow('y', 'presentation', 10)] as unknown as BaselineRun[],
      new Map(),
      new Map(), // nenhum post com slides
      PRECOS,
    );
    const a = aggregateBaseline(m);

    expect(a.presentation.slides.n).toBe(0);
    expect(a.presentation.slides.median).toBeNull();
  });

  it('conta runs de custo parcial (modelo sem preço) por formato', () => {
    const m = buildRunMetrics(
      [runRow('p', 'carousel', 10)] as unknown as BaselineRun[],
      new Map([['p', [{ kind: 'MODEL', role: 'artist', model: 'modelo-fantasma', inputTokens: 100, outputTokens: 100 }]]]),
      new Map(),
      PRECOS,
    );

    expect(aggregateBaseline(m).carousel.partialRuns).toBe(1);
  });
});

describe('renderBaselineMarkdown', () => {
  const metrics: RunMetrics[] = [
    { runId: 'a', format: 'presentation', durationMs: 150_000, costUsd: 0.4321, tokens: 52_000, slides: 50, images: 6, partial: false },
    { runId: 'b', format: 'presentation', durationMs: 90_000, costUsd: 0.2, tokens: 30_000, slides: 30, images: 3, partial: true },
  ];
  const md = renderBaselineMarkdown(aggregateBaseline(metrics), {
    generatedAt: '2026-09-21T12:00:00.000Z',
    counts: { completed: 2, failed: 1, running: 0 },
    since: null,
    prices: PRECOS,
  });

  it('rotula tudo como estimativa e mostra as tabelas por formato', () => {
    expect(md).toContain('ESTIMATIVA');
    expect(md).toContain('## Apresentação — 2 gerações');
    expect(md).toContain('| Custo estimado | 2 |');
    expect(md).toContain('US$ 0,4321');
    expect(md).toContain('2min 30s');
  });

  it('omite formatos sem nenhuma run e avisa das runs parciais', () => {
    expect(md).not.toContain('## Carrossel');
    expect(md).toMatch(/1 de 2 tiveram custo PARCIAL/);
  });

  it('lista os preços usados e as limitações (thinking, slides atuais)', () => {
    expect(md).toContain('`modelo-pro`');
    expect(md).toMatch(/Raciocínio \(thinking\)/);
    expect(md).toMatch(/contagem atual do deck/);
  });

  it('a mensagem de tabelas ausentes cita as tabelas e diz que nada foi criado', () => {
    const msg = renderNoTablesMessage(['GenerationRun']);
    expect(msg).toContain('GenerationRun');
    expect(msg).toMatch(/Nada foi criado/);
  });
});

describe('collectBaseline — somente leitura, contra um pg falso', () => {
  it('só emite leitura, abre READ ONLY e termina em ROLLBACK (nunca COMMIT)', async () => {
    const { client, sent } = fakeClient({
      runs: [runRow('a', 'presentation', 60)],
      steps: [artista('a', 10_000, 0)],
      slides: [{ post_id: 'post-a', n: 12 }],
    });

    const r = await collectBaseline(client, PRECOS);

    expect(r.kind).toBe('ok');
    expect(sent[0]).toBe('BEGIN READ ONLY');
    expect(sent[1]).toBe('SET TRANSACTION READ ONLY');
    expect(sent[sent.length - 1]).toBe('ROLLBACK');
    for (const sql of sent) {
      expect(sql).toMatch(/^\s*(SELECT|BEGIN READ ONLY|SET TRANSACTION READ ONLY|SET LOCAL statement_timeout|ROLLBACK)/i);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|COMMIT)\b/i);
    }
  });

  it('calcula as métricas a partir do que o banco devolveu', async () => {
    const { client } = fakeClient({
      runs: [runRow('a', 'presentation', 60), runRow('b', 'carousel', 30)],
      steps: [artista('a', 10_000, 0), imagem('a'), artista('b', 5_000, 0)],
      slides: [{ post_id: 'post-a', n: 12 }, { post_id: 'post-b', n: 5 }],
      status: [{ status: 'COMPLETED', n: 2 }, { status: 'FAILED', n: 1 }],
    });

    const r = await collectBaseline(client, PRECOS);

    if (r.kind !== 'ok') throw new Error('esperava ok');
    expect(r.counts).toEqual({ completed: 2, failed: 1, running: 0 });
    const a = r.metrics.find((m) => m.runId === 'a')!;
    expect(a).toMatchObject({ costUsd: 0.08, images: 1, slides: 12, durationMs: 60_000 });
  });

  it('tabelas de rastro ausentes: devolve no-tables, sem consultar dado nenhum e sem criar nada', async () => {
    const { client, sent } = fakeClient({ tables: ['slides'] });

    const r = await collectBaseline(client, PRECOS);

    expect(r).toEqual({ kind: 'no-tables', missing: ['GenerationRun', 'GenerationStep'] });
    expect(sent.some((s) => /FROM "GenerationRun"/.test(s))).toBe(false);
    expect(sent[sent.length - 1]).toBe('ROLLBACK');
  });

  it('sem nenhuma geração concluída: devolve empty com as contagens', async () => {
    const { client } = fakeClient({ runs: [], status: [{ status: 'FAILED', n: 4 }] });

    const r = await collectBaseline(client, PRECOS);

    expect(r).toEqual({ kind: 'empty', counts: { completed: 0, failed: 4, running: 0 } });
  });

  it('repassa --since como parâmetro (não concatenado no SQL)', async () => {
    const calls: Array<{ text: string; values?: unknown[] }> = [];
    const client: SqlClient = {
      async query(text, values) {
        calls.push({ text, values });
        if (/to_regclass/.test(text)) return { rows: [{ existe: true }] };
        return { rows: [] };
      },
    };

    await collectBaseline(client, PRECOS, { since: '2026-08-03' });

    const comSince = calls.filter((c) => c.values?.[0] === '2026-08-03');
    expect(comSince.length).toBeGreaterThan(0);
    expect(calls.every((c) => !c.text.includes('2026-08-03'))).toBe(true);
  });

  it('faz ROLLBACK mesmo quando uma consulta falha no meio', async () => {
    const sent: string[] = [];
    const client: SqlClient = {
      async query(text) {
        sent.push(text);
        if (/to_regclass/.test(text)) return { rows: [{ existe: true }] };
        if (/GROUP BY status/.test(text)) throw new Error('boom');
        return { rows: [] };
      },
    };

    await expect(collectBaseline(client, PRECOS)).rejects.toThrow('boom');
    expect(sent[sent.length - 1]).toBe('ROLLBACK');
  });
});

describe('assertReadOnlySql — a trava contra escrita', () => {
  it.each([
    'INSERT INTO "GenerationRun" (id) VALUES (1)',
    'UPDATE "GenerationRun" SET status = 1',
    'DELETE FROM "GenerationStep"',
    'DROP TABLE "GenerationRun"',
    'CREATE TABLE x (id int)',
    'TRUNCATE "GenerationStep"',
    'COMMIT',
    'SELECT 1; DROP TABLE "Post"',
    'WITH x AS (DELETE FROM slides RETURNING *) SELECT * FROM x',
  ])('recusa: %s', (sql) => {
    expect(() => assertReadOnlySql(sql)).toThrow(/somente leitura/);
  });

  it.each(['SELECT 1', 'BEGIN READ ONLY', 'SET TRANSACTION READ ONLY', "SET LOCAL statement_timeout = '1000'", 'ROLLBACK'])(
    'aceita: %s',
    (sql) => {
      expect(() => assertReadOnlySql(sql)).not.toThrow();
    },
  );
});
