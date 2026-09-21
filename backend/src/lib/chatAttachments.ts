import { uploadFileToR2 } from './r2.js';
import { prepareStorableFile } from './svgSanitize.js';
import { logger } from './logger.js';
import type { ChatAttachment } from './redis.js';

/**
 * Sobe cada foto anexada no chat pro R2 assim que chega — antes ela só existia como
 * base64 dentro da mensagem: o cérebro via só o NOME do arquivo em texto (nunca o
 * pixel), e a geração nunca tinha como usá-la (nenhuma URL real pra embutir num
 * <img>). Com a URL em mãos, os dois casos passam a funcionar de verdade.
 *
 * O mimeType vem do WebSocket (`startsWith('image/')` deixa passar image/svg+xml), então
 * o SVG é higienizado aqui antes de gravar. Falha (inclusive SVG inválido) não derruba a
 * mensagem: o anexo segue só com o base64, sem `url`. Muta `attachments` (preenche `url`).
 */
export async function uploadChatAttachments(attachments: ChatAttachment[], brandSlug: string): Promise<void> {
  await Promise.all(attachments.map(async (a) => {
    try {
      const buffer = Buffer.from(a.dataBase64, 'base64');
      const prepared = prepareStorableFile({ buffer, fileName: a.name, mimeType: a.mimeType });
      a.url = await uploadFileToR2(prepared.buffer, a.name, prepared.mimeType, `brands/${brandSlug}/chat-attachments`);
    } catch (err) {
      logger.warn('Falha ao subir anexo do chat pro R2 — segue só com o base64 (sem URL pra geração)', { error: (err as Error).message });
    }
  }));
}
