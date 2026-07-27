// Hospedagem pública de apresentações (Fase 5, Fatia 1 — navegação). Autenticado
// (publicar/despublicar) usa `api` normal; a leitura pública (usada pela própria
// página /apresentacao/[slug]) vai com `requireAuth: false` — mesmo padrão do
// aceite de convite (frontend/src/app/convite/[token]/page.tsx).

import { api } from './api';

export interface HostingConfig {
  autoplay?: boolean;
  showCounter?: boolean;
}

export interface PublishResult {
  publicSlug: string;
  publishedAt: string;
  path: string;
}

export interface PublicPresentation {
  name: string | null;
  content: unknown;
  hostingConfig: HostingConfig;
  /** true quando quem abriu o link já está logado como membro da marca dona
   *  deste post — é assim que o mesmo link vira "tela do palestrante" pra
   *  quem publicou, sem precisar de um segundo link/token. */
  isOwner: boolean;
  /** Só vem preenchido quando isOwner — necessário pra chamar o toggle do chat. */
  postId?: string;
  chat: { enabled: boolean };
}

export interface PresentationChatMessage {
  id: string;
  text: string;
  createdAt: number;
}

export interface PresentationChatState {
  enabled: boolean;
  /** Só vem preenchida pro dono autenticado — a plateia nunca vê as perguntas dos outros. */
  messages: PresentationChatMessage[];
}

export function publishPost(postId: string, hostingConfig: HostingConfig): Promise<PublishResult> {
  return api.post<PublishResult>(`/posts/${postId}/publish`, { hostingConfig });
}

export function unpublishPost(postId: string): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>(`/posts/${postId}/unpublish`, {});
}

export function fetchPublicPresentation(slug: string): Promise<PublicPresentation> {
  // 'optional': anônimo continua funcionando igual; se o DESIGNER já estiver
  // logado no app quando abre o próprio link (pra apresentar), o servidor
  // reconhece e libera os controles extra — ver isOwner acima.
  return api.get<PublicPresentation>(`/public/presentations/${slug}`, { requireAuth: 'optional' });
}

export function fetchPresentationChat(slug: string): Promise<PresentationChatState> {
  return api.get<PresentationChatState>(`/public/presentations/${slug}/chat`, { requireAuth: 'optional' });
}

/** A plateia manda a pergunta — nunca exige login, mesmo se o navegador tiver um token de outra conta. */
export function submitPresentationQuestion(slug: string, text: string): Promise<{ message: PresentationChatMessage | null }> {
  return api.post(`/public/presentations/${slug}/chat`, { text }, { requireAuth: false });
}

/** Só o palestrante (dono) chama isso — liga/desliga a caixa de perguntas ao vivo. */
export function togglePresentationChat(postId: string, enabled: boolean): Promise<{ enabled: boolean }> {
  return api.post<{ enabled: boolean }>(`/posts/${postId}/chat/toggle`, { enabled });
}
