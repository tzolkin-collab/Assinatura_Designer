import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import type { DesignPage } from './designTypes.js';
import { publish, sessionChannel, onEvent, subscribe, initEventBus, type BusEvent } from './eventBus.js';
import { logger } from './logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type WsEventType =
  | 'agent:token'
  | 'agent:end'
  | 'agent:tool_call'
  | 'agent:tool_result'
  | 'design:update'
  | 'design:slide'
  | 'job:progress'
  | 'job:done'
  | 'job:error'
  | 'notification'
  | 'session:state'
  | 'thinking'
  | 'error';

export interface WsEvent {
  type: WsEventType;
  data: unknown;
}

export type WsInboundType =
  | 'message'
  | 'question:answer'
  | 'review:approve'
  | 'review:decline'
  | 'mode:set'
  | 'generation:cancel';

export interface WsAttachment {
  name: string;
  mimeType: string;
  dataBase64: string;
}

export interface WsInbound {
  type: WsInboundType;
  data?: unknown;
}

// Notification card (canto inferior direito, estilo code AI tools)
export interface NotificationPayload {
  kind: 'done' | 'needs_review' | 'error';
  message: string;
  sessionId: string;
}

// ── Connection store ──────────────────────────────────────────────────────────

interface ClientMeta {
  ws: WebSocket;
  userId?: string;
  sessionId: string;
}

const sessionClients = new Map<string, Set<ClientMeta>>();

function register(meta: ClientMeta) {
  if (!sessionClients.has(meta.sessionId)) sessionClients.set(meta.sessionId, new Set());
  sessionClients.get(meta.sessionId)!.add(meta);
}

function unregister(meta: ClientMeta) {
  const set = sessionClients.get(meta.sessionId);
  if (!set) return;
  set.delete(meta);
  if (set.size === 0) sessionClients.delete(meta.sessionId);
}

// ── Message handlers (plugado pelo Brain agent) ───────────────────────────────

type MessageHandler = (sessionId: string, userId: string | undefined, data: unknown) => Promise<void>;

const handlers = new Map<WsInboundType, MessageHandler>();

export function onWsMessage(type: WsInboundType, handler: MessageHandler) {
  handlers.set(type, handler);
}

// ── Distribuição local de eventos do EventBus para WS ─────────────────────────
//
// O EventBus entrega eventos de QUALQUER processo via Redis Pub/Sub. Este
// listener pega cada evento e distribui para os clientes WS deste processo.
// Antes, `broadcast()` era a única forma de alcançar os clientes — agora ela
// publica no EventBus, e o subscriber local é quem entrega para o WS.

function deliverToLocalClients(sessionId: string, event: WsEvent): void {
  const clients = sessionClients.get(sessionId);
  if (!clients) return;
  const data = JSON.stringify(event);
  for (const { ws: socket } of clients) {
    if (socket.readyState === WebSocket.OPEN) socket.send(data);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

export async function initWebSocket(server: Server): Promise<WebSocketServer> {
  // Inicializa o EventBus e subscreve ao pattern de sessões.
  // O subscriber recebe eventos de TODOS os processos (API + workers) e entrega
  // para os clientes WS conectados a ESTE processo.
  await initEventBus();
  await subscribe('session:*');

  onEvent((channel, event) => {
    // channel = "session:<sessionId>"
    const prefix = 'session:';
    if (!channel.startsWith(prefix)) return;
    const sessionId = channel.slice(prefix.length);
    deliverToLocalClients(sessionId, event as WsEvent);
  });

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    // Aceita o subprotocolo "bearer" (o token vem junto no header). Selecionar um
    // protocolo faz o handshake devolver o header e o cliente ficar satisfeito.
    handleProtocols: (protocols) => (protocols.has('bearer') ? 'bearer' : false),
  });

  wss.on('connection', (wsConn: WebSocket, req) => {
    const url = new URL(req.url ?? '/', `http://localhost`);
    const sessionId = url.searchParams.get('sessionId');

    // Token via Sec-WebSocket-Protocol ("bearer, <jwt>") em vez do query string,
    // que pode acabar em logs de proxy/servidor.
    const protoHeader = (req.headers['sec-websocket-protocol'] ?? '') as string;
    const token = protoHeader.split(',').map((s) => s.trim()).find((p) => p && p !== 'bearer') ?? null;

    if (!token || !sessionId) {
      wsConn.close(1008, 'Missing token or sessionId');
      return;
    }

    let userId: string | undefined;
    try {
      const payload = jwt.verify(token, config.jwtSecret) as { userId: string };
      userId = payload.userId;
    } catch {
      wsConn.close(1008, 'Invalid token');
      return;
    }

    const meta: ClientMeta = { ws: wsConn, userId, sessionId };
    register(meta);

    wsConn.on('message', async (raw) => {
      let msg: WsInbound;
      try {
        msg = JSON.parse(raw.toString()) as WsInbound;
      } catch {
        return;
      }
      const handler = handlers.get(msg.type);
      if (handler) await handler(sessionId, userId, msg.data).catch((e) =>
        logger.error('[WS handler error]', { type: msg.type, error: (e as Error).message }),
      );
    });

    wsConn.on('close', () => unregister(meta));
    wsConn.on('error', (err) => logger.error('[WS client error]', { error: err.message }));
  });

  wss.on('error', (err) => logger.error('[WS server error]', { error: err.message }));
  return wss;
}

// ── Broadcast helpers ─────────────────────────────────────────────────────────
//
// A API pública (`ws.*`) NÃO MUDA — callers continuam usando `ws.token(sessionId, ...)`
// como antes. A diferença: agora `broadcast()` publica no EventBus via Redis,
// e o subscriber local distribui para os clientes WS deste processo. Isso
// significa que um worker em processo separado chamando `ws.progress(...)` agora
// funciona — o evento viaja pelo Redis até o processo da API que tem os WS.

export function broadcast(sessionId: string, event: WsEvent): void {
  publish(sessionChannel(sessionId), event as BusEvent);
}

export const ws = {
  emit: (sessionId: string, type: WsEventType, data: unknown) =>
    broadcast(sessionId, { type, data }),

  token: (sessionId: string, token: string) =>
    broadcast(sessionId, { type: 'agent:token', data: { token } }),

  end: (sessionId: string) =>
    broadcast(sessionId, { type: 'agent:end', data: {} }),

  toolCall: (sessionId: string, name: string, args: object) =>
    broadcast(sessionId, { type: 'agent:tool_call', data: { name, args } }),

  toolResult: (sessionId: string, name: string, result: unknown) =>
    broadcast(sessionId, { type: 'agent:tool_result', data: { name, result } }),

  designUpdate: (sessionId: string, pages: DesignPage[]) =>
    broadcast(sessionId, { type: 'design:update', data: { pages } }),

  // Delta de UM slide durante a geração progressiva. Evita o O(n²) de reenviar o
  // design inteiro a cada slide: manda só o slide novo + o envelope leve (sem o
  // array de slides). O front reconstrói o mesmo envelope acumulando os deltas.
  designSlide: (
    sessionId: string,
    payload: { index: number; total: number; slide: unknown; envelope: unknown },
  ) => broadcast(sessionId, { type: 'design:slide', data: payload }),

  progress: (sessionId: string, percent: number, label: string) =>
    broadcast(sessionId, { type: 'job:progress', data: { percent, label } }),

  done: (sessionId: string, postId: string) =>
    broadcast(sessionId, { type: 'job:done', data: { postId } }),

  error: (sessionId: string, message: string) =>
    broadcast(sessionId, { type: 'job:error', data: { message } }),

  notify: (sessionId: string, payload: NotificationPayload) =>
    broadcast(sessionId, { type: 'notification', data: payload }),

  sessionState: (sessionId: string, state: unknown) =>
    broadcast(sessionId, { type: 'session:state', data: state }),
};
