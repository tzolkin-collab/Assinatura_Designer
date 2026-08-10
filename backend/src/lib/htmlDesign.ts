// Geração de design em HTML/CSS livre (modo nativo do modelo) + utilitários de
// montagem e sanitização. Substitui o schema JSON rígido como meio de geração.

import createDOMPurify, { type WindowLike } from 'dompurify';
import { JSDOM } from 'jsdom';

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
    /** URLs reais do pool de assets da marca — o artista prefere estas a inventar fotos de banco. */
    assetUrls?: Array<{ url: string; name: string }>;
    /** Preferências de vibe/paleta/ousadia configuradas na marca. Antes só chegava
     *  ao planner/reviewer via texto solto — o artista nunca via isto. */
    presentationConfig?: {
      visualVibe?: string;
      paletteDirection?: string;
      paletteApproved?: string[];
      paletteNotes?: string;
      boldness?: 'safe' | 'balanced' | 'bold';
      photoPreference?: 'minimal' | 'balanced' | 'high';
      imageryStyle?: string;
      notes?: string;
    };
    /** Referências visuais analisadas (Benchmarking) — arquétipo/tom/paleta/insights. */
    references?: Array<{
      name: string;
      archetype?: string | null;
      toneOfVoice?: string | null;
      palette?: string[];
      insightsText?: string | null;
    }>;
    /** Regras/preferências que a IA aprendeu no chat desta marca (ex.: "não gosto de
     *  azul"), gravadas via skill updateBrandMemory. Chave livre → valor livre. */
    learnedPreferences?: Record<string, unknown>;
  };
  skeleton?: Array<{
    title: string;
    goal: string;
    layout_type: string;
    order: number;
    copy?: string;
    /** URL real (biblioteca da marca ou gerada por IA e já hospedada) — o artista
     *  DEVE usar via <img src>, nunca inventar outra para este slide. */
    imageUrl?: string;
    /** Markup <svg>...</svg> completo, gerado por IA — o artista deve embutir
     *  inline no HTML do slide (não é URL, é o próprio código). */
    svgMarkup?: string;
  }>;
}

export class HtmlDesignValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HtmlDesignValidationError';
  }
}

// ── Sanitização ─────────────────────────────────────────────────────────────────
// Este HTML é gerado por LLM e vai direto para `page.setContent` num chromium com
// `--no-sandbox` (ver htmlRaster.ts): o que passar daqui EXECUTA no servidor. Até
// aqui a defesa era um punhado de regex que prometia, em comentário, um DOMPurify
// no iframe do frontend que nunca foi escrito. `<script src=x>` sem tag de
// fechamento atravessava inteiro, porque a regex exigia o `</script>`.
// Agora é parser de verdade: o jsdom monta a árvore e o DOMPurify poda em cima
// dela, então não há truque de tokenização (tag aninhada, sem fechamento, atributo
// sem aspas) que engane a limpeza.
const purifyWindow = new JSDOM('').window;
const purify = createDOMPurify(purifyWindow as unknown as WindowLike);

export function sanitizeSlideHtml(html: string): string {
  return purify.sanitize(String(html), {
    // Os slides trazem CSS embutido e ilustração vetorial; sem isto o design chega
    // sem estilo. O DOMPurify limpa o conteúdo do <style> e do SVG por dentro.
    ADD_TAGS: ['style'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form'],
    FORBID_ATTR: ['srcdoc', 'formaction'],
  });
}

// CSS não é HTML: passá-lo pelo DOMPurify escaparia `>` de seletor e quebraria o
// layout. O risco aqui é outro — fechar o <style> em que ele será embutido e
// emendar uma tag, ou fazer o chromium buscar coisa de fora.
export function sanitizeSlideCss(css: string): string {
  return String(css)
    .replace(/<\/?\s*style[^>]*>/gi, '')
    .replace(/<\/?\s*script[^>]*>/gi, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\(/gi, '')
    .replace(/(?:-moz-)?binding\s*:/gi, '')
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
  const css = sanitizeSlideCss(slide.css ?? '');
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
    return { html: sanitizeSlideHtml(html), css: css ? sanitizeSlideCss(css) : undefined };
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
// Lista as imagens REAIS da marca (upload/Drive/Asana) pro artista preferir a
// elas em vez de inventar URL de banco de imagem. Teto de 8: o prompt já é
// grande e o essencial é sinalizar que existe acervo, não despejar tudo.
export function assetsBlock(assetUrls: Array<{ url: string; name: string }> | undefined): string {
  if (!assetUrls || assetUrls.length === 0) return '';
  // Antes era só a URL crua — o artista não tinha nem o nome do arquivo pra saber
  // do que se trata antes de decidir onde/se usar.
  //
  // Ícone e foto competiam pelo mesmo teto de 8, e o corte costumava comer justamente
  // os ícones (nome mais longo, ordem alfabética). Só que ícone de brandbook é o
  // sistema de design da marca — é o que preenche selo de card e etapa de processo.
  // Separados, cada família tem seu teto e o artista vê que existem as duas coisas.
  const ehVetor = (a: { name: string; url: string }) =>
    /\.svg($|\?)/i.test(a.url) || /\bicon|icone|logo|sparkle|chevron|badge\b/i.test(a.name);
  const vetores = assetUrls.filter(ehVetor);
  const fotos = assetUrls.filter((a) => !ehVetor(a));

  const blocos: string[] = [];
  if (fotos.length) {
    blocos.push(
      `Imagens reais da marca (prefira estas a fotos de banco quando fizer sentido no layout):\n${fotos
        .slice(0, 8)
        .map((a) => `- ${a.name}: ${a.url}`)
        .join('\n')}`,
    );
  }
  if (vetores.length) {
    blocos.push(
      `Ícones e vetores do brandbook — use DENTRO dos componentes (selo circular do card, etapa da esteira, marcador de lista). NÃO são substitutos de foto, e nunca devem aparecer soltos ou repetidos no mesmo slide:\n${vetores
        .slice(0, 16)
        .map((a) => `- ${a.name}: ${a.url}`)
        .join('\n')}`,
    );
  }
  return blocos.join('\n\n');
}

// Antes só o planner e o revisor viam isto (via texto solto em brandContext.ts);
// o artista — quem de fato escreve a paleta/composição — nunca recebia. "Ousadia"
// ou "vibe visual" configurados na marca não mudavam nada no pixel.
export function presentationConfigBlock(pc: GenerateHtmlDesignInput['brand']['presentationConfig']): string {
  if (!pc) return '';
  const lines = [
    pc.visualVibe ? `Vibe visual: ${pc.visualVibe}` : '',
    pc.paletteDirection ? `Direção de paleta: ${pc.paletteDirection}` : '',
    pc.paletteApproved?.length ? `Paleta aprovada (priorize estas cores exatas): ${pc.paletteApproved.join(', ')}` : '',
    pc.paletteNotes ? `Notas de paleta: ${pc.paletteNotes}` : '',
    pc.boldness ? `Nível de ousadia: ${pc.boldness === 'safe' ? 'seguro/conservador' : pc.boldness === 'bold' ? 'ousado, quebre convenções' : 'equilibrado'}` : '',
    pc.photoPreference ? `Preferência de fotos: ${pc.photoPreference === 'minimal' ? 'mínima, priorize tipografia/forma' : pc.photoPreference === 'high' ? 'alta, use foto sempre que fizer sentido' : 'equilibrada'}` : '',
    pc.imageryStyle ? `Estilo de imagem: ${pc.imageryStyle}` : '',
    pc.notes ? `Notas gerais da marca sobre design: ${pc.notes}` : '',
  ].filter(Boolean);
  if (lines.length === 0) return '';
  return `Preferências de design desta marca (siga à risca):\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

export function referencesBlock(references: GenerateHtmlDesignInput['brand']['references']): string {
  if (!references || references.length === 0) return '';
  const lines = references.slice(0, 4).map((r) => {
    const descriptors = [r.archetype, r.toneOfVoice].filter(Boolean).join(' · ');
    const palette = r.palette?.length ? ` | paleta: ${r.palette.join(', ')}` : '';
    const insight = r.insightsText ? ` | ${r.insightsText.slice(0, 150)}` : '';
    return `- ${r.name}${descriptors ? ` (${descriptors})` : ''}${palette}${insight}`;
  });
  return `Referências visuais analisadas desta marca (inspire-se, não copie):\n${lines.join('\n')}`;
}

export function learnedPreferencesBlock(prefs: Record<string, unknown> | undefined): string {
  if (!prefs || Object.keys(prefs).length === 0) return '';
  const lines = Object.entries(prefs).map(([key, value]) => `- ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  return `Regras aprendidas sobre esta marca em conversas anteriores (respeite):\n${lines.join('\n')}`;
}

// ── Geração em LOTES PARALELOS (escala para decks grandes) ─────────────────────
// Portado da era ir-design (lib/irDesign.ts): style bible imutável para coesão,
// lotes de 3 slides com retry próprio, pool de concorrência limitada e slide de
// fallback para lote perdido. A diferença é o meio de desenho: o modelo volta a
// emitir HTML/CSS livre (seu modo nativo) em vez do schema JSON rígido do IR.

const MAX_BATCH_RETRIES = 3;

// Designs/carrosséis são decks pequenos (4-6 slides pela heurística do planner):
// lote de 1 dá o efeito de preview "sendo construído aos poucos" de verdade (cada
// slide chega ao vivo assim que sai do modelo, em vez de 3 de uma vez quase
// simultâneos) e dá a cada slide atenção dedicada da IA. Apresentação mantém lote
// de 3 — decks grandes (podem chegar a centenas de slides) não podem pagar o custo
// de uma chamada por slide. O style bible (fonts/reasoning) vem de METADADO
// devolvido junto no lote 1, não de "olhar N exemplos" — reduzir o lote não
// compromete a coesão visual entre slides.
function resolveBatchSize(format: GenerateHtmlDesignInput['format']): number {
  return format === 'carousel' ? 1 : 3;
}

// A "base" imutável que NÃO pode derivar entre os lotes: paleta/fontes da marca
// + direção de arte que o modelo define no lote 1. Injetada verbatim em TODO
// lote — é o que garante coesão num deck de dezenas de slides gerado em paralelo.
interface StyleBible {
  palette: string[];
  fonts: string[];
  artDirection: string;
}

function renderStyleBible(bible: StyleBible): string {
  const palette = bible.palette.length ? bible.palette.join(', ') : 'definida no lote 1';
  const fonts = bible.fonts.length ? bible.fonts.join(', ') : 'definidas no lote 1';
  return [
    'STYLE BIBLE (BASE IMUTÁVEL — siga à risca em TODOS os slides deste e dos próximos lotes):',
    `- Paleta canônica (use SOMENTE estas cores em hex): ${palette}`,
    `- Tipografia canônica (use SOMENTE estas famílias): ${fonts}`,
    bible.artDirection ? `- Direção de arte fixada:\n${bible.artDirection}` : '',
    '- NÃO reinvente paleta, fontes ou sistema de layout a cada lote. Varie a COMPOSIÇÃO, nunca a identidade.',
  ].filter(Boolean).join('\n');
}

function buildBatchSystemInstruction(input: GenerateHtmlDesignInput, startIndex: number, total: number, bible: StyleBible, batchSize: number): string {
  const endIndex = Math.min(startIndex + batchSize, total);

  let skeletonInstruction = '\nVocê deve gerar os seguintes slides baseados nesta estrutura planejada:\n';
  for (let i = startIndex; i < endIndex; i++) {
    const item = input.skeleton?.[i];
    if (item) {
      skeletonInstruction += `- SLIDE ${i + 1}: Título/Tema: "${item.title}", Objetivo: "${item.goal}", Layout: "${item.layout_type}"\n`;
    }
  }

  return `Você é um diretor de arte premiado especializado em social media premium. Você desenha em HTML e CSS, como um designer que codifica.

${renderStyleBible(bible)}

Sua tarefa: gerar um LOTE DE SLIDES (do slide ${startIndex + 1} até ${endIndex}) de um total de ${total}, com ${input.width}x${input.height}px, como HTML/CSS de alta qualidade, prontos para renderizar.
${skeletonInstruction}
Retorne SOMENTE um objeto JSON puro (sem markdown) com este formato:
{
  "reasoning": "direção de arte (só envie no primeiro lote): paleta, tipografia, ritmo entre slides",
  "fonts": ["Família Google Fonts 1", "Família Google Fonts 2"],
  "slides": [
    { "html": "<...conteúdo interno do .slide-root do slide ${startIndex + 1}...>", "css": "...regras do slide (sem <style>)..." }
  ]
}

REGRAS:
- O HTML de cada slide preenche um container de ${input.width}x${input.height}px chamado .slide-root (já existe; position:relative). Escreva o conteúdo interno desse container.
- Coloque o CSS no campo "css" (sem <style>). Prefixe as classes com s${startIndex + 1}-, s${startIndex + 2}-, ... (o índice do slide) para não colidir entre slides.
- Use as fontes do campo "fonts" (Google Fonts). Tipografia com caráter — NUNCA Arial/Roboto/Times genéricos.
- Use flexbox/grid/position absolute livremente. Padding generoso, respiro, alinhamento impecável.

QUALIDADE (nível "designer humano postaria sem retrabalho"):
- Tipografia ousada: contraste forte de tamanho (display 90-160px vs corpo 22-32px), pesos variados, hierarquia clara.
- CONTRASTE WCAG obrigatório: texto sempre legível. Fundo escuro -> texto claro; fundo claro -> texto escuro. Sobre imagem, card/faixa sólida atrás do texto.
- Cor: paleta da marca. Ouse com fundos escuros/vibrantes e gradientes. Evite o clichê "gradiente roxo sobre branco".
- Copy REAL em português (nunca "Texto", "Lorem", placeholders).
- Visual: prefira gradientes CSS, formas geométricas e tipografia forte. Para fotos/logo, <img> com URLs https REAIS. Sem texto embutido em imagem. Se a URL do Logo não foi fornecida acima, NÃO adicione nenhum logo genérico nem placeholder quadrado. Apenas omita o logo da composição.
- LOGO: como CABEÇALHO FIXO, discreto — mesmo canto, mesmo tamanho em todos os slides (altura entre 3% e 5% da altura do slide). Na CAPA ele pode ser maior e fazer parte da composição. O que é PROIBIDO é o logo virar elemento de preenchimento: ampliado para ocupar área vazia, centralizado no meio do slide, repetido, ou usado como marca d'água grande.
- LOGO SOBRE FUNDO ESCURO: o arquivo do logo pode ser OPACO (fundo branco sólido em vez de transparente) — nesse caso ele vira um retângulo branco sobre fundo escuro, que é pior do que não ter logo. Não há como saber pelo URL. Portanto: coloque o logo sobre uma superfície CLARA. Se o slide tem fundo escuro, ou você posiciona o logo dentro de uma faixa/cartão claro do próprio layout, ou omite o logo naquele slide. NUNCA aplique filtro de inversão no logo: se o arquivo for transparente, o filtro apaga as cores da marca; se for opaco, não resolve nada.
- SLIDE SEM IMAGEM É UM RESULTADO VÁLIDO, e é o caso MAIS COMUM: numa apresentação boa, a maioria dos slides não tem foto. Layouts como list-3-columns, process-flow e comparison vivem de tipografia, forma e cor. Se nenhuma imagem foi fornecida, resolva com um COMPONENTE ESTRUTURAL da lista abaixo — não com espaço vazio e não com enchimento. NUNCA tape um vazio com logo ampliado, ícone repetido ou imagem de outro slide.
- PREENCHA O QUADRO. O componente escolhido deve ocupar a largura útil do slide. Um bloco de conteúdo espremido em 60% da largura, com o restante vazio, é ERRO de composição — ou o componente cresce, ou a tipografia cresce, ou o layout muda.
- Marque editáveis com data-editable="true" e data-role="headline|subtitle|body|cta|image".
- NUNCA invente dado factual da empresa que não foi fornecido acima (telefone, e-mail, endereço, site, CNPJ, nome de produto específico, texto institucional de rodapé). Use SOMENTE o nome da marca, o logo e o que estiver em Diretrizes/Instruções do agente/Referências. Se o layout pedir uma info de contato que não veio nesses campos, prefira um CTA genérico ("Fale conosco", "Saiba mais", "Acesse o link na bio") a inventar um número ou endereço que pareça real.

COMPONENTES ESTRUTURAIS (o vocabulário para slide sem foto):
Todo slide de conteúdo deve ter UM componente que codifique a LÓGICA do que está sendo dito. Escolha
pelo tipo de conteúdo, não por variedade. Todos são HTML+CSS puro — sem imagem, sem SVG externo.
- GRADE DE CARDS: 3 a 5 cards lado a lado, cada um com um selo circular no topo, um título curto e uma
  linha de apoio. Para conceitos paralelos, benefícios, dores. É o mais reaproveitável.
- ESTEIRA DE ETAPAS: blocos encaixados em sequência (chevron via clip-path), cor diferente por etapa.
  Para processo, jornada, fases. A cor ORDENA, não decora.
- LISTA NUMERADA COM FILETE: 3 a 4 linhas, numeral pequeno à esquerda (01/02/03), título e corpo em
  colunas, separadas por borda de 1px. Para argumentos que se acumulam.
- FÓRMULA: termos em caixas ligados por operadores (+ + + =), o último em destaque. Para "o que somado
  gera o quê".
- ÓRBITA: um bloco central e 3 cards ao redor ligados por linhas tracejadas. Para "tudo converge para".
- ESCALA: barra horizontal em gradiente com marcações nomeadas e um indicador posicionado. Para
  maturidade, temperatura, progresso.
- COMPARAÇÃO: duas colunas com fundos contrastantes, mesma estrutura interna. Para antes/depois, nós/eles.
- FAIXA DE FECHO: barra no rodapé com selo circular à esquerda e uma frase de síntese. Fecha o slide e
  ancora a composição na base. Cabe em quase todos.
- CARTÕES DE MÍDIA DESLOCADOS: quando houver 2 a 3 imagens, cards com deslocamento vertical entre si e
  legenda curta. Nunca as imagens soltas em fila reta.

REGISTRO VISUAL: leia "Nível de ousadia" nas diretrizes da marca acima.
- "safe" -> EDITORIAL: pesos finos (200-300), letter-spacing largo, filetes de 1px, muito espaço
  negativo, paleta de 2 neutros + 1 acento. Componentes discretos, sem preenchimento sólido.
- "bold" -> COMERCIAL: caixa alta pesada e condensada (700-900), blocos de cor saturada, cards com
  fundo cheio, selos circulares preenchidos. Componentes densos, quadro cheio.
- "balanced" ou ausente -> meio-termo: display pesado no título, corpo em peso regular, componentes com
  borda em vez de preenchimento sólido.
Escolha UM registro e mantenha nos slides todos. Misturar os dois é o erro mais visível.

COESÃO: mantenha a MESMA direção de arte dos slides anteriores, mas VARIE o layout.

PROIBIDO: <script>, <iframe>, handlers on*, conteúdo genérico, placeholders, texto ilegível.
PROIBIDO TERMINANTEMENTE: data: URLs ou base64 inline em <img>/background/CSS. Imagens SOMENTE por URL https real.`;
}

function buildBatchUserPrompt(
  input: GenerateHtmlDesignInput,
  startIndex: number,
  total: number,
  bible: StyleBible,
  referenceSlides: HtmlDesignSlide[],
  batchSize: number,
): string {
  const b = input.brand;
  const endIndex = Math.min(startIndex + batchSize, total);

  let skeletonPrompt = '\nSLIDES PLANEJADOS NESTE LOTE:\n';
  let hasCopy = false;
  let hasResolvedImage = false;
  for (let i = startIndex; i < endIndex; i++) {
    const item = input.skeleton?.[i];
    if (item) {
      skeletonPrompt += `- SLIDE ${i + 1}: ${item.title} | ${item.goal} | ${item.layout_type}\n`;
      if (item.copy?.trim()) {
        hasCopy = true;
        skeletonPrompt += `  COPY OFICIAL DO SLIDE ${i + 1} (use este texto VERBATIM como conteúdo — distribua em título/corpo conforme o layout, NÃO reescreva nem invente):\n  """${item.copy.trim()}"""\n`;
      }
      if (item.imageUrl) {
        hasResolvedImage = true;
        skeletonPrompt += `  IMAGEM RESOLVIDA DO SLIDE ${i + 1}: use exatamente esta URL num <img src="${item.imageUrl}">. NÃO invente outra imagem/URL para este slide.\n`;
      }
      if (item.svgMarkup) {
        hasResolvedImage = true;
        skeletonPrompt += `  SVG RESOLVIDO DO SLIDE ${i + 1} (embuta este markup INLINE no HTML do slide, redimensione via CSS se precisar, não reescreva o desenho):\n  ${item.svgMarkup}\n`;
      }
    }
  }
  if (hasCopy) {
    skeletonPrompt += '\nREGRA DE COPY: os slides acima têm copy oficial aprovada. O texto renderizado deve ser ESSE texto — sua liberdade é o DESIGN (layout, cor, tipografia), nunca o conteúdo.\n';
  }
  if (hasResolvedImage) {
    skeletonPrompt += '\nREGRA DE IMAGEM: quando um slide tem "IMAGEM RESOLVIDA" ou "SVG RESOLVIDO" acima, use exatamente o que foi dado — não gere outra imagem, não troque a URL, não redesenhe o SVG.\n';
  }

  // Referência CONCRETA de identidade: o HTML do slide 1 (truncado) ancora paleta,
  // fontes e linguagem visual sem criar dependência serial entre os lotes.
  const refBlock = referenceSlides.length
    ? `\nReferência de identidade (slide 1 já criado — siga a MESMA linguagem visual, mas NÃO copie o layout):\n${(referenceSlides[0]!.css ?? '').slice(0, 1800)}`
    : '';

  return `Marca: ${b.name}
Cores oficiais: ${b.colors.length ? b.colors.join(', ') : 'livre, profissional'}
Fontes sugeridas: ${b.primaryFonts.length ? b.primaryFonts.join(', ') : 'escolha tipografia premium'}
Diretrizes: ${b.guidelines || 'não definidas'}
${b.agentPrompt ? `Instruções do agente: ${b.agentPrompt}` : ''}
${b.logoUrl ? `Logo: ${b.logoUrl}` : ''}
${assetsBlock(b.assetUrls)}
${presentationConfigBlock(b.presentationConfig)}
${referencesBlock(b.references)}
${learnedPreferencesBlock(b.learnedPreferences)}
${skeletonPrompt}
${renderStyleBible(bible)}${refBlock}

Briefing:
${input.prompt.slice(0, 6000)}

Gere os slides de ${startIndex + 1} a ${endIndex} (${input.width}x${input.height}px) como array "slides" de objetos {html, css}. Copy final real em português.`;
}

// Pool de concorrência limitada, sem dependência externa.
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

// Texto claro/escuro conforme a luminância do fundo (fallback legível sem modelo).
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

export async function generateHtmlDesignBatched(
  generateText: (systemInstruction: string, userPrompt: string) => Promise<string>,
  input: GenerateHtmlDesignInput,
  extractJson: (raw: string) => unknown,
  onSlide?: (partial: HtmlDesignContent, index: number, total: number, completed: number) => void | Promise<void>,
  options?: { concurrency?: number },
): Promise<HtmlDesignContent> {
  const total = Math.max(1, input.slideCount);
  const concurrency = Math.max(1, options?.concurrency ?? 1);
  const batchSize = resolveBatchSize(input.format);

  let fonts: string[] = [];
  let direction = '';

  const bible: StyleBible = {
    palette: input.brand.colors ?? [],
    fonts: input.brand.primaryFonts ?? [],
    artDirection: '',
  };

  // Slots por índice absoluto: lotes paralelos terminam fora de ordem, mas cada
  // slide é emitido com seu índice (o evento design:slide posiciona por índice).
  const slots: (HtmlDesignSlide | undefined)[] = new Array(total);
  let completed = 0;

  const emitSlide = async (index: number, slide: HtmlDesignSlide) => {
    slots[index] = slide;
    completed++;
    const partial: HtmlDesignContent = {
      kind: 'html-design',
      version: 1,
      width: input.width,
      height: input.height,
      format: input.format,
      fonts: fonts.length ? fonts : ['Inter'],
      // Referência compartilhada (esparsa): o consumidor lê só slides[index].
      slides: slots as HtmlDesignSlide[],
      reasoning: direction || undefined,
    };
    await onSlide?.(partial, index, total, completed);
  };

  const parseBatchSlides = (batchSlides: unknown[], startIndex: number): HtmlDesignSlide[] => {
    const out: HtmlDesignSlide[] = [];
    for (const s of batchSlides) {
      const rec = isRecord(s) ? s : {};
      const html = typeof rec.html === 'string' ? sanitizeSlideHtml(rec.html) : '';
      const css = typeof rec.css === 'string' ? sanitizeSlideCss(rec.css) : undefined;
      if (html.trim()) out.push({ html, css });
    }
    if (out.length === 0) throw new HtmlDesignValidationError(`lote de slides ${startIndex + 1} sem html válido`);
    return out;
  };

  const runBatch = async (startIndex: number, referenceSlides: HtmlDesignSlide[]): Promise<Record<string, unknown>> => {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_BATCH_RETRIES; attempt++) {
      try {
        const raw = await generateText(
          buildBatchSystemInstruction(input, startIndex, total, bible, batchSize),
          buildBatchUserPrompt(input, startIndex, total, bible, referenceSlides, batchSize),
        );
        const parsed = extractJson(raw); // lança se não houver JSON válido
        const rec = isRecord(parsed) ? parsed : {};
        const bs = Array.isArray(rec.slides) ? rec.slides : [];
        if (bs.length === 0) throw new HtmlDesignValidationError(`lote de slides ${startIndex + 1} sem slides gerados`);
        return rec;
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[htmlDesign] lote ${startIndex + 1} falhou (tentativa ${attempt}/${MAX_BATCH_RETRIES}):`, msg);
        if (attempt < MAX_BATCH_RETRIES) await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
    throw lastErr;
  };

  // Slide mínimo, legível e on-brand, para não deixar buraco quando um lote
  // falha mesmo após os retries (num deck de 200, 1 lote azarado não deve matar
  // os outros 199). O id de classe -fallback- permite ao reviewer sinalizá-lo.
  const buildFallbackSlide = (index: number): HtmlDesignSlide => {
    const item = input.skeleton?.[index];
    const bg = input.brand.colors?.[0] || '#111111';
    const fg = pickTextColor(bg);
    const title = item?.title ?? `Slide ${index + 1}`;
    return {
      html: `<div class="s${index + 1}-fallback-wrap"><h1 class="s${index + 1}-fallback-title">${title.replace(/</g, '&lt;')}</h1></div>`,
      css: `.s${index + 1}-fallback-wrap{position:absolute;inset:0;background:${bg};display:flex;align-items:center;justify-content:center;padding:8%;}
.s${index + 1}-fallback-title{color:${fg};font-family:${(fonts[0] ?? 'Inter')},sans-serif;font-size:${Math.round(input.width * 0.05)}px;font-weight:700;text-align:center;}`,
    };
  };

  const processBatch = async (startIndex: number, batchSlides: HtmlDesignSlide[]) => {
    for (let j = 0; j < batchSlides.length && startIndex + j < total; j++) {
      await emitSlide(startIndex + j, batchSlides[j]!);
    }
    // Lote veio curto (modelo devolveu menos slides que o pedido): completa com
    // fallback para não deixar buraco no deck.
    const end = Math.min(startIndex + batchSize, total);
    for (let idx = startIndex + batchSlides.length; idx < end; idx++) {
      await emitSlide(idx, buildFallbackSlide(idx));
    }
  };

  const processFallbackBatch = async (startIndex: number) => {
    const end = Math.min(startIndex + batchSize, total);
    for (let idx = startIndex; idx < end; idx++) {
      await emitSlide(idx, buildFallbackSlide(idx));
    }
  };

  // ── Lote 1: SEQUENCIAL — estabelece o style bible (fontes + direção). ─────────
  // Não é fatal: se falhar após os retries, degradamos para a base da marca +
  // slides de fallback e seguimos. A guarda de "nenhum slide real" no fim ainda
  // marca FAILED se a geração inteira desandar.
  try {
    const firstRec = await runBatch(0, []);
    if (Array.isArray(firstRec.fonts)) fonts = (firstRec.fonts as unknown[]).filter((f): f is string => typeof f === 'string');
    if (typeof firstRec.reasoning === 'string') direction = firstRec.reasoning;
    bible.artDirection = direction;
    if (fonts.length) bible.fonts = fonts;
    await processBatch(0, parseBatchSlides(firstRec.slides as unknown[], 0));
  } catch (e) {
    console.error('[htmlDesign] lote 1 falhou após os retries; degradando para fallback:', e instanceof Error ? e.message : e);
    await processFallbackBatch(0);
  }

  // Os slides do lote 1 viram referência visual para os lotes paralelos.
  const referenceSlides = slots.slice(0, batchSize).filter(Boolean) as HtmlDesignSlide[];

  // ── Lotes restantes: PARALELOS com concorrência limitada. ─────────────────────
  const starts: number[] = [];
  for (let i = batchSize; i < total; i += batchSize) starts.push(i);

  await runPool(starts, concurrency, async (startIndex) => {
    try {
      const rec = await runBatch(startIndex, referenceSlides);
      await processBatch(startIndex, parseBatchSlides(rec.slides as unknown[], startIndex));
    } catch (e) {
      console.error(`[htmlDesign] lote ${startIndex + 1} falhou após os retries; usando fallback:`, e instanceof Error ? e.message : e);
      await processFallbackBatch(startIndex);
    }
  });

  const finalSlides = slots.filter(Boolean) as HtmlDesignSlide[];

  // Guarda: se NADA real foi gerado (todos os lotes caíram no fallback), é falha
  // genuína — melhor marcar FAILED do que entregar um deck só de títulos.
  const realCount = finalSlides.filter((s) => !s.html.includes('-fallback-')).length;
  if (realCount === 0) {
    throw new HtmlDesignValidationError('geração falhou: nenhum slide real gerado (todos os lotes falharam)');
  }

  return {
    kind: 'html-design',
    version: 1,
    width: input.width,
    height: input.height,
    format: input.format,
    fonts: fonts.length ? fonts : ['Inter'],
    slides: finalSlides,
    reasoning: direction || undefined,
  };
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
  /** Elemento selecionado pelo usuário no preview (seletor estilo "inspecionar"):
   *  a instrução deve ser aplicada NELE. Elimina a ambiguidade de "o título" num
   *  slide com três títulos. */
  targetElement?: {
    identifier?: string;
    path?: string;
    text?: string;
    outerHTML?: string;
  };
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
- Não reescreva o slide do zero; edite o que existe.
- NUNCA invente dado factual da empresa (telefone, e-mail, endereço, site, CNPJ) que não esteja nas Diretrizes de Marca abaixo — prefira um CTA genérico a um dado inventado que pareça real.`;

  const guidelinesBlock = input.brand.guidelines
    ? `\nDiretrizes de Marca (Siga-as rigorosamente): ${input.brand.guidelines}`
    : '';
  const agentPromptBlock = input.brand.agentPrompt
    ? `\nInstruções Específicas da Marca: ${input.brand.agentPrompt}`
    : '';

  // Alvo selecionado no preview (inspecionar): tira a ambiguidade de "o título"
  // num slide com três títulos — a instrução se aplica NESTE elemento.
  const t = input.targetElement;
  const targetBlock = t && (t.identifier || t.outerHTML)
    ? `\nELEMENTO ALVO (o usuário CLICOU neste elemento no preview — aplique a instrução NELE, e só nele, salvo menção explícita a outros):
- Identificador: ${t.identifier ?? '—'}
- Caminho no slide: ${t.path ?? '—'}
${t.text ? `- Texto atual: "${t.text}"` : ''}
${t.outerHTML ? `- Trecho exato no HTML:\n${t.outerHTML}` : ''}\n`
    : '';

  const userPrompt = `Marca: ${input.brand.name}
Cores: ${input.brand.colors.join(', ') || 'livre'}
Fontes: ${input.brand.primaryFonts.join(', ') || 'livre'}${guidelinesBlock}${agentPromptBlock}

HTML atual:
${input.slide.html}

CSS atual:
${input.slide.css ?? ''}
${targetBlock}
Instrução do usuário: "${input.instruction}"

Retorne o slide editado (apenas o que mudou aplicado sobre o atual).`;

  const raw = await generateText(systemInstruction, userPrompt);
  const parsed = extractJson(raw);
  const rec = isRecord(parsed) ? parsed : {};
  const html = typeof rec.html === 'string' && rec.html.trim() ? sanitizeSlideHtml(rec.html) : sanitizeSlideHtml(input.slide.html);
  const css = typeof rec.css === 'string' ? sanitizeSlideCss(rec.css) : (input.slide.css ? sanitizeSlideCss(input.slide.css) : undefined);
  return { html, css };
}
