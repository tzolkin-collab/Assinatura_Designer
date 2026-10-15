/**
 * Contrato de saída que o AGENTE (ChatGPT, Claude, Gemini...) precisa respeitar ao escrever os slides.
 * É o mesmo contrato mecânico que o artista interno do Designer recebe (lib/htmlDesign.ts): formato,
 * container, CSS, fontes e espaço de foto. As regras de MARCA (fidelidade, identidade, proibições)
 * vêm do cérebro e entram em `rules` no brief; aqui só a mecânica.
 */

export const HTML_OUTPUT_CONTRACT = `CONTRATO DO HTML (mecânica de saída):
- Cada slide é um objeto { html, css }. O "html" é o CONTEÚDO INTERNO de um container chamado .slide-root,
  que já existe, com o tamanho do canvas (width x height do brief) e position:relative. Não escreva
  <html>, <head>, <body> nem o próprio .slide-root.
- Coloque o CSS no campo "css" (sem a tag <style>). Prefixe TODAS as classes com o índice do slide
  (s1-, s2-, s3-...) para não colidir entre slides.
- Layout livre com flexbox, grid e position:absolute. Padding generoso, respiro, alinhamento exato.
- Proibido: <script>, <iframe>, <object>, <embed>, <link>, <meta>, <base>, <form>, @import, expression(),
  javascript:. O que for proibido é removido na entrada.
- Imagens: <img src> só com URLs https da lista "assets" do brief (arquivos reais da marca) ou o logo.
  Nunca invente URL, nunca use banco de imagem. Sem texto embutido em imagem.
- Desenho vetorial (diagrama, gráfico, filete) em <svg> INLINE com viewBox. Não tente desenhar letra,
  logotipo ou figura realista em SVG.
- Fontes: use as famílias do brief. As próprias da marca já vêm com @font-face (use os pesos listados);
  as do Google entram pelo campo "fonts" do save_presentation (nome da família, sem a especificação da API).
- Contraste legível: fundo escuro, texto claro; fundo claro, texto escuro. Sobre imagem, faixa sólida
  atrás do texto. Não coloque cor de texto com contraste baixo sobre a cor de fundo.
- Marque o que é editável com data-editable="true" e data-role="headline|subtitle|body|cta|image".
- Texto: SOMENTE o texto aprovado do slide. Quebrar, reorganizar e mudar o tamanho é livre; trocar,
  resumir, acrescentar ou omitir palavra não é. Numeração, legendas e rótulos que não estão no texto
  aprovado também são texto acrescentado.`;

export const DESIGNER_WORKFLOW_CHECKLIST: readonly string[] = [
  'Li as regras da marca (rules) e respeitei proibições e identidade.',
  'Cada slide usa só o texto aprovado, palavra por palavra (acentos e pontuação inclusos).',
  'Nenhuma pessoa, rosto ou foto foi gerada; onde faltou foto real há uma área data-photo-slot vazia.',
  'Só usei imagens da lista de assets do brief.',
  'As composições variam entre slides consecutivos (divisão, posição do título, recurso gráfico).',
  'Contraste de texto verificado em cada fundo; nada de texto sobre rosto.',
  'Classes CSS prefixadas por slide (s1-, s2-...).',
];
