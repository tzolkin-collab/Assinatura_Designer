// Monta as partes multimodais de uma mensagem de chat pro Gemini. Extraído do
// brain/index.ts pra ser testável isolado (o arquivo original tem dependências
// pesadas — Redis, WS, filas — que tornam mock-completo frágil pra uma função
// pura como esta).

import type { ChatAttachment } from './redis.js';

export type ModelPart = { text?: string; inlineData?: { mimeType: string; data: string } };

// Antes isto virava só um texto listando nome+mimetype do anexo — o modelo NUNCA
// via o pixel da foto que o usuário mandou, só sabia que um arquivo existia.
// Agora manda a imagem de verdade como inlineData (capado em 4 por mensagem —
// múltiplas fotos grandes por turno estouram o payload à toa).
export const MAX_INLINE_IMAGES_PER_MESSAGE = 4;

export function buildMessageParts(content: string, attachments?: ChatAttachment[]): ModelPart[] {
  const parts: ModelPart[] = [{ text: content }];
  if (!attachments || attachments.length === 0) return parts;

  for (const attachment of attachments.slice(0, MAX_INLINE_IMAGES_PER_MESSAGE)) {
    parts.push({ text: `[Imagem anexada pelo usuário: ${attachment.name}]` });
    parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.dataBase64 } });
  }
  return parts;
}
