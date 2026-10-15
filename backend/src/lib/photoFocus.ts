// Enquadramento da foto pelo assunto principal.
//
// Problema medido: a foto entra num espaço com `object-fit: cover` e `object-position: 50% 50%`
// (sempre o centro da foto). O sistema não sabe onde está o assunto, então um retrato com o rosto
// no terço de cima, ou uma pessoa pequena fora do centro, perde a cabeça ou some do corte.
//
// Aqui: (1) geometria pura de como o `cover` corta e de qual `object-position` mantém o assunto
// dentro do espaço; (2) a detecção do assunto (uma chamada de visão do Gemini). A geometria é
// determinística e testável; a detecção é a parte que depende do modelo e sempre pode falhar,
// caso em que o enquadramento volta ao centro (comportamento de antes), nunca a um chute.

/** Retângulo em fração da foto: 0 = esquerda/topo, 1 = direita/base. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface SubjectFocus {
  /** O assunto principal inteiro (a pessoa, o objeto). */
  subject: Box;
  /** O rosto/cabeça da pessoa principal, quando há uma pessoa visível. */
  face: Box | null;
}

export interface FramePosition {
  /** `object-position`, em %: 0 = mostra a esquerda/topo da foto, 100 = direita/base. */
  x: number;
  y: number;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Fração da foto que o `cover` mostra em cada eixo. Foto mais "alta" que o espaço perde topo e
 * base; mais "larga", perde as laterais. 1 = o eixo inteiro cabe.
 */
export function coverVisible(imgAspect: number, slotAspect: number): { vx: number; vy: number } {
  if (!(imgAspect > 0) || !(slotAspect > 0)) return { vx: 1, vy: 1 };
  return slotAspect > imgAspect
    ? { vx: 1, vy: imgAspect / slotAspect }
    : { vx: slotAspect / imgAspect, vy: 1 };
}

/** Início (0..1-v) da janela visível para um `object-position` em %. */
const windowStart = (pct: number, v: number): number => (1 - v) * (clamp01(pct / 100));

function overlap1D(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** Quanto do intervalo [b0,b1] está dentro da janela [w0,w0+v]. 1 = todo. */
function coverage1D(b0: number, b1: number, w0: number, v: number): number {
  const len = b1 - b0;
  if (len <= 0) return 1;
  return overlap1D(b0, b1, w0, w0 + v) / len;
}

/** Fração (0..1) da ÁREA do retângulo que fica visível com a foto nesse espaço e posição. */
export function visibleFraction(box: Box, imgAspect: number, slotAspect: number, pos: FramePosition): number {
  const { vx, vy } = coverVisible(imgAspect, slotAspect);
  const cx = coverage1D(box.x0, box.x1, windowStart(pos.x, vx), vx);
  const cy = coverage1D(box.y0, box.y1, windowStart(pos.y, vy), vy);
  return cx * cy;
}

/** O que precisa aparecer: o rosto com folga (cabeça, cabelo, queixo) ou, sem pessoa, o assunto. */
function requiredBox(focus: SubjectFocus): Box {
  if (!focus.face) return focus.subject;
  const f = focus.face;
  const w = f.x1 - f.x0;
  const h = f.y1 - f.y0;
  return {
    x0: clamp01(f.x0 - 0.35 * w),
    x1: clamp01(f.x1 + 0.35 * w),
    // Folga acima (testa e cabelo) e abaixo (queixo e pescoço): cortar a cabeça é o pior erro.
    y0: clamp01(f.y0 - 0.5 * h),
    y1: clamp01(f.y1 + 0.35 * h),
  };
}

/** Melhor início de janela, em um eixo: o necessário inteiro > o máximo do assunto > o mais centrado. */
function bestStart(required: [number, number], subject: [number, number], v: number): number {
  if (v >= 1) return 0;
  const reqCenter = (required[0] + required[1]) / 2;
  let best = 0;
  let bestScore = -Infinity;
  const steps = 200;
  for (let i = 0; i <= steps; i++) {
    const w0 = ((1 - v) * i) / steps;
    const score =
      10 * coverage1D(required[0], required[1], w0, v) +
      3 * coverage1D(subject[0], subject[1], w0, v) -
      0.5 * Math.abs(w0 + v / 2 - reqCenter);
    if (score > bestScore + 1e-9) {
      bestScore = score;
      best = w0;
    }
  }
  return best;
}

/**
 * O `object-position` que mantém o assunto dentro do espaço. Sem corte num eixo, fica em 50 (nada a
 * decidir). Com corte, escolhe a janela que preserva o rosto (ou o assunto) e, depois, o máximo do
 * assunto, em vez de sempre o centro da foto.
 */
export function framePosition(focus: SubjectFocus, imgAspect: number, slotAspect: number): FramePosition {
  const { vx, vy } = coverVisible(imgAspect, slotAspect);
  const req = requiredBox(focus);
  const sub = focus.subject;
  const toPct = (w0: number, v: number): number => (v >= 1 ? 50 : round1(clamp01(w0 / (1 - v)) * 100));
  return {
    x: toPct(bestStart([req.x0, req.x1], [sub.x0, sub.x1], vx), vx),
    y: toPct(bestStart([req.y0, req.y1], [sub.y0, sub.y1], vy), vy),
  };
}

// ── Espaço: proporção a partir do HTML do artista ───────────────────────────────

/**
 * Proporção (largura/altura) do espaço, quando o artista a escreveu em pixels no `style`
 * (`width:770px;height:1010px`). Em % ou auto não dá para saber sem renderizar: devolve null e
 * quem chama decide (hoje: centro, como antes).
 */
export function slotAspectFromStyle(style: string | null | undefined): number | null {
  if (!style) return null;
  const read = (prop: string): number | null => {
    const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([\\d.]+)px\\s*(?:;|$)`, 'i').exec(style);
    return m ? parseFloat(m[1]!) : null;
  };
  const w = read('width');
  const h = read('height');
  return w && h && w > 0 && h > 0 ? w / h : null;
}

// ── Detecção do assunto ─────────────────────────────────────────────────────────

/** `box_2d` do Gemini = [ymin, xmin, ymax, xmax] em 0..1000. Devolve null se não for um retângulo válido. */
function boxFrom(raw: unknown): Box | null {
  if (!Array.isArray(raw) || raw.length !== 4 || raw.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
  const [ymin, xmin, ymax, xmax] = (raw as number[]).map((n) => clamp01(n / 1000)) as [number, number, number, number];
  if (xmax - xmin < 0.02 || ymax - ymin < 0.02) return null;
  return { x0: xmin, y0: ymin, x1: xmax, y1: ymax };
}

export function parseSubjectResponse(text: string): SubjectFocus | null {
  let data: unknown;
  try {
    data = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const d = data as { subject?: { box_2d?: unknown } | null; face?: { box_2d?: unknown } | null };
  const subject = boxFrom(d.subject?.box_2d);
  if (!subject) return null;
  const face = boxFrom(d.face?.box_2d);
  // Um "rosto" maior que o assunto, ou fora dele, é resposta incoerente: melhor ignorar o rosto.
  const faceOk =
    face !== null &&
    face.x0 >= subject.x0 - 0.05 && face.x1 <= subject.x1 + 0.05 &&
    face.y0 >= subject.y0 - 0.05 && face.y1 <= subject.y1 + 0.05;
  return { subject, face: faceOk ? face : null };
}

export const SUBJECT_PROMPT = `Você enquadra fotos para um designer. Localize o ASSUNTO PRINCIPAL da imagem.

Responda SOMENTE com JSON neste formato:
{"subject":{"box_2d":[ymin,xmin,ymax,xmax]},"face":{"box_2d":[ymin,xmin,ymax,xmax]}|null}

Regras:
- As coordenadas vão de 0 a 1000, relativas à imagem inteira: [ymin, xmin, ymax, xmax].
- "subject": o retângulo que contém o assunto principal INTEIRO (a pessoa toda como aparece na foto, ou o objeto principal).
- "face": o retângulo da cabeça (rosto e cabelo) da pessoa principal. Use null se não houver uma pessoa com a cabeça visível.
- Se houver várias pessoas, a principal é a mais destacada (maior, mais central, em foco).
- Texto, logos e elementos gráficos desenhados sobre a foto não são o assunto.
- Não invente: se não houver assunto claro, devolva o subject cobrindo a imagem toda.`;

export interface FocusClient {
  models: {
    generateContent: (args: {
      model: string;
      contents: unknown;
      config?: Record<string, unknown>;
    }) => Promise<{ text?: string }>;
  };
}

/** Uma chamada de visão. `null` quando o modelo falha ou devolve algo inválido. */
export async function detectSubjectFocus(input: {
  client: FocusClient;
  base64: string;
  mimeType: string;
  model: string;
}): Promise<SubjectFocus | null> {
  try {
    const res = await input.client.models.generateContent({
      model: input.model,
      contents: [{ inlineData: { mimeType: input.mimeType, data: input.base64 } }, { text: SUBJECT_PROMPT }],
      // Sem raciocínio: localizar uma caixa não precisa dele, e com ele o modelo gastava o orçamento
      // pensando e cortava o JSON (MAX_TOKENS), o que fazia a detecção falhar em retratos simples.
      config: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
    });
    return res.text ? parseSubjectResponse(res.text) : null;
  } catch {
    return null;
  }
}
