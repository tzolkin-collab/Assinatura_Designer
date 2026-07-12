import https from 'https';
import http from 'http';
import { type SlideNode, type ElementNode } from './designIR/types.js';

const TIMEOUT_MS = 3000;

// Pool de placeholders por orientação — em vez de uma única foto fixa, escolhemos
// pelo aspecto do elemento para não distorcer o layout.
const PLACEHOLDERS = {
  landscape: 'https://images.unsplash.com/photo-1557682250-33bd709cbe85?w=1600&h=900&q=80&fit=crop',
  portrait: 'https://images.unsplash.com/photo-1557682250-33bd709cbe85?w=900&h=1600&q=80&fit=crop',
  square: 'https://images.unsplash.com/photo-1557682250-33bd709cbe85?w=1080&h=1080&q=80&fit=crop',
};

function placeholderFor(width?: number, height?: number): string {
  if (width && height) {
    const ratio = width / height;
    if (ratio > 1.25) return PLACEHOLDERS.landscape;
    if (ratio < 0.8) return PLACEHOLDERS.portrait;
  }
  return PLACEHOLDERS.square;
}

/**
 * Requisição HEAD (com fallback GET) que valida se a URL responde 200-399 E, quando
 * o servidor informa content-type, se ele é realmente de imagem. Isso pega o caso
 * clássico de uma URL alucinada que responde 200 mas devolve HTML em vez de imagem.
 */
function checkUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!url || !url.startsWith('http')) {
      resolve(false);
      return;
    }

    const client = url.startsWith('https') ? https : http;

    const contentTypeOk = (ct?: string): boolean => {
      if (!ct) return true; // alguns CDNs não retornam content-type no HEAD — não penaliza
      return ct.toLowerCase().startsWith('image/');
    };

    const req = client.request(url, { method: 'HEAD', timeout: TIMEOUT_MS }, (res) => {
      const status = res.statusCode ?? 0;
      const ct = res.headers['content-type'];
      // Alguns CDNs (Unsplash) rejeitam HEAD com 403/405 — cai no fallback GET.
      if (status >= 200 && status < 400) {
        resolve(contentTypeOk(ct));
        return;
      }
      if (status === 405 || status === 403) {
        const fallbackReq = client.request(url, {
          method: 'GET',
          headers: { Range: 'bytes=0-100' },
          timeout: TIMEOUT_MS,
        }, (fallbackRes) => {
          const fStatus = fallbackRes.statusCode ?? 0;
          const fCt = fallbackRes.headers['content-type'];
          resolve(fStatus >= 200 && fStatus < 400 && contentTypeOk(fCt));
          fallbackReq.abort();
        });
        fallbackReq.on('error', () => resolve(false));
        fallbackReq.on('timeout', () => { fallbackReq.abort(); resolve(false); });
        fallbackReq.end();
        return;
      }
      resolve(false);
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.abort(); resolve(false); });
    req.end();
  });
}

/**
 * Extrai o payload textual de um SVG, seja ele inline (<svg ...>) ou data-URI
 * (data:image/svg+xml,... ou ...;base64,...). Retorna null se não for SVG.
 */
function extractSvgMarkup(src: string): string | null {
  const trimmed = src.trim();
  if (trimmed.startsWith('<svg') || trimmed.startsWith('<?xml')) return trimmed;

  const dataUriMatch = /^data:image\/svg\+xml([^,]*),(.*)$/is.exec(trimmed);
  if (dataUriMatch) {
    const meta = dataUriMatch[1] ?? '';
    const payload = dataUriMatch[2] ?? '';
    try {
      if (/;base64/i.test(meta)) {
        return Buffer.from(payload, 'base64').toString('utf8');
      }
      return decodeURIComponent(payload);
    } catch {
      return payload; // decode falhou — devolve cru para a validação reprovar
    }
  }
  return null;
}

/**
 * Valida a boa-formação de um SVG sem dependência externa: precisa ter <svg> de
 * abertura e fechamento, declarar viewBox ou width/height, e ter tags balanceadas
 * o suficiente para não estar truncado. Cobre a alucinação típica de SVG cortado.
 */
export function isValidSvg(markup: string): boolean {
  const s = markup.trim();
  if (!/<svg[\s>]/i.test(s)) return false;
  if (!/<\/svg\s*>/i.test(s)) return false; // truncado / sem fechamento
  // Precisa de dimensionamento — SVG sem viewBox nem width/height renderiza 0x0.
  if (!/viewBox\s*=/i.test(s) && !(/\bwidth\s*=/i.test(s) && /\bheight\s*=/i.test(s))) return false;
  // Checagem leve de balanceamento: nº de "<tag" ~ nº de fechamentos (self-closing
  // e </tag>). Se estiver muito desbalanceado, provavelmente está cortado.
  const opens = (s.match(/<[a-zA-Z][^>]*?(?<!\/)>/g) ?? []).length;
  const closes = (s.match(/<\/[a-zA-Z][^>]*>/g) ?? []).length + (s.match(/\/>/g) ?? []).length;
  if (opens - closes > 1) return false;
  return true;
}

/**
 * Valida um único `src` de imagem (http, data-URI raster ou SVG). Retorna a URL
 * corrigida (placeholder) quando inválido, ou null quando está ok.
 */
async function resolveInvalidSrc(src: string, width?: number, height?: number): Promise<string | null> {
  const trimmed = src.trim();

  // SVG (inline ou data-URI): valida boa-formação, não faz request de rede.
  const svg = extractSvgMarkup(trimmed);
  if (svg !== null) {
    return isValidSvg(svg) ? null : placeholderFor(width, height);
  }

  // Data-URI raster: aceita se tiver payload não-vazio; senão troca.
  if (trimmed.startsWith('data:')) {
    const commaIdx = trimmed.indexOf(',');
    const hasPayload = commaIdx > -1 && trimmed.slice(commaIdx + 1).trim().length > 0;
    return hasPayload ? null : placeholderFor(width, height);
  }

  // URL http(s): checa disponibilidade + content-type.
  const ok = await checkUrl(trimmed);
  return ok ? null : placeholderFor(width, height);
}

/**
 * Valida recursivamente os elementos do IR (imagens, SVGs e backgrounds) e corrige
 * URLs/markup inválidos ou alucinados. É a verificação que o agente faz "por conta
 * própria" antes de entregar cada slide.
 */
export async function validateAndFixSlideAssets(slide: SlideNode): Promise<SlideNode> {
  const newSlide = JSON.parse(JSON.stringify(slide)) as SlideNode; // Deep clone

  // 1. Fundo do slide
  if (newSlide.background?.type === 'image' && newSlide.background.src) {
    const fix = await resolveInvalidSrc(newSlide.background.src);
    if (fix) {
      console.warn(`[AssetValidator] Background inválido: ${newSlide.background.src.slice(0, 80)} → placeholder`);
      newSlide.background.src = fix;
    }
  }

  // 2. Elementos (imagens e SVGs)
  async function validateElements(elements: ElementNode[]) {
    for (const el of elements) {
      const w = el.bounds?.width;
      const h = el.bounds?.height;

      if (el.type === 'image' && el.src) {
        const fix = await resolveInvalidSrc(el.src, w, h);
        if (fix) {
          console.warn(`[AssetValidator] Imagem inválida (${el.id}): ${el.src.slice(0, 80)} → placeholder`);
          el.src = fix;
        }
      }

      // SVG alucinado que o modelo enfiou em `content` de uma decoração.
      if (el.content && /<svg[\s>]/i.test(el.content) && !isValidSvg(el.content)) {
        console.warn(`[AssetValidator] SVG inline inválido em content (${el.id}) — removido`);
        el.content = '';
      }

      if (el.type === 'group' && el.children) {
        await validateElements(el.children);
      }
    }
  }

  if (newSlide.elements) {
    await validateElements(newSlide.elements);
  }

  return newSlide;
}
