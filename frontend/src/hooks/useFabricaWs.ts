'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE } from '@/lib/api';
import type { DesignPage } from '@/components/Fabrica/DesignRenderer';
import type { FabricaQuestion, SessionPhase, WorkerStatus, ReviewMode } from '@/lib/fabricaSession';

export type { SessionPhase, WorkerStatus, ReviewMode };

const WS_BASE = API_BASE.replace(/^http/, 'ws').replace(/\/api$/, '');

export interface FabricaAttachment {
  name: string;
  mimeType: string;
  dataBase64: string;
}

export interface FabricaMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  attachments?: FabricaAttachment[];
  thinking?: string;
}

export interface FabricaNotification {
  kind: 'done' | 'needs_review' | 'error';
  message: string;
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token');
}

function normalizeUiMessage(message: string): string {
  if (!message) return 'Houve uma falha temporária.';
  if (message.includes('high demand') || message.includes('UNAVAILABLE') || message.includes('503')) {
    return 'O modelo está com alta demanda agora. Estou tentando novamente ou trocando para um fallback.';
  }
  if (message.includes('quota') || message.includes('429')) {
    return 'O provedor de IA atingiu um limite temporário. Tente novamente em alguns instantes.';
  }
  return message;
}

export function useFabricaWs(brandSlug: string, initialSessionId?: string | null) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<SessionPhase>('listening');
  const [messages, setMessages] = useState<FabricaMessage[]>([]);
  const [currentDesign, setCurrentDesign] = useState<DesignPage[]>([]);
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [reviewMode, setReviewModeState] = useState<ReviewMode>('auto');
  const [activeQuestion, setActiveQuestion] = useState<FabricaQuestion | null>(null);
  const [notification, setNotification] = useState<FabricaNotification | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [postId, setPostId] = useState<string | undefined>();
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // Put all setters into a ref so connectWs (useCallback with [] deps) always
  // reaches the latest dispatch functions without capturing a stale closure.
  const actionsRef = useRef({
    setIsStreaming,
    setMessages,
    setCurrentDesign,
    setProgress,
    setProgressLabel,
    setWorkerStatus,
    setPostId,
    setNotification,
    setPhase,
    setReviewModeState,
    setActiveQuestion,
    streamingMsgIdRef,
  });

  const handleWsEvent = useCallback((event: Record<string, unknown>) => {
    const type = event.type as string;
    const data = (event.data ?? {}) as Record<string, unknown>;
    const {
      setIsStreaming: setStreaming,
      setMessages: setMsgs,
      setCurrentDesign: setDesign,
      setProgress: setP,
      setProgressLabel: setLabel,
      setWorkerStatus: setWStatus,
      setPostId: setPid,
      setNotification: setNotif,
      setPhase: setPh,
      setReviewModeState: setRm,
      setActiveQuestion: setQuestion,
    } = actionsRef.current;

    switch (type) {
      case 'agent:end': {
        setStreaming(false);
        actionsRef.current.streamingMsgIdRef.current = null;
        break;
      }

      case 'agent:token': {
        const text = (data.token ?? '') as string;
        setStreaming(true);
        setMsgs(prev => {
          const last = prev[prev.length - 1];
          const sid = actionsRef.current.streamingMsgIdRef.current;
          if (last?.role === 'assistant' && last.id === sid) {
            return prev.map(m => m.id === last.id ? { ...m, content: m.content + text } : m);
          }
          const id = crypto.randomUUID();
          actionsRef.current.streamingMsgIdRef.current = id;
          return [...prev, { id, role: 'assistant', content: text, timestamp: Date.now() }];
        });
        break;
      }

      case 'thinking': {
        const text = (data.text ?? '') as string;
        setMsgs(prev => {
          const last = prev[prev.length - 1];
          const sid = actionsRef.current.streamingMsgIdRef.current;
          if (last?.role === 'assistant' && last.id === sid) {
            return prev.map(m => m.id === last.id ? { ...m, thinking: text } : m);
          }
          return prev;
        });
        break;
      }

      case 'design:update': {
        setDesign((data.pages ?? []) as DesignPage[]);
        break;
      }

      case 'job:progress': {
        setP((data.percent ?? 0) as number);
        setLabel((data.label ?? '') as string);
        setWStatus('running');
        break;
      }

      case 'job:done': {
        const pid = data.postId as string | undefined;
        if (pid) setPid(pid);
        setWStatus('done');
        setP(100);
        setStreaming(false);
        actionsRef.current.streamingMsgIdRef.current = null;
        break;
      }

      case 'job:error': {
        const errMsg = normalizeUiMessage((data.message ?? 'Erro na geração') as string);
        setWStatus('error');
        setStreaming(false);
        actionsRef.current.streamingMsgIdRef.current = null;
        setMsgs(prev => [
          ...prev,
          { id: crypto.randomUUID(), role: 'system', content: errMsg, timestamp: Date.now() },
        ]);
        break;
      }

      case 'notification': {
        setNotif({
          kind: (data.kind as FabricaNotification['kind']) ?? 'done',
          message: (data.message as string) ?? '',
        });
        setStreaming(false);
        actionsRef.current.streamingMsgIdRef.current = null;
        break;
      }

      case 'session:state': {
        const p = data.phase as SessionPhase | undefined;
        const d = (data.currentDesign ?? []) as DesignPage[];
        const rm = data.reviewMode as ReviewMode | undefined;
        const question = (data.activeQuestion ?? null) as FabricaQuestion | null;
        const msgs = (data.messages ?? []) as Array<{
          role: string; content: string; timestamp: number; attachments?: FabricaAttachment[];
        }>;
        if (p) setPh(p);
        if (d.length > 0) setDesign(d);
        if (rm) setRm(rm);
        setQuestion(question);
        setMsgs(
          msgs
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => ({
              id: crypto.randomUUID(),
              role: m.role as 'user' | 'assistant',
              content: m.content,
              timestamp: m.timestamp,
              attachments: m.attachments,
            })),
        );
        break;
      }

      case 'error': {
        const msg = normalizeUiMessage((data.message ?? 'Erro desconhecido') as string);
        setMsgs(prev => [
          ...prev,
          { id: crypto.randomUUID(), role: 'system', content: msg, timestamp: Date.now() },
        ]);
        setStreaming(false);
        actionsRef.current.streamingMsgIdRef.current = null;
        break;
      }
    }
  }, []); // stable: only reads from actionsRef (a ref, never stale)

  const connectWs = useCallback((sid: string, rehydrate = false) => {
    if (typeof window === 'undefined') return;

    const token = getToken();
    if (!token) return;

    wsRef.current?.close();

    const url = `${WS_BASE}/ws?token=${encodeURIComponent(token)}&sessionId=${encodeURIComponent(sid)}`;
    const socket = new WebSocket(url);

    socket.onopen = () => {
      setConnected(true);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (rehydrate) {
        fetch(`${API_BASE}/fabrica/sessions/${encodeURIComponent(sid)}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
    };

    socket.onclose = () => {
      setConnected(false);
      actionsRef.current.setIsStreaming(false);
      if (sessionIdRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          if (sessionIdRef.current) connectWs(sessionIdRef.current);
        }, 2000);
      }
    };

    socket.onerror = () => {
      setConnected(false);
      actionsRef.current.setIsStreaming(false);
    };

    socket.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as Record<string, unknown>;
        handleWsEvent(event);
      } catch {}
    };

    wsRef.current = socket;
  }, [handleWsEvent]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    let cancelled = false;

    if (initialSessionId) {
      sessionIdRef.current = initialSessionId;
      setSessionId(initialSessionId);
      connectWs(initialSessionId, true);
      return () => {
        cancelled = true;
        sessionIdRef.current = null;
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        wsRef.current?.close();
        wsRef.current = null;
      };
    }
    
    fetch(`${API_BASE}/fabrica/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ brandSlug }),
    })
      .then(r => r.json())
      .then((d: { sessionId?: string }) => {
        if (cancelled || !d.sessionId) return;
        sessionIdRef.current = d.sessionId;
        setSessionId(d.sessionId);
        connectWs(d.sessionId);
      })
      .catch(err => console.error('[useFabricaWs] session create failed:', err));

    return () => {
      cancelled = true;
      sessionIdRef.current = null;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [brandSlug, connectWs, initialSessionId]);

  const send = useCallback((type: string, data?: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data }));
    }
  }, []);

  const sendMessage = useCallback((content: string, attachments?: FabricaAttachment[]) => {
    const id = crypto.randomUUID();
    setMessages(prev => [...prev, { id, role: 'user', content, timestamp: Date.now(), attachments }]);
    setActiveQuestion(null);
    setIsStreaming(true);
    send('message', { content, attachments });
  }, [send]);

  const answerQuestion = useCallback((payload: {
    optionLabel?: string;
    freeform?: string;
    skipped?: boolean;
    attachments?: FabricaAttachment[];
  }) => {
    const preview = payload.skipped
      ? 'Pode pular e decidir no modo automático.'
      : payload.freeform?.trim() || payload.optionLabel?.trim();
    if (!preview) return;

    const id = crypto.randomUUID();
    setMessages(prev => [...prev, { id, role: 'user', content: preview, timestamp: Date.now(), attachments: payload.attachments }]);
    setActiveQuestion(null);
    setIsStreaming(true);
    send('question:answer', payload as unknown as Record<string, unknown>);
  }, [send]);

  const approve = useCallback(() => send('review:approve'), [send]);

  const decline = useCallback(
    (reason?: string) => send('review:decline', reason ? { reason } : {}),
    [send],
  );

  const setReviewMode = useCallback((mode: ReviewMode) => {
    setReviewModeState(mode);
    send('mode:set', { mode });
  }, [send]);

  return {
    sessionId,
    phase,
    messages,
    currentDesign,
    workerStatus,
    progress,
    progressLabel,
    reviewMode,
    activeQuestion,
    notification,
    isStreaming,
    postId,
    connected,
    sendMessage,
    answerQuestion,
    approve,
    decline,
    setReviewMode,
    clearNotification: () => setNotification(null),
  };
}
