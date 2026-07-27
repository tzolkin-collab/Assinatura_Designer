// Busca um review completo de perfis do Instagram via Apify (ator oficial
// apify/instagram-scraper) — o Instagram bloqueia screenshot headless
// (Microlink etc.), então sem isto o benchmarking de Instagram nunca via
// imagem nenhuma, só um fallback fraco de Google Search grounding (texto).
//
// Review completo = perfil (bio/seguidores, resultsType 'details') + N posts
// recentes (imagem/legenda/engajamento, resultsType 'posts') — não só 1 post
// solto, pra dar pro Gemini material suficiente pra avaliar consistência
// visual e de conteúdo ao longo do tempo, não uma foto isolada.
//
// IMPORTANTE — LOTE, não 1 chamada por perfil: `directUrls` aceita VÁRIAS URLs
// no mesmo call (confirmado testando direto na API), então buscar N perfis é
// 2 execuções do ator (1 'details' + 1 'posts' com todas as URLs), não 2×N.
// Antes disso, o fluxo de benchmark (até 5 concorrentes) rodava até 10
// execuções separadas só pro Instagram — caro e lento à toa.
//
// IMPORTANTE: o ator de terceiro `apidojo/instagram-scraper-api` foi tentado
// primeiro e parecia mais barato, mas o desenvolvedor dele bloqueia uso via
// API no Free Plan da Apify (devolve só `[{demo:true}]`, nunca dado real,
// mesmo com créditos disponíveis) — confirmado ao vivo pelos logs do run
// ("The developer of this actor doesn't allow the use of API in the Free
// Plan"). O ator oficial `apify/instagram-scraper` não tem essa trava.
//
// Free tier da Apify: $5/mês em créditos, sem cartão — a partir de ~$1,50 por
// 1000 posts, então o uso deste recurso (poucas referências por marca, resync
// a cada ~14 dias) fica bem dentro do teto grátis mesmo com 12 posts/perfil.

import { config } from '../config.js';
import { logger } from './logger.js';

const APIFY_ACTOR = 'apify~instagram-scraper';
const APIFY_BASE = 'https://api.apify.com/v2';
const REQUEST_TIMEOUT_MS = 90_000; // scraping real demora mais que uma chamada de API comum

interface ApifyProfileDetails {
  username?: string;
  fullName?: string;
  biography?: string;
  followersCount?: number;
  followsCount?: number;
  verified?: boolean;
  isBusinessAccount?: boolean;
  /** Só existe em item de ERRO (`not_found`/`no_items`/etc.) — a Apify devolve
   *  `username` (derivado da URL) MESMO no item de erro, então `username` não
   *  serve pra distinguir "perfil real" de "handle que não existe"; a
   *  ausência deste campo é o único sinal confiável. */
  error?: string;
}

interface ApifyPostItem {
  ownerUsername?: string;
  ownerFullName?: string;
  caption?: string;
  displayUrl?: string;
  likesCount?: number;
  commentsCount?: number;
  hashtags?: string[];
}

export interface InstagramPost {
  imageUrl: string;
  caption?: string;
  likesCount?: number;
  commentsCount?: number;
  hashtags?: string[];
}

export interface InstagramProfileReview {
  username?: string;
  fullName?: string;
  biography?: string;
  followersCount?: number;
  followsCount?: number;
  verified?: boolean;
  posts: InstagramPost[];
}

function runActor<T>(body: Record<string, unknown>): Promise<T[] | null> {
  return fetch(
    `${APIFY_BASE}/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${config.apifyApiToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  ).then(async (res) => {
    if (!res.ok) return null;
    const items = (await res.json()) as T[];
    return Array.isArray(items) ? items : null;
  });
}

/** `instagram.com/USERNAME` — chave de correlação entre a URL de entrada e o
 *  item de saída (a Apify não ecoa a URL original ipsis litteris em todo item,
 *  mas sempre inclui o username, derivado da própria URL ou do perfil real). */
function extractUsername(profileUrl: string): string {
  return (profileUrl.match(/instagram\.com\/([^/?#]+)/i)?.[1] ?? '').toLowerCase();
}

export function isApifyConfigured(): boolean {
  return config.apifyApiToken.trim().length > 0;
}

/**
 * Busca o perfil (bio/seguidores) e os N posts mais recentes com imagem de
 * VÁRIOS perfis de uma vez — 2 execuções do ator no TOTAL (1 'details' + 1
 * 'posts' com todas as URLs juntas), não 2 por perfil. Nunca lança — falha
 * (sem token, ator fora do ar) devolve todo mundo como `null` no Map; um
 * perfil individual que não existe/está vazio também vira `null` só pra ele,
 * sem derrubar os outros do lote.
 */
export async function fetchInstagramProfileReviews(
  profileUrls: string[],
  postsLimit = 12,
): Promise<Map<string, InstagramProfileReview | null>> {
  const uniqueUrls = [...new Set(profileUrls)];
  const result = new Map<string, InstagramProfileReview | null>(uniqueUrls.map((u) => [u, null]));
  if (!isApifyConfigured() || uniqueUrls.length === 0) return result;

  try {
    const [detailsItems, postItems] = await Promise.all([
      runActor<ApifyProfileDetails>({ directUrls: uniqueUrls, resultsType: 'details' }),
      runActor<ApifyPostItem>({ directUrls: uniqueUrls, resultsType: 'posts', resultsLimit: postsLimit }),
    ]);

    for (const profileUrl of uniqueUrls) {
      const uname = extractUsername(profileUrl);
      const rawDetails = detailsItems?.find((d) => (d.username ?? '').toLowerCase() === uname);
      // A Apify devolve um item de "erro" (`{url, username, error: 'not_found',
      // errorDescription}`) quando o handle não existe de verdade — e ele
      // INCLUI `username` (derivado da própria URL), então checar só
      // "username existe" não distingue erro de perfil real (já foi tentado e
      // quebrou — ver teste de regressão). O único sinal confiável é a
      // AUSÊNCIA do campo `error`. Sem essa checagem, um handle inventado
      // (Gemini "chuta" um handle plausível pelo nome da empresa em vez de
      // confirmar via busca) passava como "perfil válido, só sem posts", em
      // vez de cair no fallback.
      const hasRealProfile = !!rawDetails && !rawDetails.error;
      const details = hasRealProfile ? rawDetails : undefined;

      const ownPosts = (postItems ?? []).filter((it) => (it.ownerUsername ?? '').toLowerCase() === uname);
      const posts: InstagramPost[] = ownPosts
        .filter((it) => it.displayUrl)
        .map((it) => ({
          imageUrl: it.displayUrl as string,
          caption: it.caption,
          likesCount: it.likesCount,
          commentsCount: it.commentsCount,
          hashtags: it.hashtags,
        }));

      // Sem NENHUM post com imagem e sem perfil de verdade: não há nada real
      // pra mostrar, fica `null` (já é o default do Map) e o chamador cai
      // pro fallback de texto.
      if (posts.length === 0 && !details) continue;

      result.set(profileUrl, {
        username: details?.username ?? ownPosts[0]?.ownerUsername,
        fullName: details?.fullName ?? ownPosts[0]?.ownerFullName,
        biography: details?.biography,
        followersCount: details?.followersCount,
        followsCount: details?.followsCount,
        verified: details?.verified,
        posts,
      });
    }
  } catch (err) {
    logger.warn('Falha ao buscar review do Instagram via Apify (lote)', { count: uniqueUrls.length, error: (err as Error).message });
  }

  return result;
}

/** Conveniência pra quem só precisa de 1 perfil (fluxo standalone de "Nova
 *  Análise"/"Refazer Análise") — por baixo, é o MESMO lote de 1 item só. */
export async function fetchInstagramProfileReview(
  profileUrl: string,
  postsLimit = 12,
): Promise<InstagramProfileReview | null> {
  const result = await fetchInstagramProfileReviews([profileUrl], postsLimit);
  return result.get(profileUrl) ?? null;
}
