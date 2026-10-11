import { JSDOM } from 'jsdom';

// Espaço de foto: o contrato entre o artista (que desenha o slide) e o editor (que troca a foto).
//
//   <div data-photo-slot="1" style="...tamanho, posição, overflow:hidden...">
//     <img data-photo-img src="..." style="object-fit:cover;object-position:50% 50%">
//   </div>
//
// O espaço É o elemento com `data-photo-slot`. Ele vem vazio (foto ainda não fornecida) ou
// com uma <img> dentro. Trocar a foto mexe SÓ na <img> e no `overflow` do espaço: tamanho,
// posição, borda e o resto do layout continuam do jeito que o artista desenhou. É assim que
// a foto entra depois "sem quebrar a hierarquia do layout" (§5 do documento do cérebro).

export type PhotoFit = 'cover' | 'contain';

export interface PhotoPosition {
  /** 0 = esquerda, 100 = direita. É o ponto da foto que fica no centro do enquadramento. */
  x: number;
  /** 0 = topo, 100 = base. */
  y: number;
}

export interface PhotoSlotInfo {
  slot: string;
  hasPhoto: boolean;
  src?: string;
  position: PhotoPosition;
  fit: PhotoFit;
}

export interface PhotoPlacement {
  url: string;
  position?: PhotoPosition;
  fit?: PhotoFit;
  alt?: string;
}

export class PhotoSlotNotFoundError extends Error {
  constructor(slot: string) {
    super(`Espaço de foto "${slot}" não existe neste slide`);
    this.name = 'PhotoSlotNotFoundError';
  }
}

const DEFAULT_POSITION: PhotoPosition = { x: 50, y: 50 };

const clampPct = (n: unknown, fallback: number): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
};

/** `a:b; c:d` → mapa. Ignora o que não for par chave:valor. */
function parseStyle(style: string | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of (style ?? '').split(';')) {
    const i = part.indexOf(':');
    if (i < 1) continue;
    const key = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).trim();
    if (key && value) map.set(key, value);
  }
  return map;
}

const serializeStyle = (map: Map<string, string>): string =>
  [...map].map(([k, v]) => `${k}:${v}`).join(';');

// Mexemos no `style` como texto, e não pelo CSSStyleDeclaration do jsdom: ele descarta
// propriedades que não conhece (object-fit/object-position), e o resultado seria uma foto
// trocada sem o enquadramento.
function withStyle(el: Element, updates: Record<string, string>): void {
  const map = parseStyle(el.getAttribute('style'));
  for (const [k, v] of Object.entries(updates)) map.set(k, v);
  el.setAttribute('style', serializeStyle(map));
}

function parseBody(html: string): { body: HTMLElement } {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  return { body: dom.window.document.body };
}

function findSlot(body: HTMLElement, slot: string): Element | null {
  // Comparação por valor, não por seletor: o id vem do cliente e não pode virar parte de um
  // seletor CSS.
  for (const el of Array.from(body.querySelectorAll('[data-photo-slot]'))) {
    if (el.getAttribute('data-photo-slot') === slot) return el;
  }
  return null;
}

const photoOf = (slotEl: Element): Element | null => slotEl.querySelector('img');

function readPosition(img: Element | null): PhotoPosition {
  const raw = parseStyle(img?.getAttribute('style') ?? null).get('object-position');
  const m = raw?.match(/^(-?[\d.]+)%\s+(-?[\d.]+)%$/);
  if (!m) return { ...DEFAULT_POSITION };
  return { x: clampPct(parseFloat(m[1]!), 50), y: clampPct(parseFloat(m[2]!), 50) };
}

/** Lista os espaços de foto do slide, na ordem em que aparecem. */
export function listPhotoSlots(html: string): PhotoSlotInfo[] {
  const { body } = parseBody(html);
  const out: PhotoSlotInfo[] = [];
  for (const el of Array.from(body.querySelectorAll('[data-photo-slot]'))) {
    const slot = el.getAttribute('data-photo-slot');
    if (!slot) continue;
    const img = photoOf(el);
    const fit = parseStyle(img?.getAttribute('style') ?? null).get('object-fit');
    out.push({
      slot,
      hasPhoto: img !== null,
      src: img?.getAttribute('src') ?? undefined,
      position: readPosition(img),
      fit: fit === 'contain' ? 'contain' : 'cover',
    });
  }
  return out;
}

/**
 * Coloca (ou troca) a foto de um espaço. `placement === null` esvazia o espaço, que continua
 * ali para uma próxima foto. Devolve o HTML novo; não sanitiza (quem chama sanitiza, como em
 * toda escrita de slide).
 */
export function setPhotoInSlot(html: string, slot: string, placement: PhotoPlacement | null): string {
  const { body } = parseBody(html);
  const slotEl = findSlot(body, slot);
  if (!slotEl) throw new PhotoSlotNotFoundError(slot);

  const existing = photoOf(slotEl);

  if (placement === null) {
    for (const img of Array.from(slotEl.querySelectorAll('img'))) img.remove();
    return body.innerHTML;
  }

  const doc = slotEl.ownerDocument;
  const img = existing ?? doc.createElement('img');
  if (!existing) {
    img.setAttribute('data-photo-img', '');
    slotEl.appendChild(img);
  }

  const pos = placement.position ?? readPosition(existing);
  const fit: PhotoFit = placement.fit ?? 'cover';
  img.setAttribute('src', placement.url);
  img.setAttribute('alt', placement.alt ?? '');
  withStyle(img, {
    width: '100%',
    height: '100%',
    display: 'block',
    'object-fit': fit,
    'object-position': `${clampPct(pos.x, 50)}% ${clampPct(pos.y, 50)}%`,
  });

  // A foto não pode vazar do espaço: sem isto, uma foto maior que a moldura invade o layout.
  withStyle(slotEl, { overflow: 'hidden' });
  return body.innerHTML;
}
