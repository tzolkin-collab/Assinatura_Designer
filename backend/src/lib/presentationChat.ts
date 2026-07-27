// Perguntas da plateia numa apresentação hospedada — ao vivo, não histórico
// permanente: existe enquanto a sessão de apresentação dura (TTL no Redis),
// some sozinho depois. O palestrante liga/desliga; a plateia só escreve, nunca
// lê as perguntas dos outros (evita expor conteúdo anônimo de um visitante pro
// outro, e simplifica — é uma caixa de perguntas, não uma sala de chat).

import crypto from 'crypto';
import { redis } from './redis.js';

const MAX_MESSAGES = 200;
const TTL_SECONDS = 60 * 60 * 24; // 24h — cobre uma apresentação ao vivo com folga
const MAX_MESSAGE_LENGTH = 500;

export interface PresentationChatMessage {
  id: string;
  text: string;
  createdAt: number;
}

const enabledKey = (slug: string) => `presentation:chat:${slug}:enabled`;
const messagesKey = (slug: string) => `presentation:chat:${slug}:messages`;

export async function isChatEnabled(slug: string): Promise<boolean> {
  const val = await redis.get(enabledKey(slug));
  return val === '1';
}

export async function setChatEnabled(slug: string, enabled: boolean): Promise<void> {
  if (enabled) {
    await redis.set(enabledKey(slug), '1', 'EX', TTL_SECONDS);
  } else {
    await redis.del(enabledKey(slug));
  }
}

export async function addChatMessage(slug: string, text: string): Promise<PresentationChatMessage | null> {
  const trimmed = text.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!trimmed) return null;

  const message: PresentationChatMessage = { id: crypto.randomUUID(), text: trimmed, createdAt: Date.now() };
  const key = messagesKey(slug);
  await redis.rpush(key, JSON.stringify(message));
  // Teto de tamanho — uma apresentação lotada não deve crescer a lista pra sempre.
  await redis.ltrim(key, -MAX_MESSAGES, -1);
  await redis.expire(key, TTL_SECONDS);
  return message;
}

export async function getChatMessages(slug: string): Promise<PresentationChatMessage[]> {
  const raw = await redis.lrange(messagesKey(slug), 0, -1);
  return raw
    .map((item) => {
      try { return JSON.parse(item) as PresentationChatMessage; } catch { return null; }
    })
    .filter((m): m is PresentationChatMessage => !!m);
}

/** Limpa tudo — chamado ao despublicar (o slug antigo nunca mais é acessível mesmo). */
export async function clearChat(slug: string): Promise<void> {
  await Promise.all([redis.del(enabledKey(slug)), redis.del(messagesKey(slug))]);
}
