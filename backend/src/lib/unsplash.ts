// Fallback de foto REAL (Unsplash) pro imageResolver — usado quando o gasto de IA
// da marca já está alto, ou quando a autoverificação de coerência reprova uma foto
// gerada. A geração por IA continua sendo o caminho PRINCIPAL; isto é só o
// segundo caminho, nunca o primeiro. Sem UNSPLASH_ACCESS_KEY configurada, fica
// desligado (comportamento idêntico a antes: cai pro skip).

import { config } from '../config.js';
import { logger } from './logger.js';
import { uploadFileToR2 } from './r2.js';

const UNSPLASH_API_BASE = 'https://api.unsplash.com';

export interface UnsplashPhotoResult {
  url: string;
  photographerName: string;
  photographerProfileUrl: string;
  photoPageUrl: string;
}

interface UnsplashSearchResult {
  id: string;
  urls: { regular: string };
  links: { html: string; download_location: string };
  user: { name: string; links: { html: string } };
}

export function isUnsplashConfigured(): boolean {
  return config.unsplashAccessKey.trim().length > 0;
}

function orientationFor(width: number, height: number): 'landscape' | 'portrait' | 'squarish' {
  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.1) return 'squarish';
  return ratio > 1 ? 'landscape' : 'portrait';
}

/**
 * Busca a foto mais relevante pro termo, baixa e sobe pro R2. Nunca lança — falha
 * (sem chave, sem resultado, rede fora) só significa "sem foto do Unsplash",
 * nunca derruba a geração do deck.
 */
export async function searchUnsplashPhoto(
  query: string,
  width: number,
  height: number,
  brandId: string,
): Promise<UnsplashPhotoResult | null> {
  if (!isUnsplashConfigured()) return null;

  try {
    const params = new URLSearchParams({
      query: query.slice(0, 200),
      per_page: '1',
      orientation: orientationFor(width, height),
      content_filter: 'high',
    });
    const searchRes = await fetch(`${UNSPLASH_API_BASE}/search/photos?${params.toString()}`, {
      headers: { Authorization: `Client-ID ${config.unsplashAccessKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!searchRes.ok) {
      logger.warn('Busca no Unsplash falhou', { status: searchRes.status });
      return null;
    }
    const data = (await searchRes.json()) as { results?: UnsplashSearchResult[] };
    const photo = data.results?.[0];
    if (!photo) return null;

    const imgRes = await fetch(photo.urls.regular, { signal: AbortSignal.timeout(15000) });
    if (!imgRes.ok) return null;
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const url = await uploadFileToR2(buffer, `unsplash-${photo.id}.jpg`, 'image/jpeg', `brands/${brandId}/generated`);

    // Guideline obrigatória do Unsplash: registrar o "download" quando a foto é
    // efetivamente usada, não só exibida na busca. Best-effort — não bloqueia o uso.
    fetch(`${photo.links.download_location}`, {
      headers: { Authorization: `Client-ID ${config.unsplashAccessKey}` },
    }).catch(() => {});

    return {
      url,
      photographerName: photo.user.name,
      photographerProfileUrl: photo.user.links.html,
      photoPageUrl: photo.links.html,
    };
  } catch (err) {
    logger.warn('Falha ao buscar/baixar foto do Unsplash', { error: (err as Error).message });
    return null;
  }
}
