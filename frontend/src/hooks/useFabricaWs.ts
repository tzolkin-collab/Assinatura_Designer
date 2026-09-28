'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE } from '@/lib/api';
import type { FabricaQuestion, SessionPhase, WorkerStatus, ReviewMode } from '@/lib/fabricaSession';
import { applyAdviceEvent, hydrateAdviceList, type AdviceItem, type AdviceEventType } from '@/lib/advice';

// Envelope genérico do design corrente (hoje sempre um HtmlDesignPostContent
// embrulhado num array de 1 elemento — ver lib/designContent.ts).
type DesignPage = Record<string, unknown>;

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
  /** Ferramentas acionadas neste turno, na ordem, com o desfecho de cada uma. */
  tools?: Array<{ name: string; ok?: boolean; detail?: string }>;
  imageProposal?: {
    id: string;
    prompt: string;
    status: 'generating' | 'done' | 'error';
    url?: string;
    error?: string;
  };
}

export interface FabricaNotification {
  kind: 'done' | 'needs_review' | 'error';
  message: string;
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token');
}

// `job:error` e `error` descrevem o MESMO incidente com frequência, e cada um
// empilhava sua própria linha — a falha aparecia duas vezes seguidas, idêntica.
// Repetir o texto imediatamente é ruído, não informação nova.
function appendSystemMessage(prev: FabricaMessage[], content: string): FabricaMessage[] {
  const last = prev[prev.length - 1];
  if (last?.role === 'system' && last.content === content) return prev;
  return [...prev, { id: crypto.randomUUID(), role: 'system', content, timestamp: Date.now() }];
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
  // Orientações em tempo real (substituem o /btw) e "Pausar e enviar".
  const [advice, setAdvice] = useState<AdviceItem[]>([]);
  // Fila de orientações que EXPIRARAM sem serem consumidas E foram enviadas por
  // ESTA aba (origin === clientId): o texto volta pro campo de digitação (ver
  // fabrica/page.tsx) — "nada se perde", mesmo quando a geração termina no meio.
  const [returnedAdvice, setReturnedAdvice] = useState<AdviceItem[]>([]);
  // true entre o clique em "Pausar e enviar" e o primeiro sinal de que o próximo
  // turno começou — só para não deixar o usuário clicar duas vezes durante a
  // espera (o backend pode levar até a duração de um lote inteiro para parar).
  const [interrupting, setInterrupting] = useState(false);
  // Id estável desta aba: é o `origin` que o servidor devolve nas orientações, e é
  // como esta aba sabe se um advice.expired é seu (para devolver o texto) ou de
  // outra aba na mesma sessão (aí só sai da lista).
  const [clientId] = useState<string>(() => {
    try {
      return typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    } catch {
      return `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  });

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
      setAdvice([]);
      setReturnedAdvice([]);
      setInterrupting(false);
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
    setAdvice,
    setReturnedAdvice,
    setInterrupting,
    clientId,
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
      setAdvice: setAdv,
      setReturnedAdvice: setReturned,
      setInterrupting: setInterr,
      clientId: myClientId,
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
        // Chegou token: o turno seguinte ao "Pausar e enviar" começou de verdade.
        setInterr(false);
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
        if (!text) break;
        // O raciocínio vem ANTES do primeiro token — o modelo pensa 1,9 a 2,9x
        // o que escreve, e pensa primeiro. Como a mensagem do assistente só
        // nascia no `agent:token`, o `if` abaixo nunca casava nessa janela e
        // TODO o pensamento era descartado no `return prev` — justamente os
        // segundos em que a tela mostra três pontinhos. Agora a mensagem nasce
        // aqui também, e o texto ACUMULA em vez de cada fragmento apagar o
        // anterior (era `thinking: text`, sobrescrevendo).
        setStreaming(true);
        setMsgs(prev => {
          const last = prev[prev.length - 1];
          const sid = actionsRef.current.streamingMsgIdRef.current;
          if (last?.role === 'assistant' && last.id === sid) {
            return prev.map(m => m.id === last.id ? { ...m, thinking: (m.thinking ?? '') + text } : m);
          }
          const id = crypto.randomUUID();
          actionsRef.current.streamingMsgIdRef.current = id;
          return [...prev, { id, role: 'assistant', content: '', thinking: text, timestamp: Date.now() }];
        });
        break;
      }

      // O mesmo padrão do `thinking`: a mensagem nasce aqui se ainda não existe,
      // porque a ferramenta costuma ser acionada ANTES de o modelo escrever.
      case 'agent:tool_call': {
        const name = (data.name ?? '') as string;
        if (!name) break;
        setStreaming(true);
        setMsgs(prev => {
          const last = prev[prev.length - 1];
          const sid = actionsRef.current.streamingMsgIdRef.current;
          if (last?.role === 'assistant' && last.id === sid) {
            return prev.map(m => m.id === last.id ? { ...m, tools: [...(m.tools ?? []), { name }] } : m);
          }
          const id = crypto.randomUUID();
          actionsRef.current.streamingMsgIdRef.current = id;
          return [...prev, { id, role: 'assistant', content: '', tools: [{ name }], timestamp: Date.now() }];
        });
        break;
      }

      case 'agent:tool_result': {
        const name = (data.name ?? '') as string;
        const ok = data.ok !== false;
        const detail = data.detail as string | undefined;
        setMsgs(prev => prev.map(m => {
          if (m.id !== actionsRef.current.streamingMsgIdRef.current || !m.tools) return m;
          // Fecha a ÚLTIMA em aberto com esse nome — a mesma ferramenta pode ser
          // acionada duas vezes no mesmo turno.
          const i = m.tools.map(t => t.name === name && t.ok === undefined).lastIndexOf(true);
          if (i < 0) return m;
          const tools = m.tools.slice();
          tools[i] = { name, ok, detail };
          return { ...m, tools };
        }));
        break;
      }

      case 'image:proposal:start': {
        const { id, prompt } = data as { id: string; prompt: string };
        setMsgs(prev => [
          ...prev,
          { id: `proposal-${id}`, role: 'assistant', content: '', timestamp: Date.now(), imageProposal: { id, prompt, status: 'generating' } }
        ]);
        break;
      }

      case 'image:proposal:done': {
        const { id, url } = data as { id: string; url: string };
        setMsgs(prev => prev.map(m => m.id === `proposal-${id}` ? { ...m, imageProposal: { ...m.imageProposal!, status: 'done', url } } : m));
        break;
      }

      case 'image:proposal:error': {
        const { id, message } = data as { id: string; message: string };
        setMsgs(prev => prev.map(m => m.id === `proposal-${id}` ? { ...m, imageProposal: { ...m.imageProposal!, status: 'error', error: message } } : m));
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
        const { index, total, slide, envelope } = data as {
          index: number;
          total: number;
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
              // Total real (não o length do array, que só cresce até o maior índice
              // já chegado) — deixa a UI saber "faltam N" desde o primeiro slide,
              // em vez do contador crescer de forma imprevisível a cada delta.
              totalSlides: total,
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
            totalSlides: total,
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
        // O label descreve a etapa EM CURSO ("desenhando slide 3"). Mantê-lo depois
        // do fim deixava a tela afirmando que algo ainda acontece — barra em 100%
        // com texto de trabalho em andamento ao lado.
        setLabel('');
        setStreaming(false);
        actionsRef.current.streamingMsgIdRef.current = null;
        break;
      }

      case 'job:error': {
        const errMsg = normalizeUiMessage((data.message ?? 'Erro na geração') as string);
        setWStatus('error');
        setLabel('');
        setStreaming(false);
        actionsRef.current.streamingMsgIdRef.current = null;
        setMsgs(prev => appendSystemMessage(prev, errMsg));
        break;
      }

      case 'notification': {
        // NÃO encerra o streaming. A notificação é assíncrona ao texto: quando ela
        // chegava no meio de uma fala, o `setStreaming(false)` + limpeza do ref
        // órfãos a mensagem em construção — o resto dos tokens não tinha mais onde
        // ser concatenado e a frase morria pela metade na tela. Quem encerra a fala
        // é o `agent:end`; quem encerra o trabalho é o `job:done`.
        setNotif({
          kind: (data.kind as FabricaNotification['kind']) ?? 'done',
          message: (data.message as string) ?? '',
        });
        break;
      }

      case 'session:state': {
        const p = data.phase as SessionPhase | undefined;
        const d = (data.currentDesign ?? []) as DesignPage[];
        const rm = data.reviewMode as ReviewMode | undefined;
        const question = (data.activeQuestion ?? null) as FabricaQuestion | null;
        // Progresso vem no reconnect porque o backend agora o persiste: os
        // eventos job:progress emitidos enquanto este cliente estava fora foram
        // perdidos (broadcast só alcança socket aberto), e sem isto a barra
        // voltava a "Preparando… · 0%" com a geração já adiantada.
        const prog = data.progress as number | undefined;
        const progLabel = data.progressLabel as string | undefined;
        // O workerStatus é o portão de TODO o bloco de progresso na tela. Sem
        // restaurá-lo, quem dava F5 no meio de uma geração via o estado vazio
        // ("o design aparece aqui durante a geração") até o PRÓXIMO job:progress
        // — e entre dois tiques da etapa do artista passam-se minutos: 127s e 182s
        // medidos em produção. Restaurar o progresso sem isto não adiantava nada.
        const wstat = data.workerStatus as WorkerStatus | undefined;
        const msgs = (data.messages ?? []) as Array<{
          role: string; content: string; timestamp: number; attachments?: FabricaAttachment[];
        }>;
        if (p) setPh(p);
        if (wstat) setWStatus(wstat);
        if (typeof prog === 'number') setP(prog);
        if (typeof progLabel === 'string') setLabel(progLabel);
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
        // O campo `advice` só vem no session:state de RECONEXÃO (ver
        // agents/brain/index.ts `adviceForReconnect`) — nos demais broadcasts ele
        // some do payload de propósito, e aqui a ausência preserva a lista local
        // (que já está sendo mantida evento a evento) em vez de apagá-la.
        if (Array.isArray(data.advice)) setAdv(hydrateAdviceList(data.advice));
        // IDs determinísticos por posição: o rehydrate reusa os mesmos IDs a cada
        // session:state, então o React reconcilia (sem remontar/piscar/perder scroll).
        const doServidor = msgs
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map((m, i) => ({
            id: `srv-${i}`,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: m.timestamp,
            attachments: m.attachments,
          }));
        // Mensagens `system` (erros, avisos) existem só no cliente — o servidor não
        // as guarda no histórico da sessão. Substituir a lista inteira pelo que veio
        // dele apagava todas elas, e o rehydrate roda a CADA reconexão automática de
        // socket: bastava uma oscilação de rede para o rastro da falha sumir da tela
        // sem ninguém ter fechado nada.
        setMsgs(prev => {
          const locais = prev.filter(m => m.role === 'system');
          if (locais.length === 0) return doServidor;
          return [...doServidor, ...locais].sort((a, b) => a.timestamp - b.timestamp);
        });
        break;
      }

      case 'error': {
        const msg = normalizeUiMessage((data.message ?? 'Erro desconhecido') as string);
        setMsgs(prev => appendSystemMessage(prev, msg));
        setStreaming(false);
        setInterr(false);
        actionsRef.current.streamingMsgIdRef.current = null;
        break;
      }

      // Orientações em tempo real (ver backend/src/lib/advice.ts). O reducer é puro
      // (lib/advice.ts) — aqui só extraímos o payload e despachamos.
      case 'advice.queued':
      case 'advice.applied':
      case 'advice.updated':
      case 'advice.removed': {
        const item = (data.item ?? null) as AdviceItem | null;
        const id = (data.id as string | undefined) ?? item?.id;
        setAdv(prev => applyAdviceEvent(prev, type as AdviceEventType, { item, id }));
        break;
      }

      case 'advice.expired': {
        const item = (data.item ?? null) as AdviceItem | null;
        setAdv(prev => applyAdviceEvent(prev, 'advice.expired', { item }));
        // Só esta aba recupera o texto — outra aba na mesma sessão só vê o item
        // sumir da lista (ela não deve herdar um rascunho que não digitou).
        if (item && item.origin && item.origin === myClientId) {
          setReturned(prev => [...prev, item]);
        }
        break;
      }

      // O pipeline parou por "Pausar e enviar" mantendo os slides já gerados. Não é
      // job:done (não terminou) nem job:error (não falhou) — o cliente volta ao
      // estado ocioso e mostra ONDE parou. O abort do cérebro (sem pipeline) não
      // passa por aqui: ele só acrescenta o marcador "[resposta interrompida]" ao
      // fluxo normal de agent:token/agent:end.
      case 'generation.interrupted': {
        const info = data as { stage?: string; slidesKept?: number; total?: number; postId?: string };
        setWStatus('idle');
        setP(0);
        setLabel('');
        setStreaming(false);
        setInterr(false);
        actionsRef.current.streamingMsgIdRef.current = null;
        if (info.postId) setPid(info.postId);
        const stage = info.stage ?? 'a pedido';
        const progresso = (info.total ?? 0) > 0 ? ` — ${info.slidesKept ?? 0} de ${info.total} slides mantidos` : '';
        setMsgs(prev => appendSystemMessage(prev, `Geração pausada (${stage})${progresso}.`));
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

  // ── Orientações em tempo real ("aconselhar" a IA enquanto ela trabalha) ────────
  //
  // Otimista: a lista muda na hora (sem esperar o round-trip), e o servidor confirma
  // (advice.queued) ou corrige (advice.expired, se a IA já não estava ocupada quando
  // a gravação chegou — corrida rara, coberta no backend por `submitAdvice`).
  const sendAdvice = useCallback((text: string) => {
    const clean = text.trim();
    if (!clean) return;
    const id = crypto.randomUUID();
    setAdvice(prev => [...prev, { id, text: clean, createdAt: Date.now(), status: 'pending', origin: clientId }]);
    send('advice:send', { id, text: clean, clientId });
  }, [send, clientId]);

  // Só tem efeito enquanto o item está `pending` — o servidor recusa (e devolve a
  // verdade dele via advice.updated) uma edição que perdeu a corrida para a drenagem.
  const updateAdvice = useCallback((id: string, text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setAdvice(prev => prev.map(i => (i.id === id && i.status === 'pending' ? { ...i, text: clean, updatedAt: Date.now() } : i)));
    send('advice:update', { id, text: clean });
  }, [send]);

  const removeAdvice = useCallback((id: string) => {
    setAdvice(prev => prev.filter(i => i.id !== id));
    send('advice:remove', { id });
  }, [send]);

  // O front consumiu o texto devolvido (juntou de volta ao campo) — limpa a fila
  // para não reaplicá-lo a cada render.
  const clearReturnedAdvice = useCallback(() => setReturnedAdvice([]), []);

  // "Pausar e enviar": interrompe o que a IA estiver fazendo (stream do cérebro
  // aborta mantendo o parcial; pipeline para no próximo limite de lote preservando
  // os slides prontos) e abre a mensagem como um turno normal, com o contexto do
  // que foi interrompido e onde — tudo isso decidido no backend
  // (agents/brain/adviceHandlers.ts `handleInterruptMessage`), que pode levar
  // alguns segundos (até a duração de um lote) para responder.
  const interruptAndSend = useCallback((content: string, attachments?: FabricaAttachment[]) => {
    const text = content.trim();
    if (!text) return;
    const id = crypto.randomUUID();
    setMessages(prev => [...prev, { id, role: 'user', content: text, timestamp: Date.now(), attachments }]);
    setActiveQuestion(null);
    setIsStreaming(true);
    setInterrupting(true);
    send('message:interrupt', { content: text, attachments });
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
    setAdvice([]);
    setReturnedAdvice([]);
    setInterrupting(false);

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

  const cancelGeneration = useCallback(() => {
    send('generation:cancel');
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
    cancelGeneration,
    clearNotification: () => setNotification(null),
    // Orientações em tempo real + "Pausar e enviar".
    advice,
    returnedAdvice,
    clearReturnedAdvice,
    sendAdvice,
    updateAdvice,
    removeAdvice,
    interruptAndSend,
    interrupting,
  };
}
