// Render fiel de HTML/CSS para PNG usando chromium headless (Puppeteer Cluster).
// É o que torna o crítico confiável: ele vê EXATAMENTE o que o CSS produz —
// flexbox, gradientes, fontes, sombras — em vez de uma aproximação.

import { Cluster } from 'puppeteer-cluster';
import sharp from 'sharp';
import os from 'os';
import { logger } from './logger.js';

export interface HtmlRasterOptions {
  width: number;
  height: number;
  // Maior dimensão do PNG final (downscale para o crítico economizar token). 0 = full.
  maxDim?: number;
}

interface TaskData {
  html: string;
  opts: HtmlRasterOptions;
}

let clusterPromise: Promise<Cluster<TaskData, Buffer>> | null = null;

/** ~350MB por contexto de render, com folga para o Node e o Postgres client. */
const MB_POR_TAREFA = 350;

/**
 * Quantas rasterizações simultâneas a máquina aguenta. `RASTER_CONCURRENCY` manda;
 * sem ele, o limite sai da memória livre (não da CPU) porque é RAM que falta primeiro.
 */
function resolveRasterConcurrency(): number {
  const configurado = parseInt(process.env.RASTER_CONCURRENCY || '0', 10);
  if (Number.isFinite(configurado) && configurado > 0) return configurado;

  const memoriaMb = os.totalmem() / 1024 / 1024;
  const porMemoria = Math.floor((memoriaMb * 0.5) / MB_POR_TAREFA); // metade da RAM, no máximo
  const porCpu = Math.max(1, os.cpus().length);

  return Math.max(1, Math.min(4, porCpu, porMemoria));
}

async function getCluster(): Promise<Cluster<TaskData, Buffer>> {
  if (!clusterPromise) {
    clusterPromise = (async () => {
      // Antes: CONCURRENCY_BROWSER com um chromium por core de CPU. Num deck grande
      // isso é um browser inteiro (centenas de MB) por core, TODOS vivos ao mesmo
      // tempo, competindo com o Node e com os workers da fila — a receita do OOM que
      // derrubava o processo. Agora:
      //
      // - CONCURRENCY_CONTEXT: um browser só, um contexto isolado por tarefa. O
      //   isolamento que importa aqui (páginas não compartilham estado) continua, mas
      //   o custo de memória fica na casa de dezenas de MB por tarefa, não centenas.
      // - Concorrência limitada e configurável, decidida pela MEMÓRIA da máquina e não
      //   só pela CPU: rasterizar é gasto de RAM, não de cálculo.
      const maxConcurrency = resolveRasterConcurrency();

      logger.info('Subindo o cluster de rasterização', {
        maxConcurrency,
        cpus: os.cpus().length,
        totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
      });

      const c = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_CONTEXT,
        maxConcurrency,
        retryLimit: 3,
        // Uma página travada segurava um slot para sempre; com timeout ela morre e o
        // slot volta. O render de um slide não passa de poucos segundos.
        timeout: 60_000,
        puppeteerOptions: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            // Sem isto o chromium mantém vivas as abas em segundo plano de decks longos.
            '--js-flags=--max-old-space-size=512',
          ],
        },
      });

      // Define a tarefa padrão do cluster
      await c.task(async ({ page, data }) => {
        const { html, opts } = data;
        const { width, height, maxDim = 768 } = opts;

        // Configura viewport
        await page.setViewport({ width, height, deviceScaleFactor: 1 });

        // Carrega o conteúdo HTML
        await page.setContent(html, { waitUntil: 'load', timeout: 15000 });

        // Espera as webfonts carregarem para não rasterizar com fonte de fallback.
        await page.evaluate(() => {
          const d = (globalThis as unknown as { document?: { fonts?: { ready?: Promise<unknown> } } }).document;
          return d?.fonts?.ready ?? null;
        }).catch(() => {});

        // Pequena pausa para garantir a correta renderização final
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Tira o screenshot do slide
        const raw = await page.screenshot({
          type: 'png',
          clip: { x: 0, y: 0, width, height },
        });

        // Retorna a imagem bruta se não houver necessidade de downscale
        if (!maxDim) return raw as Buffer;

        // Faz o resize para otimizar tamanho/banda
        return sharp(raw as Buffer)
          .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer();
      });

      return c;
    })();
  }
  return clusterPromise;
}

/**
 * Fecha o cluster Puppeteer de forma limpa.
 */
export async function closeBrowser(): Promise<void> {
  if (clusterPromise) {
    const c = await clusterPromise;
    await c.close();
    clusterPromise = null;
  }
}

// Garante limpeza de processos ao encerrar o servidor
process.on('SIGTERM', () => {
  closeBrowser().catch((err) => logger.error('Erro ao fechar o cluster Puppeteer no SIGTERM', { error: (err as Error).message }));
});
process.on('SIGINT', () => {
  closeBrowser().catch((err) => logger.error('Erro ao fechar o cluster Puppeteer no SIGINT', { error: (err as Error).message }));
});

/**
 * Renderiza um documento HTML/CSS completo para um buffer PNG.
 */
export async function renderHtmlToPng(html: string, opts: HtmlRasterOptions): Promise<Buffer> {
  const cluster = await getCluster();
  return await cluster.execute({ html, opts });
}

/**
 * Renderiza um documento HTML/CSS completo para uma string base64 PNG.
 */
export async function renderHtmlToBase64(html: string, opts: HtmlRasterOptions): Promise<string> {
  const buf = await renderHtmlToPng(html, opts);
  return buf.toString('base64');
}
