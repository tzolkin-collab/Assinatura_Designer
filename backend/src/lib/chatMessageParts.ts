// Monta as partes multimodais de uma mensagem de chat pro Gemini. Extraído do
// brain/index.ts pra ser testável isolado (o arquivo original tem dependências
// pesadas — Redis, WS, filas — que tornam mock-completo frágil pra uma função
// pura como esta).

import type { ChatAttachment } from './redis.js';

export type ModelPart = { text?: string; inlineData?: { mimeType: string; data: string } };

// Antes isto virava só um texto listando nome+mimetype do anexo — o modelo NUNCA
// via o pixel da foto que o usuário mandou, só sabia que um arquivo existia.
// Envia imagens e PDFs reais para o Gemini. O limite acompanha a Fábrica (5 anexos)
// para nenhum arquivo aceito na interface desaparecer antes de chegar ao modelo.
export const MAX_INLINE_ATTACHMENTS_PER_MESSAGE = 5;

export function buildMessageParts(content: string, attachments?: ChatAttachment[]): ModelPart[] {
  const parts: ModelPart[] = [{ text: content }];
  if (!attachments || attachments.length === 0) return parts;

  for (const attachment of attachments.slice(0, MAX_INLINE_ATTACHMENTS_PER_MESSAGE)) {
    const tipo = attachment.mimeType === 'application/pdf' ? 'PDF' : 'imagem';
    parts.push({ text: `[${tipo} anexado pelo usuário: ${attachment.name}]` });
    parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.dataBase64 } });
  }
  return parts;
}
