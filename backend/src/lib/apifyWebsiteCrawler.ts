// Rastreia algumas páginas-chave do domínio de um site via Apify
// (apify/website-content-crawler) — texto + screenshot de cada página, pra dar
// pro Gemini um review completo do site (home + Sobre + Produtos/Serviços...),
// não só a home isolada.
//
// Free tier da Apify: $5/mês em créditos, sem cartão — este ator cobra por
// página rastreada, então poucas referências por marca (resync a cada ~14
// dias) com um teto pequeno de páginas fica bem dentro do grátis.

import { config } from '../config.js';
import { logger } from './logger.js';

const APIFY_ACTOR = 'apify~website-content-crawler';
const APIFY_BASE = 'https://api.apify.com/v2';
const REQUEST_TIMEOUT_MS = 120_000; // rastrear várias páginas com browser real demora

interface ApifyCrawledPage {
  url?: string;
  metadata?: { title?: string; description?: string };
  text?: string;
  screenshotUrl?: string;
}

export interface WebsitePage {
  url: string;
  title?: string;
  description?: string;
  text: string;
  screenshotUrl?: string;
}

export function isApifyConfigured(): boolean {
  return config.apifyApiToken.trim().length > 0;
}

/**
 * Rastreia até `maxPages` páginas do mesmo domínio a partir da URL informada.
 * Nunca lança — falha (sem token, site fora do ar, ator indisponível) só
 * significa "sem review de várias páginas", nunca derruba a análise da
 * referência (o chamador cai pro fallback de screenshot único via Microlink).
 */
export async function fetchWebsiteReview(startUrl: string, maxPages = 5): Promise<WebsitePage[] | null> {
  if (!isApifyConfigured()) return null;

  try {
    const res = await fetch(
      `${APIFY_BASE}/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${config.apifyApiToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startUrls: [{ url: startUrl }],
          maxCrawlPages: maxPages,
          saveScreenshots: true,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    if (!res.ok) {
      logger.warn('Apify website-content-crawler devolveu erro', { status: res.status, startUrl });
      return null;
    }

    const items = (await res.json()) as ApifyCrawledPage[];
    if (!Array.isArray(items) || items.length === 0) return null;

    const pages = items
      .filter((it) => it.url && it.text)
      .map((it) => ({
        url: it.url as string,
        title: it.metadata?.title,
        description: it.metadata?.description,
        text: (it.text as string).slice(0, 4000),
        screenshotUrl: it.screenshotUrl,
      }));

    return pages.length > 0 ? pages : null;
  } catch (err) {
    logger.warn('Falha ao rastrear o site via Apify', { startUrl, error: (err as Error).message });
    return null;
  }
}
