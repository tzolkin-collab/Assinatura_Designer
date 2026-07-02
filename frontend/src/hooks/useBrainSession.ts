'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { SessionPhase, WorkerStatus } from '@/lib/fabricaSession';

export type BrainPhase = SessionPhase;

export interface BrainMessage {
  id: string;
  role: 'user' | 'brain' | 'system' | 'worker-status';
  content: string;
  timestamp: number;
  thinking?: string;
  form?: InlineForm;
  workerProgress?: number;
  auditResult?: AuditResult;
}

export interface InlineForm {
  id: string;
  type: 'choice' | 'confirm' | 'brief-input' | 'priority';
  question: string;
  options?: { id: string; label: string; description?: string }[];
  required: boolean;
}

export interface AuditResult {
  approved: boolean;
  score: number;
  deviations: Array<{
    type: string;
    severity: 'minor' | 'major' | 'critical';
    description: string;
    fix?: string;
  }>;
  feedback: string;
}

export interface StructureTree {
  phase: BrainPhase;
  brief?: {
    objective: string;
    format: string;
    slideCount: number;
    toneAndVoice: string;
    narrativeStructure: string;
    visualDirection: string;
    outlineCount: number;
    qualityCriteria: string[];
  };
  memory?: {
    currentStatus: string;
    recentDecisions: string[];
    formResponses: Record<string, string>;
  };
  worker?: {
    status: WorkerStatus;
    progress: number;
    postId?: string;
  };
  audit?: AuditResult;
}

interface UseBrainSessionOptions {
  brandSlug: string;
  apiBase?: string;
}

export function useBrainSession({ brandSlug, apiBase = '/api' }: UseBrainSessionOptions) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<BrainPhase>('listening');
  const [messages, setMessages] = useState<BrainMessage[]>([]);
  const [structure, setStructure] = useState<StructureTree>({ phase: 'listening' });
  const [pages, setPages] = useState<unknown[]>([]);
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus>('idle');
  const [workerProgress, setWorkerProgress] = useState(0);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sseRef = useRef<EventSource | null>(null);
  const streamingMsgRef = useRef<string | null>(null);
  const thinkingRef = useRef<string>('');
  const eventIndexRef = useRef(0);

  // Cria sessão
  const createSession = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/fabrica/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ brandSlug }),
      });

      if (!res.ok) throw new Error('Falha ao criar sessão');
      const data = (await res.json()) as { sessionId: string; phase: BrainPhase };
      setSessionId(data.sessionId);
      setPhase(data.phase);
      return data.sessionId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(msg);
      return null;
    }
  }, [brandSlug, apiBase]);

  // Conecta SSE
  const connectSSE = useCallback((sid: string) => {
    if (sseRef.current) {
      sseRef.current.close();
    }

    const url = `${apiBase}/fabrica/sessions/${sid}/stream?from=${eventIndexRef.current}`;
    const es = new EventSource(url, { withCredentials: true });

    es.onmessage = (e) => {
      if (e.data === '[DONE]') {
        setIsStreaming(false);
        streamingMsgRef.current = null;
        thinkingRef.current = '';
        return;
      }

      try {
        const event = JSON.parse(e.data) as {
          type: string;
          sessionId: string;
          payload: Record<string, unknown>;
          timestamp: number;
        };

        eventIndexRef.current++;
        handleEvent(event.type, event.payload);
      } catch {}
    };

    es.onerror = () => {
      setIsStreaming(false);
    };

    sseRef.current = es;
  }, [apiBase]);

  function handleEvent(type: string, payload: Record<string, unknown>) {
    switch (type) {
      case 'message': {
        const delta = payload['delta'] as string ?? '';
        const role = payload['role'] as string ?? 'brain';

        if (role === 'brain') {
          setIsStreaming(true);
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'brain' && streamingMsgRef.current === last.id) {
              return prev.map(m =>
                m.id === last.id ? { ...m, content: m.content + delta } : m
              );
            }
            const newId = crypto.randomUUID();
            streamingMsgRef.current = newId;
            return [...prev, { id: newId, role: 'brain', content: delta, timestamp: Date.now() }];
          });
        }
        break;
      }

      case 'thinking': {
        const text = payload['text'] as string ?? '';
        thinkingRef.current = text;
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'brain' && streamingMsgRef.current === last.id) {
            return prev.map(m =>
              m.id === last.id ? { ...m, thinking: text } : m
            );
          }
          return prev;
        });
        break;
      }

      case 'phase-change': {
        const p = payload['phase'] as BrainPhase;
        setPhase(p);
        setStructure(prev => ({ ...prev, phase: p }));
        break;
      }

      case 'form': {
        const form = payload['form'] as InlineForm;
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'brain') {
            return prev.map(m => m.id === last.id ? { ...m, form } : m);
          }
          return [...prev, {
            id: crypto.randomUUID(),
            role: 'brain',
            content: '',
            timestamp: Date.now(),
            form,
          }];
        });
        break;
      }

      case 'worker-started': {
        setWorkerStatus('running');
        setWorkerProgress(0);
        setStructure(prev => ({
          ...prev,
          worker: { status: 'running', progress: 0 },
        }));
        break;
      }

      case 'worker-progress': {
        const progress = payload['progress'] as number ?? 0;
        setWorkerProgress(progress);
        setStructure(prev => ({
          ...prev,
          worker: { ...(prev.worker ?? { status: 'running' }), progress },
        }));
        break;
      }

      case 'worker-done': {
        setWorkerStatus('done');
        setWorkerProgress(100);
        const postId = payload['postId'] as string | undefined;
        if (payload['pages']) setPages(payload['pages'] as unknown[]);
        setStructure(prev => ({
          ...prev,
          worker: { status: 'done', progress: 100, postId },
        }));
        break;
      }

      case 'audit-result': {
        const audit = payload['audit'] as AuditResult;
        setStructure(prev => ({ ...prev, audit }));
        break;
      }

      case 'done': {
        setIsStreaming(false);
        streamingMsgRef.current = null;
        const postId = payload['postId'] as string | undefined;
        if (postId) {
          setStructure(prev => ({
            ...prev,
            worker: { ...(prev.worker ?? { status: 'done', progress: 100 }), postId },
          }));
        }
        break;
      }

      case 'error': {
        const message = payload['message'] as string ?? 'Erro desconhecido';
        setError(message);
        setIsStreaming(false);
        break;
      }
    }
  }

  // Inicializa
  useEffect(() => {
    let mounted = true;

    createSession().then(sid => {
      if (sid && mounted) {
        connectSSE(sid);
      }
    });

    return () => {
      mounted = false;
      sseRef.current?.close();
    };
  }, [createSession, connectSSE]);

  // Envia mensagem
  const sendMessage = useCallback(async (text: string) => {
    if (!sessionId || isStreaming) return;

    const userMsg: BrainMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);

    try {
      await fetch(`${apiBase}/fabrica/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: text }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao enviar';
      setError(msg);
      setIsStreaming(false);
    }
  }, [sessionId, isStreaming, apiBase]);

  // Responde form
  const submitForm = useCallback(async (formId: string, response: string) => {
    if (!sessionId) return;

    await fetch(`${apiBase}/fabrica/sessions/${sessionId}/forms/${formId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ response }),
    });
  }, [sessionId, apiBase]);

  // Dispara worker
  const dispatch = useCallback(async () => {
    if (!sessionId) return;

    await fetch(`${apiBase}/fabrica/sessions/${sessionId}/dispatch`, {
      method: 'POST',
      credentials: 'include',
    });
  }, [sessionId, apiBase]);

  return {
    sessionId,
    phase,
    messages,
    structure,
    pages,
    workerStatus,
    workerProgress,
    isStreaming,
    error,
    sendMessage,
    submitForm,
    dispatch,
  };
}
