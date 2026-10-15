import sharp from 'sharp';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { logger } from './logger.js';
import {
  detectSubjectFocus,
  framePosition,
  visibleFraction,
  type FocusClient,
  type FramePosition,
  type SubjectFocus,
} from './photoFocus.js';
import { scanHtmlLayout } from './htmlRaster.js';
import { buildSlideDocument } from './htmlDesign.js';
import { listPhotoSlots, setPhotoPosition } from './photoSlot.js';

// Enquadramento automático de uma foto da biblioteca num espaço do slide. Baixa a foto, acha o
// assunto (uma chamada de visão) e devolve o `object-position` que o mantém dentro do espaço.
// Qualquer falha devolve `null`: quem chama cai no centro, que é o comportamento de antes.

const MAX_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;
/** A detecção não precisa da foto inteira: reduzir corta custo e tempo sem mudar as proporções. */
const DETECT_MAX_DIM = 1024;
const CACHE_MAX = 200;

interface Analysis {
  focus: SubjectFocus;
  /** largura/altura da foto original. */
  aspect: number;
}

// Mesma foto, vários espaços: o assunto é o mesmo, só a janela muda. Cache em memória por URL.
const cache = new Map<string, Analysis>();

function remember(url: string, a: Analysis): void {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(url, a);
}

export interface FramingDeps {
  fetchImage?: (url: string) => Promise<Buffer>;
  client?: FocusClient;
  model?: string;
}

async function defaultFetchImage(url: string): Promise<Buffer> {
  if (new URL(url).protocol !== 'https:') throw new Error('só https');
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) throw new Error('imagem grande demais');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('imagem grande demais');
  return buf;
}

export type { Analysis };

export async function analyzePhoto(url: string, deps: FramingDeps = {}): Promise<Analysis | null> {
  const hit = cache.get(url);
  if (hit) return hit;
  try {
    const raw = await (deps.fetchImage ?? defaultFetchImage)(url);
    const meta = await sharp(raw).metadata();
    if (!meta.width || !meta.height) return null;
    const small = await sharp(raw)
      .rotate() // respeita a orientação do EXIF: o aspecto tem de ser o que o navegador mostra
      .resize({ width: DETECT_MAX_DIM, height: DETECT_MAX_DIM, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    const client = deps.client ?? (new GoogleGenAI({ apiKey: config.geminiApiKey }) as unknown as FocusClient);
    const focus = await detectSubjectFocus({
      client,
      base64: small.data.toString('base64'),
      mimeType: 'image/jpeg',
      model: deps.model ?? config.models.fast,
    });
    if (!focus) return null;
    const analysis = { focus, aspect: small.info.width / small.info.height };
    remember(url, analysis);
    return analysis;
  } catch (err) {
    logger.warn('Enquadramento automático indisponível: foto fica centralizada', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface SlotMeasure {
  measure?: (html: string, opts: { width: number; height: number }, script: string) => Promise<Array<{ slot: string | null; w: number; h: number }>>;
}

// Lê no navegador o tamanho REAL do espaço depois do layout. O artista dimensiona o espaço por
// classe CSS (e em %, flex, grid), então o `style` inline quase nunca traz px: só medindo se sabe.
const MEASURE_SCRIPT = `Array.from(document.querySelectorAll('[data-photo-slot]')).map((e) => {
  const r = e.getBoundingClientRect();
  return { slot: e.getAttribute('data-photo-slot'), w: r.width, h: r.height };
})`;

/** Proporção (largura/altura) de TODOS os espaços de foto do documento, por id do espaço. Vazio se falhar. */
export async function measureSlotAspects(
  documentHtml: string,
  size: { width: number; height: number },
  deps: SlotMeasure = {},
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const run = deps.measure ?? ((html, opts, script) => scanHtmlLayout<Array<{ slot: string | null; w: number; h: number }>>(html, opts, script));
    for (const s of await run(documentHtml, size, MEASURE_SCRIPT)) {
      if (s.slot && s.w > 1 && s.h > 1) out.set(s.slot, s.w / s.h);
    }
  } catch (err) {
    logger.warn('Não foi possível medir o espaço da foto', { error: err instanceof Error ? err.message : String(err) });
  }
  return out;
}

/** Proporção (largura/altura) do espaço `slot`, ou `null` se não existe ou não tem tamanho. */
export async function measureSlotAspect(
  documentHtml: string,
  size: { width: number; height: number },
  slot: string,
  deps: SlotMeasure = {},
): Promise<number | null> {
  return (await measureSlotAspects(documentHtml, size, deps)).get(slot) ?? null;
}

/** A posição que mantém o assunto no espaço, dado o que se sabe da foto e do espaço. */
export function frameFromAnalysis(a: Analysis | null, slotAspect: number | null): AutoFrame | null {
  if (!a || !slotAspect) return null;
  const position = framePosition(a.focus, a.aspect, slotAspect);
  return {
    position,
    faceVisible: a.focus.face ? Math.round(visibleFraction(a.focus.face, a.aspect, slotAspect, position) * 100) / 100 : null,
  };
}

export interface AutoFrame {
  position: FramePosition;
  /** Fração do rosto que continua visível nessa posição (null se não há rosto). */
  faceVisible: number | null;
}

/** `null` = não foi possível (detecção falhou, espaço sem proporção conhecida): use o centro. */
export async function autoFramePhoto(
  url: string,
  slotAspect: number | null,
  deps: FramingDeps = {},
): Promise<AutoFrame | null> {
  if (!slotAspect) return null;
  return frameFromAnalysis(await analyzePhoto(url, deps), slotAspect);
}

/** Só para teste. */
export function clearFramingCache(): void {
  cache.clear();
}

export interface FrameSlidesInput<T extends { html: string; css?: string }> {
  slides: T[];
  fonts: string[];
  width: number;
  height: number;
  /** Só fotos destas URLs (biblioteca e anexos da conversa) são baixadas: o artista escreve o HTML, e uma URL dele não vira fetch do servidor. */
  allowedUrls: ReadonlySet<string>;
}

const isDefaultPosition = (p: { x: number; y: number }): boolean => p.x === 50 && p.y === 50;

/**
 * Enquadra pelo assunto as fotos que o ARTISTA já colocou nos espaços dos slides (caminho da geração; o do
 * editor está na rota). Sem isto a foto fornecida ficava sempre centralizada, e um retrato com o rosto no
 * alto perdia a cabeça. Só mexe no `object-position`; respeita o enquadramento que o artista já definiu e
 * qualquer falha deixa o slide exatamente como veio.
 */
export async function autoFrameSlidePhotos<T extends { html: string; css?: string }>(
  input: FrameSlidesInput<T>,
  deps: FramingDeps & SlotMeasure = {},
): Promise<{ slides: T[]; framed: number }> {
  let framed = 0;
  const slides: T[] = [];
  for (const slide of input.slides) {
    const candidates = listPhotoSlots(slide.html).filter(
      (s) => s.hasPhoto && s.src && input.allowedUrls.has(s.src) && s.fit === 'cover' && isDefaultPosition(s.position),
    );
    if (candidates.length === 0) {
      slides.push(slide);
      continue;
    }
    const doc = buildSlideDocument({ html: slide.html, css: slide.css }, input.fonts, input.width, input.height);
    const aspects = await measureSlotAspects(doc, { width: input.width, height: input.height }, deps);
    let html = slide.html;
    for (const c of candidates) {
      const frame = frameFromAnalysis(await analyzePhoto(c.src!, deps), aspects.get(c.slot) ?? null);
      if (!frame) continue;
      html = setPhotoPosition(html, c.slot, frame.position);
      framed++;
    }
    slides.push(html === slide.html ? slide : { ...slide, html });
  }
  return { slides, framed };
}
