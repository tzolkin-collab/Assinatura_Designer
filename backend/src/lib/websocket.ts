import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import type { DesignPage } from './designTypes.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type WsEventType =
  | 'agent:token'
  | 'agent:end'
  | 'agent:tool_call'
  | 'agent:tool_result'
  | 'design:update'
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
  | 'mode:set';

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

// ── Init ──────────────────────────────────────────────────────────────────────

export function initWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url ?? '/', `http://localhost`);
    const token = url.searchParams.get('token');
    const sessionId = url.searchParams.get('sessionId');

    if (!token || !sessionId) {
      ws.close(1008, 'Missing token or sessionId');
      return;
    }

    let userId: string | undefined;
    try {
      const payload = jwt.verify(token, config.jwtSecret) as { userId: string };
      userId = payload.userId;
    } catch {
      ws.close(1008, 'Invalid token');
      return;
    }

    const meta: ClientMeta = { ws, userId, sessionId };
    register(meta);

    ws.on('message', async (raw) => {
      let msg: WsInbound;
      try {
        msg = JSON.parse(raw.toString()) as WsInbound;
      } catch {
        return;
      }
      const handler = handlers.get(msg.type);
      if (handler) await handler(sessionId, userId, msg.data).catch(console.error);
    });

    ws.on('close', () => unregister(meta));
    ws.on('error', (err) => console.error('[WS client error]', err.message));
  });

  wss.on('error', (err) => console.error('[WS server error]', err.message));
  return wss;
}

// ── Broadcast helpers ─────────────────────────────────────────────────────────

export function broadcast(sessionId: string, event: WsEvent): void {
  const clients = sessionClients.get(sessionId);
  if (!clients) return;
  const data = JSON.stringify(event);
  for (const { ws } of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
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
