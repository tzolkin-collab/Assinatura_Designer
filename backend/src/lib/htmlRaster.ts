// Render fiel de HTML/CSS para PNG usando chromium headless (Puppeteer Cluster).
// É o que torna o crítico confiável: ele vê EXATAMENTE o que o CSS produz —
// flexbox, gradientes, fontes, sombras — em vez de uma aproximação.

import { Cluster } from 'puppeteer-cluster';
import sharp from 'sharp';
import os from 'os';

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

async function getCluster(): Promise<Cluster<TaskData, Buffer>> {
  if (!clusterPromise) {
    clusterPromise = (async () => {
      // Determina a concorrência ideal baseada no número de cores de CPU
      const maxConcurrency = Math.max(1, os.cpus().length);

      const c = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_BROWSER, // Isolamento total de recursos
        maxConcurrency,
        retryLimit: 3,
        puppeteerOptions: {
          headless: true,
          args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-setuid-sandbox'],
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
          const d = (globalThis as any).document;
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
  closeBrowser().catch((err) => console.error('Erro ao fechar cluster Puppeteer no SIGTERM:', err));
});
process.on('SIGINT', () => {
  closeBrowser().catch((err) => console.error('Erro ao fechar cluster Puppeteer no SIGINT:', err));
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
