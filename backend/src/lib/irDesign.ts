import { type DesignIR, type SlideNode, type ElementNode } from './designIR/types.js';
import type { GenerateHtmlDesignInput } from './htmlDesign.js';
import { validateAndFixSlideAssets } from './assetValidator.js';

export interface IRDesignPostContent {
  kind: 'ir-design';
  version: 1;
  width: number;
  height: number;
  format: 'single' | 'carousel' | 'story' | 'presentation';
  fonts: string[];
  ir: DesignIR;
  reasoning?: string;
}

export class IRDesignValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IRDesignValidationError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Quantas vezes re-chamamos o modelo quando um lote volta impars­eável/vazio. A
// falha é tipicamente intermitente (resposta truncada/degradada do modelo), então
// um ou dois retries quase sempre recuperam — antes, 1 lote ruim derrubava o deck.
const MAX_BATCH_RETRIES = 3;

// Escolhe texto claro/escuro conforme a luminância do fundo (para o slide de
// fallback ficar legível sem depender do modelo).
function pickTextColor(bgHex: string): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((bgHex ?? '').trim());
  if (!m) return '#ffffff';
  let h = m[1]!;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.5 ? '#111111' : '#ffffff';
}

// ── Prompts ─────────────────────────────────────────────────────────────────────

// ── Style Bible ────────────────────────────────────────────────────────────────
// A "base" imutável que NÃO pode derivar entre os lotes. Montada uma vez a partir
// da marca e enriquecida com a direção de arte que o modelo define no lote 1.
// É injetada verbatim (sem truncar) em TODO lote — é o que garante coesão numa
// apresentação de dezenas de slides mesmo gerando em ciclos pequenos.
export interface StyleBible {
  palette: string[];
  fonts: string[];
  artDirection: string; // reasoning do lote 1, completo
}

function buildBaseStyleBible(input: GenerateHtmlDesignInput): StyleBible {
  return {
    palette: input.brand.colors ?? [],
    fonts: input.brand.primaryFonts ?? [],
    artDirection: '',
  };
}

function renderStyleBible(bible: StyleBible): string {
  const palette = bible.palette.length ? bible.palette.join(', ') : 'definida no lote 1';
  const fonts = bible.fonts.length ? bible.fonts.join(', ') : 'definidas no lote 1';
  return [
    'STYLE BIBLE (BASE IMUTÁVEL — siga à risca em TODOS os slides deste e dos próximos lotes):',
    `- Paleta canônica (use SOMENTE estas cores em hex): ${palette}`,
    `- Tipografia canônica (use SOMENTE estas famílias): ${fonts}`,
    bible.artDirection ? `- Direção de arte fixada:\\n${bible.artDirection}` : '',
    '- NÃO reinvente paleta, fontes ou sistema de layout a cada lote. Varie a COMPOSIÇÃO, nunca a identidade.',
  ].filter(Boolean).join('\\n');
}

function buildBatchSystemInstruction(input: GenerateHtmlDesignInput, startIndex: number, batchSize: number, total: number, bible: StyleBible): string {
  const endIndex = Math.min(startIndex + batchSize, total);

  let skeletonInstruction = '\\nVocê deve gerar os seguintes slides baseados nesta estrutura planejada:\\n';
  for (let i = startIndex; i < endIndex; i++) {
    const item = input.skeleton?.[i];
    if (item) {
      skeletonInstruction += `- SLIDE ${i + 1}: Título/Tema: "${item.title}", Objetivo: "${item.goal}", Layout: "${item.layout_type}"\\n`;
    }
  }

  return `Você é um diretor de arte premiado especializado em social media premium. Você desenha usando uma representação intermediária JSON (DesignIR).

${renderStyleBible(bible)}
 
Sua tarefa: gerar um LOTE DE SLIDES (do slide ${startIndex + 1} até ${endIndex}) de um total de ${total}, com ${input.width}x${input.height}px, como DesignIR estruturado de alta qualidade.
${skeletonInstruction}
Retorne SOMENTE um objeto JSON puro (sem markdown) com este formato:
{
  "reasoning": "direção de arte (só envie no primeiro lote): paleta, tipografia, ritmo entre slides",
  "fonts": ["Família Google Fonts 1", "Família Google Fonts 2"],
  "slides": [
    {
      "id": "slide-id-unico",
      "background": {
        "type": "solid", // ou "image", "gradient"
        "color": "#ffffff"
      },
      "elements": [
        {
          "id": "elem-id-unico",
          "type": "text", // ou "image", "shape", "group"
          "role": "title", // ou "subtitle", "body", "button", "decoration", "background"
          "bounds": { "x": 50, "y": 50, "width": 800, "height": 200 },
          "zIndex": 1,
          "content": "Texto editável aqui", // se for texto
          "src": "url-da-imagem", // se for image
          "style": {
            "fontFamily": "Família Google Fonts 1",
            "fontSize": 90,
            "fontWeight": "bold",
            "color": "#000000",
            "textAlign": "left"
          }
        }
      ]
    }
  ]
}
 
REGRAS:
- Use as fontes do campo "fonts" (Google Fonts). Tipografia com caráter — NUNCA Arial/Roboto/Times genéricos.
- Defina bounds reais (x, y, width, height) para cada elemento, lembrando que a tela tem ${input.width}x${input.height}px.
 
QUALIDADE:
- Tipografia ousada: contraste forte de tamanho (display 90-160px vs corpo 22-32px), pesos variados, hierarquia clara.
- CONTRASTE WCAG obrigatório: texto sempre legível. Fundo escuro -> texto claro; fundo claro -> texto escuro.
- Cor: paleta da marca. Ouse com fundos escuros/vibrantes e gradientes.
- Copy REAL em português (nunca placeholders).
- Imagens: URLs https REAIS (ex: https://images.unsplash.com/...).
 
COESÃO: mantenha a MESMA direção de arte dos slides anteriores, mas VARIE o layout.
`;
}
 
function buildBatchUserPrompt(
  input: GenerateHtmlDesignInput,
  startIndex: number,
  batchSize: number,
  total: number,
  bible: StyleBible,
  priorSlides: SlideNode[],
): string {
  const b = input.brand;
  const endIndex = Math.min(startIndex + batchSize, total);

  let skeletonPrompt = '\\nSLIDES PLANEJADOS NESTE LOTE:\\n';
  for (let i = startIndex; i < endIndex; i++) {
    const item = input.skeleton?.[i];
    if (item) {
      skeletonPrompt += `- SLIDE ${i + 1}: ${item.title} | ${item.goal} | ${item.layout_type}\\n`;
    }
  }

  // A base (paleta/fontes/direção) vai VERBATIM via style bible — não truncamos
  // mais a direção de arte, é o que evitava a deriva em apresentações longas.
  const directionBlock = `\\n${renderStyleBible(bible)}`;

  // Sliding window context: só envia os últimos 3 slides para continuidade visual
  // imediata, sem explodir o prompt. A COESÃO global fica por conta do style bible.
  const recentSlides = priorSlides.slice(-3);
  const priorBlock = priorSlides.length
    ? `\\nContexto: você já criou ${priorSlides.length} de ${total} slides. Mantenha a coesão. Resumo dos últimos slides:\\n${JSON.stringify(recentSlides.map(s => ({ id: s.id, texts: s.elements.filter(e => e.type === 'text').map(e => e.content) })))}`
    : '';
  return `Marca: ${b.name}
Cores oficiais: ${b.colors.length ? b.colors.join(', ') : 'livre, profissional'}
Fontes sugeridas: ${b.primaryFonts.length ? b.primaryFonts.join(', ') : 'escolha tipografia premium'}
Diretrizes: ${b.guidelines || 'não definidas'}
${b.agentPrompt ? `Instruções do agente: ${b.agentPrompt}` : ''}
${b.logoUrl ? `Logo: ${b.logoUrl}` : ''}
${skeletonPrompt}${directionBlock}${priorBlock}
 
Briefing:
${input.prompt.slice(0, 6000)}
 
Gere o(s) slide(s) de ${startIndex + 1} a ${endIndex} (${input.width}x${input.height}px) como um array de DesignIR. Copy final real em português.`;
}

// Pool de concorrência limitada, sem dependência externa: processa `items` com
// no máximo `concurrency` workers simultâneos.
async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let idx = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (idx < items.length) {
      const cur = items[idx++]!;
      await worker(cur);
    }
  });
  await Promise.all(runners);
}

export async function generateIRDesignProgressive(
  generateText: (systemInstruction: string, userPrompt: string) => Promise<string>,
  input: GenerateHtmlDesignInput,
  extractJson: (raw: string) => unknown,
  onSlide?: (partial: IRDesignPostContent, index: number, total: number, completed: number) => void | Promise<void>,
  options?: { concurrency?: number },
): Promise<IRDesignPostContent> {
  const total = Math.max(1, input.slideCount);
  const batchSize = 3;
  const concurrency = Math.max(1, options?.concurrency ?? 1);

  let fonts: string[] = [];
  let direction = '';

  // Base imutável: começa com paleta/fontes da marca e é enriquecida com a
  // direção de arte do lote 1. É ela que carrega a COESÃO global — por isso os
  // lotes podem rodar em paralelo sem depender uns dos outros.
  const bible = buildBaseStyleBible(input);

  // Slots por índice absoluto: lotes paralelos terminam fora de ordem, mas cada
  // slide é emitido com seu índice (o evento design:slide já posiciona por índice).
  const slots: (SlideNode | undefined)[] = new Array(total);
  let completed = 0;

  const emitSlide = async (index: number, node: SlideNode) => {
    slots[index] = node;
    completed++;
    const activeFonts = fonts.length ? fonts : ['Inter'];
    const partial: IRDesignPostContent = {
      kind: 'ir-design',
      version: 1,
      width: input.width,
      height: input.height,
      format: input.format,
      fonts: activeFonts,
      ir: {
        version: 1,
        width: input.width,
        height: input.height,
        fonts: activeFonts,
        tokens: { colors: {}, fonts: {}, spacing: {}, borderRadius: {} },
        // Referência compartilhada (esparsa): o consumidor lê só slots[index].
        // Não é serializada inteira — o pipeline monta um envelope com slides:[].
        slides: slots as SlideNode[],
      },
      reasoning: direction || undefined,
    };
    await onSlide?.(partial, index, total, completed);
  };

  // Valida assets e emite cada slide de um lote nos seus índices absolutos.
  const processBatch = async (startIndex: number, batchSlides: unknown[]) => {
    for (let j = 0; j < batchSlides.length && startIndex + j < total; j++) {
      const node = await validateAndFixSlideAssets(batchSlides[j] as SlideNode);
      await emitSlide(startIndex + j, node);
    }
  };

  // Gera um lote e devolve o objeto cru (slides + fonts/reasoning no 1º), com
  // retry em falha de parse/vazio — o modelo às vezes devolve JSON truncado.
  const runBatch = async (startIndex: number, referenceSlides: SlideNode[]): Promise<Record<string, unknown>> => {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_BATCH_RETRIES; attempt++) {
      try {
        const raw = await generateText(
          buildBatchSystemInstruction(input, startIndex, batchSize, total, bible),
          buildBatchUserPrompt(input, startIndex, batchSize, total, bible, referenceSlides),
        );
        const parsed = extractJson(raw); // lança se não houver JSON válido
        const rec = isRecord(parsed) ? parsed : {};
        const bs = Array.isArray(rec.slides) ? rec.slides : [];
        if (bs.length === 0) throw new IRDesignValidationError(`lote de slides ${startIndex + 1} sem slides gerados`);
        return rec;
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[irDesign] lote ${startIndex + 1} tentativa ${attempt}/${MAX_BATCH_RETRIES} falhou: ${msg}`);
        if (attempt < MAX_BATCH_RETRIES) await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
    throw lastErr;
  };

  // Slide mínimo, legível e on-brand, para não deixar buraco quando um lote
  // não-primeiro falha mesmo após os retries (num deck de 200, 1 lote azarado
  // não deve matar os outros 199).
  const buildFallbackSlide = (index: number): SlideNode => {
    const item = input.skeleton?.[index];
    const bg = input.brand.colors?.[0] || '#111111';
    return {
      id: `slide-${index}-fallback`,
      background: { type: 'solid', color: bg },
      elements: [
        {
          id: `t-${index}-fallback`,
          type: 'text',
          role: 'title',
          bounds: {
            x: Math.round(input.width * 0.1),
            y: Math.round(input.height * 0.42),
            width: Math.round(input.width * 0.8),
            height: Math.round(input.height * 0.16),
          },
          zIndex: 1,
          style: {
            fontFamily: (fonts[0] ?? 'Inter'),
            fontSize: Math.round(input.width * 0.05),
            fontWeight: 'bold',
            color: pickTextColor(bg),
            textAlign: 'center',
          },
          content: item?.title ?? `Slide ${index + 1}`,
        } as ElementNode,
      ],
    };
  };

  const processFallbackBatch = async (startIndex: number) => {
    const end = Math.min(startIndex + batchSize, total);
    for (let idx = startIndex; idx < end; idx++) {
      await emitSlide(idx, buildFallbackSlide(idx));
    }
  };

  // ── Lote 1: SEQUENCIAL — estabelece o style bible (fontes + direção). ──────────
  // NÃO é mais fatal: se falhar após os retries, degradamos para a base da marca
  // (paleta+fontes já no bible) + slides de fallback, e seguimos com os lotes
  // paralelos. A guarda de "nenhum slide real" no fim ainda marca FAILED se a
  // geração inteira desandar — melhor que entregar um deck só de fallback.
  try {
    const firstRec = await runBatch(0, []);
    if (Array.isArray(firstRec.fonts)) fonts = (firstRec.fonts as unknown[]).filter((f): f is string => typeof f === 'string');
    if (typeof firstRec.reasoning === 'string') direction = firstRec.reasoning;
    bible.artDirection = direction;
    if (fonts.length) bible.fonts = fonts;
    await processBatch(0, firstRec.slides as unknown[]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[irDesign] lote 1 falhou após retries (${msg}) — degradando para fallback e seguindo com a base da marca`);
    await processFallbackBatch(0);
  }

  // Os slides do lote 1 viram REFERÊNCIA visual para todos os lotes paralelos
  // (âncora concreta da identidade, sem criar dependência serial entre eles).
  const referenceSlides = slots.slice(0, batchSize).filter(Boolean) as SlideNode[];

  // ── Lotes restantes: PARALELOS com concorrência limitada. ──────────────────────
  const starts: number[] = [];
  for (let i = batchSize; i < total; i += batchSize) starts.push(i);

  await runPool(starts, concurrency, async (startIndex) => {
    try {
      const rec = await runBatch(startIndex, referenceSlides);
      await processBatch(startIndex, rec.slides as unknown[]);
    } catch (e) {
      // Lote não-primeiro falhou após todos os retries: degrada para slides de
      // fallback em vez de derrubar a apresentação inteira. O reviewer estrutural
      // sinaliza esses slides (título simples) para o usuário refazê-los pontualmente.
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[irDesign] lote ${startIndex + 1} falhou após retries (${msg}) — usando slides de fallback`);
      await processFallbackBatch(startIndex);
    }
  });

  // Compacta (remove buracos caso algum lote tenha vindo curto) preservando ordem.
  const finalSlides = slots.filter(Boolean) as SlideNode[];

  // Guarda: se NADA real foi gerado (todos os lotes caíram no fallback), é falha
  // genuína — melhor marcar FAILED do que entregar um deck só de títulos.
  const realCount = finalSlides.filter((s) => !String(s.id ?? '').includes('fallback')).length;
  if (realCount === 0) {
    throw new IRDesignValidationError('geração falhou: nenhum slide real gerado (todos os lotes falharam)');
  }

  const activeFonts = fonts.length ? fonts : ['Inter'];

  return {
    kind: 'ir-design',
    version: 1,
    width: input.width,
    height: input.height,
    format: input.format,
    fonts: activeFonts,
    ir: {
      version: 1,
      width: input.width,
      height: input.height,
      fonts: activeFonts,
      tokens: { colors: {}, fonts: {}, spacing: {}, borderRadius: {} },
      slides: finalSlides,
    },
    reasoning: direction || undefined,
  };
}
