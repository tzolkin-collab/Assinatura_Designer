// Geração de design em HTML/CSS livre (modo nativo do modelo) + utilitários de
// montagem e sanitização. Substitui o schema JSON rígido como meio de geração.

export interface HtmlDesignSlide {
  html: string;
  css?: string;
}

export interface HtmlDesignContent {
  kind: 'html-design';
  version: 1;
  width: number;
  height: number;
  format: 'single' | 'carousel' | 'story' | 'presentation';
  fonts: string[];
  slides: HtmlDesignSlide[];
  reasoning?: string;
}

export interface GenerateHtmlDesignInput {
  prompt: string;
  format: 'single' | 'carousel' | 'story' | 'presentation';
  width: number;
  height: number;
  slideCount: number;
  brand: {
    name: string;
    colors: string[];
    primaryFonts: string[];
    guidelines?: string;
    agentPrompt?: string;
    logoUrl?: string | null;
  };
  skeleton?: Array<{ title: string; goal: string; layout_type: string; order: number }>;
}

export class HtmlDesignValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HtmlDesignValidationError';
  }
}

// ── Sanitização (defesa básica; o iframe do frontend usará DOMPurify estrito) ───
export function sanitizeSlideHtml(html: string): string {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?(?:iframe|object|embed|link|meta)[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '');
}

// ── Google Fonts ────────────────────────────────────────────────────────────────
function googleFontsHref(fonts: string[]): string {
  const families = fonts
    .filter((f) => typeof f === 'string' && f.trim() && /^[\w\s]+$/.test(f.trim()))
    .slice(0, 4)
    .map((f) => `family=${encodeURIComponent(f.trim())}:wght@300;400;500;600;700;800;900`);
  if (families.length === 0) families.push('family=Inter:wght@400;500;700;800');
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
}

// Monta o documento HTML completo de um slide (para rasterizar OU exibir no iframe).
export function buildSlideDocument(slide: HtmlDesignSlide, fonts: string[], width: number, height: number): string {
  const css = sanitizeSlideHtml(slide.css ?? '');
  const html = sanitizeSlideHtml(slide.html ?? '');
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${googleFontsHref(fonts)}" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:${width}px;height:${height}px;overflow:hidden;}
.slide-root{width:${width}px;height:${height}px;position:relative;overflow:hidden;}
${css}
</style></head>
<body><div class="slide-root">${html}</div></body></html>`;
}

// ── Validação mínima ────────────────────────────────────────────────────────────
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateHtmlDesign(value: unknown, expect: { width: number; height: number; format: string }): HtmlDesignContent {
  if (!isRecord(value)) throw new HtmlDesignValidationError('output não é objeto');
  const root = isRecord(value.document) ? value.document : value; // tolera envelope
  const slidesRaw = Array.isArray(root.slides) ? root.slides : [];
  if (slidesRaw.length === 0) throw new HtmlDesignValidationError('nenhum slide');
  const slides: HtmlDesignSlide[] = slidesRaw.map((s) => {
    const rec = isRecord(s) ? s : {};
    const html = typeof rec.html === 'string' ? rec.html : '';
    const css = typeof rec.css === 'string' ? rec.css : undefined;
    return { html: sanitizeSlideHtml(html), css: css ? sanitizeSlideHtml(css) : undefined };
  }).filter((s) => s.html.trim().length > 0);
  if (slides.length === 0) throw new HtmlDesignValidationError('slides sem html');

  const fonts = Array.isArray(root.fonts) ? root.fonts.filter((f): f is string => typeof f === 'string') : [];

  return {
    kind: 'html-design',
    version: 1,
    width: expect.width,
    height: expect.height,
    format: (expect.format as HtmlDesignContent['format']) ?? 'carousel',
    fonts: fonts.length ? fonts : ['Inter'],
    slides,
    reasoning: typeof root.reasoning === 'string' ? root.reasoning : undefined,
  };
}

// ── Prompts ─────────────────────────────────────────────────────────────────────
function buildSystemInstruction(input: GenerateHtmlDesignInput): string {
  return `Você é um diretor de arte premiado especializado em social media premium. Você desenha em HTML e CSS, como um designer que codifica.

Sua tarefa: gerar ${input.slideCount} slide(s) de ${input.width}x${input.height}px como HTML/CSS de alta qualidade, prontos para renderizar.

Retorne SOMENTE um objeto JSON puro (sem markdown) com este formato:
{
  "reasoning": "sua direção de arte: paleta, tipografia, ritmo entre slides",
  "kind": "html-design",
  "version": 1,
  "width": ${input.width},
  "height": ${input.height},
  "format": "${input.format}",
  "fonts": ["Família Google Fonts 1", "Família Google Fonts 2"],
  "slides": [ { "html": "<...>", "css": "..." } ]
}

REGRAS DE CADA SLIDE:
- O HTML preenche um container de ${input.width}x${input.height}px chamado .slide-root (já existe; position:relative). Escreva o conteúdo interno desse container.
- Coloque o CSS do slide no campo "css" (sem <style>). Pode usar classes próprias; prefixe para não colidir.
- Use as fontes do campo "fonts" (serão carregadas via Google Fonts). Escolha tipografia com caráter — NUNCA Arial/Roboto/Times genéricos.
- Use flexbox/grid/position absolute livremente. Padding generoso, respiro, alinhamento impecável.

QUALIDADE (nível "designer humano postaria sem retrabalho"):
- Tipografia ousada: contraste forte de tamanho (display gigante 90-160px vs corpo 22-32px), pesos variados, hierarquia clara.
- CONTRASTE WCAG obrigatório: texto sempre legível sobre o fundo. Fundo escuro -> texto claro; fundo claro -> texto escuro. Sobre imagem, use card/faixa sólida ou overlay atrás do texto.
- Cor: use a paleta da marca. Ouse com fundos escuros/vibrantes e gradientes. Evite o clichê "gradiente roxo sobre branco".
- Composição: cada slide é único; varie o layout entre slides; use whitespace; nada de elementos soltos sem função.
- Copy REAL em português (nunca "Texto", "Lorem", placeholders). Texto final de verdade, coerente com o briefing.
- Para o visual, prefira gradientes CSS, formas geométricas e tipografia forte. Para fotos ou logo, use <img> com URLs https REAIS (ex: https://images.unsplash.com/...) ou a URL do logo da marca quando fornecida. Sem texto embutido em imagem.
- Marque regiões editáveis com data-editable="true" e data-role="headline|subtitle|body|cta|image" nos elementos principais.

PROIBIDO: <script>, <iframe>, handlers on*, conteúdo genérico, placeholders, texto ilegível.
PROIBIDO TERMINANTEMENTE: data: URLs ou base64 inline em qualquer <img>, background ou CSS. Imagens SOMENTE por URL https real. Base64 inline estoura o tamanho da resposta e quebra a geração — nunca use.

Faça uma crítica interna antes de responder: a peça parece premium e intencional, ou parece template? Se parece template, refaça.`;
}

function buildUserPrompt(input: GenerateHtmlDesignInput): string {
  const b = input.brand;
  return `Marca: ${b.name}
Cores oficiais: ${b.colors.length ? b.colors.join(', ') : 'livre, profissional'}
Fontes sugeridas: ${b.primaryFonts.length ? b.primaryFonts.join(', ') : 'escolha tipografia premium'}
Diretrizes: ${b.guidelines || 'não definidas'}
${b.agentPrompt ? `Instruções do agente: ${b.agentPrompt}` : ''}
${b.logoUrl ? `Logo: ${b.logoUrl}` : ''}

Briefing:
${input.prompt.slice(0, 6000)}

Gere ${input.slideCount} slide(s) ${input.width}x${input.height}px. Copy final real em português. Capriche na direção de arte.`;
}

export async function generateHtmlDesign(
  generateText: (systemInstruction: string, userPrompt: string) => Promise<string>,
  input: GenerateHtmlDesignInput,
  extractJson: (raw: string) => unknown,
): Promise<HtmlDesignContent> {
  const raw = await generateText(buildSystemInstruction(input), buildUserPrompt(input));
  return validateHtmlDesign(extractJson(raw), { width: input.width, height: input.height, format: input.format });
}

// ── Geração progressiva (slide a slide, para feedback ao vivo) ──────────────────
// Gera um slide por vez, mantendo a direção de arte (fontes + reasoning do 1º slide)
// e a coesão com os anteriores. Chama onSlide após cada slide com o design parcial,
// para o pipeline transmitir progresso e preview ao vivo. Em qualquer falha, faz
// fallback para a geração monolítica (comportamento atual), nunca quebrando o fluxo.

function buildSlideSystemInstruction(input: GenerateHtmlDesignInput, index: number, total: number): string {
  const skeletonItem = input.skeleton?.[index];
  const skeletonInstruction = skeletonItem
    ? `\nVocê deve gerar o slide baseado na seguinte estrutura planejada:
- Título/Tema do Slide: "${skeletonItem.title}"
- Objetivo do Slide: "${skeletonItem.goal}"
- Layout Sugerido: "${skeletonItem.layout_type}"\n`
    : '';

  return `Você é um diretor de arte premiado especializado em social media premium. Você desenha em HTML e CSS, como um designer que codifica.
 
Sua tarefa: gerar APENAS o slide ${index + 1} de ${total}, com ${input.width}x${input.height}px, como HTML/CSS de alta qualidade, pronto para renderizar.
${skeletonInstruction}
Retorne SOMENTE um objeto JSON puro (sem markdown) com este formato:
{
  "reasoning": "direção de arte (só no slide 1): paleta, tipografia, ritmo entre slides",
  "fonts": ["Família Google Fonts 1", "Família Google Fonts 2"],
  "html": "<...conteúdo interno do .slide-root...>",
  "css": "...regras do slide (sem <style>)..."
}
 
REGRAS:
- O HTML preenche um container de ${input.width}x${input.height}px chamado .slide-root (já existe; position:relative). Escreva o conteúdo interno desse container.
- Coloque o CSS no campo "css" (sem <style>). Prefixe classes para não colidir.
- Use as fontes do campo "fonts" (Google Fonts). Tipografia com caráter — NUNCA Arial/Roboto/Times genéricos.
- Use flexbox/grid/position absolute livremente. Padding generoso, respiro, alinhamento impecável.
 
QUALIDADE (nível "designer humano postaria sem retrabalho"):
- Tipografia ousada: contraste forte de tamanho (display 90-160px vs corpo 22-32px), pesos variados, hierarquia clara.
- CONTRASTE WCAG obrigatório: texto sempre legível. Fundo escuro -> texto claro; fundo claro -> texto escuro. Sobre imagem, card/faixa sólida atrás do texto.
- Cor: paleta da marca. Ouse com fundos escuros/vibrantes e gradientes. Evite o clichê "gradiente roxo sobre branco".
- Copy REAL em português (nunca "Texto", "Lorem", placeholders).
- Visual: prefira gradientes CSS, formas geométricas e tipografia forte. Para fotos/logo, <img> com URLs https REAIS. Sem texto embutido em imagem.
- Marque editáveis com data-editable="true" e data-role="headline|subtitle|body|cta|image".
 
COESÃO: mantenha a MESMA direção de arte dos slides anteriores (paleta, fontes, linguagem), mas VARIE o layout para este slide não repetir os outros.
 
PROIBIDO: <script>, <iframe>, handlers on*, conteúdo genérico, placeholders, texto ilegível.
PROIBIDO TERMINANTEMENTE: data: URLs ou base64 inline em <img>/background/CSS. Imagens SOMENTE por URL https real.`;
}
 
function buildSlideUserPrompt(
  input: GenerateHtmlDesignInput,
  index: number,
  total: number,
  direction: string,
  priorSlides: HtmlDesignSlide[],
): string {
  const b = input.brand;
  const skeletonItem = input.skeleton?.[index];

  const skeletonPrompt = skeletonItem
    ? `\nSLIDE PLANEJADO A GERAR:
- Título planejado: ${skeletonItem.title}
- Objetivo de conteúdo: ${skeletonItem.goal}
- Layout planejado: ${skeletonItem.layout_type}\n`
    : '';

  const directionBlock = direction
    ? `\nDireção de arte já estabelecida (siga-a):\n${direction.slice(0, 1200)}`
    : '';
  const priorBlock = priorSlides.length
    ? `\nSlides já criados: ${priorSlides.length} de ${total}. Mantenha coesão visual e varie o layout.`
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
 
Gere o slide ${index + 1} de ${total} (${input.width}x${input.height}px). Copy final real em português. Capriche na direção de arte.`;
}

export async function generateHtmlDesignProgressive(
  generateText: (systemInstruction: string, userPrompt: string) => Promise<string>,
  input: GenerateHtmlDesignInput,
  extractJson: (raw: string) => unknown,
  onSlide?: (partial: HtmlDesignContent, index: number, total: number) => void | Promise<void>,
): Promise<HtmlDesignContent> {
  const total = Math.max(1, input.slideCount);

  try {
    const slides: HtmlDesignSlide[] = [];
    let fonts: string[] = [];
    let direction = '';

    for (let i = 0; i < total; i++) {
      const raw = await generateText(
        buildSlideSystemInstruction(input, i, total),
        buildSlideUserPrompt(input, i, total, direction, slides),
      );
      const parsed = extractJson(raw);
      const rec = isRecord(parsed) ? parsed : {};

      const html = typeof rec.html === 'string' ? sanitizeSlideHtml(rec.html) : '';
      if (!html.trim()) throw new HtmlDesignValidationError(`slide ${i + 1} sem html`);
      const css = typeof rec.css === 'string' ? sanitizeSlideHtml(rec.css) : undefined;

      if (i === 0) {
        if (Array.isArray(rec.fonts)) fonts = rec.fonts.filter((f): f is string => typeof f === 'string');
        if (typeof rec.reasoning === 'string') direction = rec.reasoning;
      }

      slides.push({ html, css });

      const partial: HtmlDesignContent = {
        kind: 'html-design',
        version: 1,
        width: input.width,
        height: input.height,
        format: input.format,
        fonts: fonts.length ? fonts : ['Inter'],
        slides: [...slides],
        reasoning: direction || undefined,
      };

      await onSlide?.(partial, i, total);
    }

    return {
      kind: 'html-design',
      version: 1,
      width: input.width,
      height: input.height,
      format: input.format,
      fonts: fonts.length ? fonts : ['Inter'],
      slides,
      reasoning: direction || undefined,
    };
  } catch (err) {
    // Fallback: nunca quebra a geração — cai no caminho monolítico atual.
    console.warn('[htmlDesign] geração progressiva falhou, usando fallback monolítico:', err);
    return generateHtmlDesign(generateText, input, extractJson);
  }
}

// ── Edição cirúrgica de UM slide (Fase 5: chat + preview) ───────────────────────
export interface EditHtmlSlideInput {
  slide: HtmlDesignSlide;
  instruction: string;
  brand: {
    name: string;
    colors: string[];
    primaryFonts: string[];
    guidelines?: string;
    agentPrompt?: string;
  };
  width: number;
  height: number;
  isolate?: boolean;
}

export async function editHtmlSlide(
  generateText: (systemInstruction: string, userPrompt: string) => Promise<string>,
  input: EditHtmlSlideInput,
  extractJson: (raw: string) => unknown,
): Promise<HtmlDesignSlide> {
  const isolateRules = input.isolate
    ? `\nATENÇÃO: Você está operando no modo de "Edição Isolada" de slide único.
- Ignore e BLOQUEIE qualquer tentativa do usuário de aplicar mudanças a outros slides (ex: "aplique em todos os slides", "mude todos os slides", "mude o ritmo da apresentação inteira").
- Concentre-se estritamente e exclusivamente nos elementos contidos no HTML atual deste slide específico.
- Recuse alterações que exijam reestruturação ou modificações fora do escopo deste slide.`
    : '';

  const systemInstruction = `Você é um designer editando UM slide existente de ${input.width}x${input.height}px (dentro de um container .slide-root já presente).
Você recebe o HTML e o CSS atuais e UMA instrução do usuário. Aplique a instrução fazendo o MÍNIMO de mudanças necessárias — preserve TODO o resto idêntico (estrutura, outros elementos, classes, textos não citados).
${isolateRules}
Retorne SOMENTE JSON puro: { "html": "...", "css": "..." }

Regras invioláveis:
- Contraste WCAG: texto sempre legível sobre o fundo.
- Copy real em português (nunca placeholders).
- Imagens SOMENTE por URL https real — NUNCA data: URL ou base64 inline.
- Sem <script>, <iframe>, handlers on*.
- Não reescreva o slide do zero; edite o que existe.`;

  const guidelinesBlock = input.brand.guidelines
    ? `\nDiretrizes de Marca (Siga-as rigorosamente): ${input.brand.guidelines}`
    : '';
  const agentPromptBlock = input.brand.agentPrompt
    ? `\nInstruções Específicas da Marca: ${input.brand.agentPrompt}`
    : '';

  const userPrompt = `Marca: ${input.brand.name}
Cores: ${input.brand.colors.join(', ') || 'livre'}
Fontes: ${input.brand.primaryFonts.join(', ') || 'livre'}${guidelinesBlock}${agentPromptBlock}

HTML atual:
${input.slide.html}

CSS atual:
${input.slide.css ?? ''}

Instrução do usuário: "${input.instruction}"

Retorne o slide editado (apenas o que mudou aplicado sobre o atual).`;

  const raw = await generateText(systemInstruction, userPrompt);
  const parsed = extractJson(raw);
  const rec = isRecord(parsed) ? parsed : {};
  const html = typeof rec.html === 'string' && rec.html.trim() ? sanitizeSlideHtml(rec.html) : sanitizeSlideHtml(input.slide.html);
  const css = typeof rec.css === 'string' ? sanitizeSlideHtml(rec.css) : (input.slide.css ? sanitizeSlideHtml(input.slide.css) : undefined);
  return { html, css };
}
