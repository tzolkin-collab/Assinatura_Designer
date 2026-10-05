// Capa de uma apresentação publicada, para a lista "Apresentações publicadas".
//
// O primeiro slide já tem o documento HTML completo pronto (`Slide.htmlRender`, montado por
// buildSlideDocument, com fontes e dimensões). Usar ele evita puxar o `Post.content`, que nos
// posts antigos carrega TODOS os slides e pesa megabytes. Quem exibe põe o documento num iframe
// isolado (`sandbox`, sem script); ele já foi sanitizado na hora de ser gravado.

export interface PublishedCover {
  html: string;
  width: number;
  height: number;
  /** Primeiro título do slide, para nomear apresentações que nunca receberam nome. */
  title: string | null;
}

// buildSlideDocument escreve exatamente isto; é daí que saem as dimensões.
const SIZE = /html,body\{width:(\d{2,5})px;height:(\d{2,5})px/;

// Teto de sanidade: uma capa gigante inflaria a lista inteira por um detalhe visual.
const MAX_COVER_BYTES = 200_000;

const HEADING = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i;

/** Texto do primeiro título (h1 a h3) do corpo do slide, sem tags, em até 90 caracteres. */
function firstHeading(html: string): string | null {
  const body = html.slice(Math.max(0, html.indexOf('<body')));
  const m = body.match(HEADING);
  if (!m) return null;
  const text = m[1]!
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > 90 ? `${text.slice(0, 89).trimEnd()}…` : text;
}

export function coverFromHtmlRender(htmlRender: string | null | undefined): PublishedCover | null {
  if (!htmlRender || htmlRender.length > MAX_COVER_BYTES) return null;
  const m = htmlRender.match(SIZE);
  if (!m) return null;
  const width = parseInt(m[1]!, 10);
  const height = parseInt(m[2]!, 10);
  if (width < 100 || height < 100) return null;
  return { html: htmlRender, width, height, title: firstHeading(htmlRender) };
}
