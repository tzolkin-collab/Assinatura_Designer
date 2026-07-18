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
  // Conta sem crédito TAMBÉM chega como 429 — e o backend já explica isso direito. Sem
  // esta guarda, as regras abaixo reescreviam a verdade ("sem créditos, recarregue")
  // como "limite temporário, tente de novo" e mandavam o usuário insistir para sempre.
  if (/cr[ée]dito/i.test(message)) return message;
  if (message.includes('high demand') || message.includes('UNAVAILABLE') || message.includes('503')) {
    return 'O modelo está com alta demanda agora. Estou tentando novamente ou trocando para um fallback.';
  }
  if (message.includes('quota') || message.includes('429')) {
    return 'O provedor de IA atingiu um limite temporário. Tente novamente em alguns instantes.';
  }
  return message;
}

export function useFabricaWs(brandSlug: string, initialSessionId?: string | null) {
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null);
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

  // Se o initialSessionId mudar (ex: navegação via link de reabrir conversa na galeria),
  // atualizamos o estado interno e limpamos mensagens/design anteriores para não exibir dados antigos (stale).
  useEffect(() => {
    if (initialSessionId) {
      setSessionId(initialSessionId);
      setMessages([]);
      setCurrentDesign([]);
      setPhase('listening');
      setWorkerStatus('idle');
      setProgress(0);
      setProgressLabel('');
      setActiveQuestion(null);
      setPostId(undefined);
    }
  }, [initialSessionId]);

  const wsRef = useRef<WebSocket | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  // Ref para o próprio connectWs — o reconnect no onclose o chama sem referenciar
  // a const antes de ela ser atribuída (evita o warning e a captura de stale).
  const connectWsRef = useRef<((sid: string, rehydrate?: boolean) => void) | null>(null);

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
        const pages = (data.pages ?? []) as DesignPage[];
        setDesign(pages);
        // Mesmo motivo do session:state: o envelope final traz o postId.
        const envPid = (pages[0] as { postId?: string } | undefined)?.postId;
        if (envPid) setPid(envPid);
        break;
      }

      // Delta de um slide (geração progressiva). Acumula sobre o envelope já
      // recebido, reconstruindo o mesmo shape [envelope] que o design:update
      // final entrega — sem receber o design inteiro a cada slide. Dual-formato:
      // html-design guarda os slides no topo do envelope; ir-design em ir.slides.
      case 'design:slide': {
        const { index, slide, envelope } = data as {
          index: number;
          slide: unknown;
          envelope: { kind?: string; postId?: string; ir?: { slides?: unknown[] }; slides?: unknown[] } & Record<string, unknown>;
        };
        // O postId chega no envelope do PRIMEIRO slide, e o `job:done` só viria no
        // fim. Publicá-lo aqui é o que deixa o artefato baixável DURANTE a geração:
        // o slide já está persistido no banco no instante em que aparece na tela.
        if (envelope.postId) setPid(envelope.postId);
        setDesign(prev => {
          const prevEnv = (prev[0] as (Record<string, unknown> & { kind?: string; postId?: string; ir?: { slides?: unknown[] }; slides?: unknown[] }) | undefined);
          const kind = envelope.kind ?? prevEnv?.kind;
          const isHtml = kind === 'html-design';
          // Novo deck: se a arte anterior é de outra geração (postId diferente) ou
          // de outro formato, NÃO herdamos os slides dela — senão sobra lixo do
          // deck antigo quando o novo tem menos slides.
          const incomingId = envelope.postId;
          const isNewDeck = incomingId != null && prevEnv?.postId != null && incomingId !== prevEnv.postId;
          const accumulate = prevEnv?.kind === kind && !isNewDeck;

          if (isHtml) {
            const baseSlides = accumulate && Array.isArray(prevEnv?.slides) ? prevEnv!.slides!.slice() : [];
            baseSlides[index] = slide;
            const merged = {
              ...(accumulate ? prevEnv : envelope),
              ...envelope,
              slides: baseSlides,
            };
            return [merged as unknown as DesignPage];
          }

          // ir-design (decks legados) e formatos desconhecidos: acúmulo em ir.slides.
          const canAccumulateIr = kind === 'ir-design' && accumulate;
          const baseSlides = canAccumulateIr && Array.isArray(prevEnv?.ir?.slides) ? prevEnv!.ir!.slides!.slice() : [];
          baseSlides[index] = slide;
          const merged = {
            ...(canAccumulateIr ? prevEnv : envelope),
            ...envelope,
            ir: { ...(envelope.ir ?? {}), ...(canAccumulateIr ? prevEnv?.ir : {}), slides: baseSlides },
          };
          return [merged as unknown as DesignPage];
        });
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
        if (d.length > 0) {
          setDesign(d);
          // O envelope persistido carrega o postId do deck. Sem re-hidratá-lo
          // aqui, um F5 deixava o botão Baixar desabilitado para sempre
          // ("Disponível assim que o primeiro slide sair") num deck já pronto.
          const envPid = (d[0] as { postId?: string } | undefined)?.postId;
          if (envPid) setPid(envPid);
        }
        if (rm) setRm(rm);
        setQuestion(question);
        // IDs determinísticos por posição: o rehydrate reusa os mesmos IDs a cada
        // session:state, então o React reconcilia (sem remontar/piscar/perder scroll).
        setMsgs(
          msgs
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map((m, i) => ({
              id: `srv-${i}`,
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

    // Token vai no subprotocolo (não no query string). O JWT é base64url + '.',
    // todos caracteres válidos de subprotocolo; o servidor lê do header.
    const url = `${WS_BASE}/ws?sessionId=${encodeURIComponent(sid)}`;
    const socket = new WebSocket(url, ['bearer', token]);

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
        // Jitter no retry: se o backend reiniciou, N abas reconectando no mesmo
        // instante viram um pico síncrono — espalhar 1.5–3s evita isso.
        const delay = 1500 + Math.random() * 1500;
        reconnectTimeoutRef.current = setTimeout(() => {
          // rehydrate=true: a queda pode ter engolido eventos (slides, job:done).
          // Sem re-hidratar, o que se perdeu na janela nunca chega — deck com
          // buracos e UI presa em "gerando" eram exatamente isso.
          if (sessionIdRef.current) connectWsRef.current?.(sessionIdRef.current, true);
        }, delay);
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

  // Mantém o ref apontando para o connectWs atual (usado pelo reconnect no
  // onclose). Em effect para não escrever o ref durante o render.
  useEffect(() => {
    connectWsRef.current = connectWs;
  }, [connectWs]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    let cancelled = false;

    if (initialSessionId) {
      // sessionId já foi inicializado com initialSessionId (evita setState síncrono aqui).
      sessionIdRef.current = initialSessionId;
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

  // Inicia uma conversa do zero: derruba o socket atual, limpa a sessão
  // persistida e o estado, e cria uma sessão nova (nova arte, novo histórico).
  const resetSession = useCallback(() => {
    const token = getToken();
    if (!token) return;

    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    sessionIdRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    streamingMsgIdRef.current = null;

    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(`fabrica_session_${brandSlug}`);
    }

    setSessionId(null);
    setMessages([]);
    setCurrentDesign([]);
    setPhase('listening');
    setWorkerStatus('idle');
    setProgress(0);
    setProgressLabel('');
    setActiveQuestion(null);
    setNotification(null);
    setIsStreaming(false);
    setPostId(undefined);

    fetch(`${API_BASE}/fabrica/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ brandSlug }),
    })
      .then(r => r.json())
      .then((d: { sessionId?: string }) => {
        if (!d.sessionId) return;
        sessionIdRef.current = d.sessionId;
        setSessionId(d.sessionId);
        connectWs(d.sessionId);
      })
      .catch(err => console.error('[useFabricaWs] reset session failed:', err));
  }, [brandSlug, connectWs]);

  const approve = useCallback(() => send('review:approve'), [send]);

  const decline = useCallback(
    (reason?: string) => send('review:decline', reason ? { reason } : {}),
    [send],
  );

  const setReviewMode = useCallback((mode: ReviewMode) => {
    setReviewModeState(mode);
    send('mode:set', { mode });
  }, [send]);

  // Edição LOCAL de um slide (aba Fonte / código): o servidor já persistiu via
  // PUT /slides/:idx/code; aqui só espelhamos no preview sem esperar rehydrate.
  const applySlideLocal = useCallback((index: number, slide: { html: string; css?: string }) => {
    setCurrentDesign(prev => {
      const env = prev[0] as (Record<string, unknown> & { kind?: string; slides?: unknown[] }) | undefined;
      if (!env || env.kind !== 'html-design' || !Array.isArray(env.slides)) return prev;
      const slides = env.slides.slice();
      slides[index] = slide;
      return [{ ...env, slides } as unknown as DesignPage];
    });
  }, []);

  return {
    sessionId,
    phase,
    messages,
    currentDesign,
    applySlideLocal,
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
    resetSession,
    clearNotification: () => setNotification(null),
  };
}
