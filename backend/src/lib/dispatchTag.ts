// Parse/strip da tag [DISPATCH:...] que o brain usa pra disparar geração do zero.
// Extraído do brain/index.ts pra ser testável isolado (o arquivo original tem
// dependências pesadas — Redis, WS, filas — que tornam mock-completo frágil pra
// uma função pura como esta).

// Terceiro segmento da tag é OU "proof" OU uma proporção (retrato/story pro Design
// — apresentação sempre ignora e fica 16:9). "x" em vez de ":" no segmento de
// proporção pra não colidir com o separador dos segmentos da própria tag.
const ASPECT_TOKENS = ['1x1', '4x5', '3x4', '9x16', '16x9'] as const;
const DISPATCH_TAG_SOURCE = String.raw`\[DISPATCH:(presentation|carousel)(?::(proof|1x1|4x5|3x4|9x16|16x9))?\]`;

export interface ParsedDispatchTag {
  format: 'presentation' | 'carousel';
  isProof: boolean;
  aspectRatio?: string;
}

function parseAspectRatio(token?: string): string | undefined {
  if (!token || !(ASPECT_TOKENS as readonly string[]).includes(token)) return undefined;
  return token.replace('x', ':');
}

export function parseDispatchTag(response: string): ParsedDispatchTag | null {
  const match = response.match(new RegExp(DISPATCH_TAG_SOURCE, 'i'));
  if (!match) return null;
  return {
    format: match[1] as 'presentation' | 'carousel',
    isProof: match[2]?.toLowerCase() === 'proof',
    aspectRatio: parseAspectRatio(match[2]),
  };
}

export function stripDispatchTag(content: string): string {
  return content.replace(new RegExp(DISPATCH_TAG_SOURCE, 'gi'), '');
}
