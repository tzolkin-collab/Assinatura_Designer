// Parse/strip da tag [DISPATCH:...] que o brain usa pra disparar geração do zero.
// Extraído do brain/index.ts pra ser testável isolado (o arquivo original tem
// dependências pesadas — Redis, WS, filas — que tornam mock-completo frágil pra
// uma função pura como esta).

const ASPECT_TOKENS = ['1x1', '4x5', '3x4', '9x16', '16x9'] as const;
const DISPATCH_TAG_SOURCE = String.raw`\[DISPATCH:([^\]]+)\]`;

export interface ParsedDispatchTag {
  format: 'presentation' | 'carousel';
  isProof: boolean;
  aspectRatio?: string;
  imagePreference?: 'force-ai' | 'unsplash' | 'unsplash-remix';
}

function parseAspectRatio(token?: string): string | undefined {
  if (!token || !(ASPECT_TOKENS as readonly string[]).includes(token)) return undefined;
  return token.replace('x', ':');
}

export function parseDispatchTag(response: string): ParsedDispatchTag | null {
  const match = response.match(new RegExp(DISPATCH_TAG_SOURCE, 'i'));
  if (!match) return null;
  
  const parts = match[1].toLowerCase().split(':');
  const formatToken = parts[0];
  if (formatToken !== 'presentation' && formatToken !== 'carousel') return null;

  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (p !== 'proof' && p !== 'force-ai' && p !== 'unsplash' && p !== 'unsplash-remix' && !(ASPECT_TOKENS as readonly string[]).includes(p)) {
      return null;
    }
  }

  const isProof = parts.includes('proof');
  const aspectRatioToken = parts.find(p => (ASPECT_TOKENS as readonly string[]).includes(p));
  const imagePreference = parts.find(p => p === 'force-ai' || p === 'unsplash' || p === 'unsplash-remix') as 'force-ai' | 'unsplash' | 'unsplash-remix' | undefined;

  return {
    format: formatToken,
    isProof,
    aspectRatio: parseAspectRatio(aspectRatioToken),
    imagePreference,
  };
}

export function stripDispatchTag(content: string): string {
  return content.replace(new RegExp(DISPATCH_TAG_SOURCE, 'gi'), '');
}
