'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowUp, Paperclip, Sparkles, Wifi, WifiOff, X, ChevronDown, ChevronRight, MessageSquarePlus, Check, Loader2 } from 'lucide-react';
import DesignRenderer from '@/components/Fabrica/DesignRenderer';
import HtmlSlideRenderer from '@/components/DesignDocument/HtmlSlideRenderer';
import IRSlideRenderer from '@/components/DesignDocument/IRSlideRenderer';
import { type HtmlDesignPostContent } from '@/lib/designContent';
import { AsanaPopup } from '@/components/Fabrica/AsanaPopup';
import { NotificationCard } from '@/components/Fabrica/NotificationCard';
import { useFabricaWs } from '@/hooks/useFabricaWs';
import { API_BASE } from '@/lib/api';
import { useBrandPermissions } from '@/hooks/useBrandPermissions';
import s from './fabrica.module.css';

// ── Components ────────────────────────────────────────────────────────────────
function ThinkingBlock({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={s.thinkingBlock}>
      <div 
        className={s.thinkingHeader} 
        onClick={() => setExpanded(!expanded)} 
        style={{ cursor: 'pointer', justifyContent: 'space-between' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Sparkles size={11} />
          <span>{expanded ? 'Ocultar raciocínio' : 'Mostrar raciocínio'}</span>
        </div>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </div>
      {expanded && <div className={s.thinkingBody}>{thinking}</div>}
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Attachment = { name: string; mimeType: string; dataBase64: string };

function attachmentPreviewLabel(attachment: Attachment): string {
  if (attachment.mimeType.startsWith('image/')) return `${attachment.name} · imagem`;
  return attachment.name;
}

const SLASH_COMMANDS = [
  { id: 'btw',   label: '/btw',   desc: 'Contexto extra sem interromper' },
  { id: 'asana', label: '/asana', desc: 'Abrir painel do Asana' },
  { id: 'editor', label: '/editor', desc: 'Abrir o editor atual' },
] as const;

type SlashId = typeof SLASH_COMMANDS[number]['id'];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fileToBase64(file: File): Promise<Attachment> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name: file.name, mimeType: file.type || 'application/octet-stream', dataBase64: btoa(bin) };
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FabricaPage() {
  const { marca } = useParams() as { marca: string };
  const router = useRouter();
  // Capturado UMA vez (lazy): se lêssemos o sessionStorage a cada render, a
  // gravação da sessão (effect abaixo) mudaria este valor e re-dispararia o
  // effect de conexão — causando um ciclo conecta→fecha→reconecta no load.
  const [initialSessionId] = useState<string | null>(() =>
    typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('sessionId') || sessionStorage.getItem(`fabrica_session_${marca}`))
      : null,
  );

  const {
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
    sessionId, // Extraído para salvar no storage
    sendMessage,
    answerQuestion,
    approve,
    decline,
    setReviewMode,
    resetSession,
    clearNotification,
  } = useFabricaWs(marca, initialSessionId);

  // Persiste a sessão atual no sessionStorage para não perder ao trocar de aba
  useEffect(() => {
    if (sessionId) {
      sessionStorage.setItem(`fabrica_session_${marca}`, sessionId);
    }
  }, [sessionId, marca]);

  // Brand name (for header display)
  const [brandName, setBrandName] = useState('');
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    fetch(`${API_BASE}/brands/${marca}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then((d: { data?: { name?: string } }) => { if (d.data?.name) setBrandName(d.data.name); })
      .catch(() => {});
  }, [marca]);

  // Input state
  const [input, setInput] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [questionFreeform, setQuestionFreeform] = useState('');
  const [btwContext, setBtwContext] = useState<string[]>([]);
  const [asanaContext, setAsanaContext] = useState<string[]>([]);

  // UI state
  const [showSlash, setShowSlash] = useState(false);
  const [slashSearch, setSlashSearch] = useState('');
  const [slashIdx, setSlashIdx] = useState(0);
  const [showAsana, setShowAsana] = useState(false);
  const [previewSlide, setPreviewSlide] = useState(0);

  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const questionInputRef = useRef<HTMLInputElement>(null);

  const isScrolledUp = useRef(false);

  const handleThreadScroll = useCallback(() => {
    if (!threadRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = threadRef.current;
    // Se o usuário rolou para cima (mais de 50px do final), ativamos a flag
    isScrolledUp.current = scrollHeight - scrollTop - clientHeight > 50;
  }, []);

  // Auto-scroll thread (Smart Scroll)
  useEffect(() => {
    requestAnimationFrame(() => {
      if (threadRef.current && !isScrolledUp.current) {
        threadRef.current.scrollTop = threadRef.current.scrollHeight;
      }
    });
  }, [messages, isStreaming, workerStatus, activeQuestion]);

  // Auto-resize textarea (useLayoutEffect to avoid layout shift)
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '22px';
    const scrollHeight = el.scrollHeight;
    el.style.height = `${Math.min(scrollHeight, 160)}px`;
  }, [input]);

  // ── Slash menu ──────────────────────────────────────────────────────────────

  const filteredSlash = useMemo(() =>
    SLASH_COMMANDS.filter(c =>
      !slashSearch || c.id.includes(slashSearch) || c.desc.toLowerCase().includes(slashSearch),
    ),
  [slashSearch]);

  const applySlash = useCallback((id: SlashId) => {
    if (id === 'editor') {
      if (postId) {
        router.push(`/${marca}/editor/${postId}`);
      }
      setShowSlash(false);
      setSlashSearch('');
      setInput('');
      return;
    }
    if (id === 'asana') {
      setShowAsana(true);
      setShowSlash(false);
      setSlashSearch('');
      // Clear the slash command from input
      setInput(v => v.replace(/(\/[a-zA-Z0-9-]*)$/, ''));
      return;
    }
    if (id === 'btw') {
      setInput(v => v.replace(/(\/[a-zA-Z0-9-]*)$/, '/btw '));
    }
    setShowSlash(false);
    setSlashSearch('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [postId, router, marca]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    const match = val.match(/(\/[a-zA-Z0-9-]*)$/);
    if (match) {
      setShowSlash(true);
      setSlashSearch(match[1].slice(1).toLowerCase());
      setSlashIdx(0);
      return;
    }
    
    setShowSlash(false);
    setSlashSearch('');
  }, []);

  // ── Send ────────────────────────────────────────────────────────────────────

  const handleSend = useCallback(() => {
    let text = input.trim();
    if (!text) return;

    if (text === '/editor') {
      if (postId) {
        router.push(`/${marca}/editor/${postId}`);
      }
      setInput('');
      return;
    }

    // Se estiver streamando e o usuário enviar algo, automaticamente trata como /btw
    if (isStreaming && !text.startsWith('/btw')) {
      text = '/btw ' + text;
    }

    if (text.startsWith('/btw ')) {
      const ctx = text.slice(5).trim();
      if (!ctx) return;
      setBtwContext(prev => [...prev, ctx]);
      setInput('');
      return;
    }

    if (isStreaming) return; // Se ainda for streaming mas for apenas "/btw" vazio, ou algo estranho

    let fullMessage = text;
    if (btwContext.length > 0) {
      fullMessage += `\n\n[Contexto adicional]\n${btwContext.map(c => `• ${c}`).join('\n')}`;
    }
    if (asanaContext.length > 0) {
      fullMessage += `\n\n[Contexto Asana]\n${asanaContext.join('\n\n')}`;
    }
    const outboundAttachments = attachment ? [attachment] : undefined;

    sendMessage(fullMessage, outboundAttachments);
    setInput('');
    setAttachment(null);
    setBtwContext([]);
    setAsanaContext([]);
  }, [input, isStreaming, btwContext, asanaContext, attachment, sendMessage, postId, router, marca]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlash && filteredSlash.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx(i => (i + 1) % filteredSlash.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSlashIdx(i => (i - 1 + filteredSlash.length) % filteredSlash.length); return; }
      if (e.key === 'Enter')     { e.preventDefault(); applySlash(filteredSlash[slashIdx].id); return; }
      if (e.key === 'Escape')    { e.preventDefault(); setShowSlash(false); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachment(await fileToBase64(file));
    e.target.value = '';
  };

  const handleNewConversation = useCallback(() => {
    if ((isStreaming || workerStatus === 'running')
      && !window.confirm('Começar uma nova conversa? A geração atual continua no servidor, mas some daqui.')) {
      return;
    }
    resetSession();
    router.replace(`/${marca}/fabrica`);
    setInput('');
    setAttachment(null);
    setBtwContext([]);
    setAsanaContext([]);
    setPreviewSlide(0);
    setShowAsana(false);
  }, [isStreaming, workerStatus, resetSession, router, marca]);

  const { can, hint: permHint } = useBrandPermissions();
  // Gerar design consome cota do Gemini e cria post: exige papel de edição. Sem isto,
  // um VIEWER dispararia a geração e só descobriria o 403 depois da fila rodar.
  const canGenerate = can('generate');
  const canSend = input.trim().length > 0 && canGenerate;

  // ── Phase label ─────────────────────────────────────────────────────────────

  const phaseLabel: Record<string, string> = {
    listening: 'Escutando',
    clarifying: 'Refinando',
    ready: 'Preparando',
    running: 'Gerando',
    reviewing: 'Revisando',
    revising: 'Ajustando',
    done: 'Concluído',
    error: 'Erro',
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const displayMessages = messages;

  // ── Normaliza o formato do design pro preview (html-design, ir-design, legacy) ─
  const designKind = (currentDesign[0] as { kind?: string } | undefined)?.kind;
  const isHtmlDesign = designKind === 'html-design';
  const isIrDesign = designKind === 'ir-design';
  const slideCount = isHtmlDesign
    ? ((currentDesign[0] as unknown as HtmlDesignPostContent).slides?.length ?? 0)
    : isIrDesign
    ? ((currentDesign[0] as { ir?: { slides?: unknown[] } }).ir?.slides?.length ?? 0)
    : currentDesign.length;

  // Índice clampeado (derivado): se um novo design tiver menos slides que o anterior,
  // mantém o preview dentro do range sem precisar de setState em effect.
  const safeSlide = Math.min(previewSlide, Math.max(0, slideCount - 1));

  // Status de (pré-)salvamento: o pipeline persiste os slides de forma incremental
  // no banco, então enquanto gera está "Salvando rascunho"; parado com arte = "Salvo".
  const saveStatus: 'saving' | 'saved' | null =
    currentDesign.length === 0 ? null
    : workerStatus === 'running' ? 'saving'
    : workerStatus === 'error' ? null
    : 'saved';

  return (
    <div className={s.root}>

      {/* Asana popup */}
      {showAsana && (
        <AsanaPopup
          onClose={() => setShowAsana(false)}
          onInject={text => {
            setAsanaContext(prev => [...prev, text]);
            setShowAsana(false);
          }}
        />
      )}

      {/* Notification card */}
      <NotificationCard
        notification={notification}
        reviewMode={reviewMode}
        marca={marca}
        postId={postId}
        onApprove={approve}
        onDecline={decline}
        onSetMode={setReviewMode}
        onDismiss={clearNotification}
      />

      {/* ── Left panel: chat ───────────────────────────────────────────────── */}
      <aside className={s.chatPanel}>

        {/* Header */}
        <div className={s.chatHeader}>
          <div className={s.chatHeaderLeft}>
            <span className={s.chatTitle}>{brandName || marca}</span>
            <span className={s.chatPhase}>{phaseLabel[phase] ?? phase}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={handleNewConversation}
              title="Iniciar uma nova conversa"
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 500, padding: '5px 10px', borderRadius: 8,
                border: '1px solid rgba(0,0,0,0.08)', background: 'rgba(255,255,255,0.7)',
                color: 'var(--color-text-secondary)', cursor: 'pointer', backdropFilter: 'blur(8px)',
              }}
            >
              <MessageSquarePlus size={14} /> Nova
            </button>
            <div className={s.connectionBadge} title={connected ? 'Conectado' : 'Reconectando...'}>
              <span className={`${s.connectionDot} ${connected ? s.connectionOnline : s.connectionOffline}`} />
              {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
              <span className={s.connectionLabel}>{connected ? 'Online' : 'Reconectando'}</span>
            </div>
          </div>
        </div>

        {/* Thread */}
        <div className={s.thread} ref={threadRef} onScroll={handleThreadScroll}>
          {displayMessages.length === 0 ? (
            <div className={s.emptyState}>
              <div className={s.emptyIcon}>
                <Sparkles size={22} />
              </div>
              <p className={s.emptyTitle}>O que você quer criar?</p>
              <p className={s.emptySubtitle}>
                Descreva a peça — apresentação, carrossel, proposta — e o agente conduz o processo.
              </p>
              
              {/* Sugestões de Prompt para quebrar Blank Page */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 16 }}>
                {[
                  'Carrossel com 5 dicas de finanças',
                  'Apresentação comercial de 6 slides',
                  'Proposta de serviços em PDF',
                ].map((sug, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(sug)}
                    style={{
                      background: 'rgba(255,255,255,0.8)',
                      border: '1px solid rgba(0,0,0,0.06)',
                      padding: '8px 12px',
                      borderRadius: 14,
                      fontSize: 12,
                      color: 'var(--color-text-secondary)',
                      cursor: 'pointer',
                      backdropFilter: 'blur(10px)',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
                      transition: 'all 0.15s'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = 'rgba(217, 119, 87, 0.3)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.borderColor = 'rgba(0,0,0,0.06)'; }}
                  >
                    {sug}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            displayMessages.map(msg => {
              if (msg.role === 'user') {
                const asanaSplit = msg.content.split('\n\n[Contexto Asana]\n');
                const mainText = asanaSplit[0];
                const asanaBlock = asanaSplit[1];
                return (
                  <div key={msg.id} className={s.userRow}>
                    <div className={s.userBubble}>
                      <span>{mainText}</span>
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className={s.messageAttachments}>
                          {msg.attachments.map((attachment, attachmentIndex) => (
                            <span key={`${attachment.name}-${attachmentIndex}`} className={s.messageAttachmentPill}>
                              {attachmentPreviewLabel(attachment)}
                            </span>
                          ))}
                        </div>
                      )}
                      {asanaBlock && (
                        <div className={s.asanaBlock}>
                          <div className={s.asanaBlockHeader}>
                            <img src="/asana-logo.svg" width={11} height={11} alt="" />
                            <span>Contexto Asana</span>
                          </div>
                          <pre className={s.asanaBlockBody}>{asanaBlock}</pre>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }
              if (msg.role === 'system') {
                return (
                  <div key={msg.id} className={s.systemRow}>
                    <span>{msg.content}</span>
                  </div>
                );
              }
              return (
                <div key={msg.id} className={s.aiRow}>
                  <div className={s.aiAvatar}>
                    <Sparkles size={11} />
                  </div>
                  <div className={s.aiBubble}>
                    {msg.thinking && <ThinkingBlock thinking={msg.thinking} />}
                    <div className={s.aiText}>
                      {msg.content}
                      {isStreaming && msg.id === messages[messages.length - 1]?.id && (
                        <span className={s.cursor} />
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {isStreaming && (messages.length === 0 || messages[messages.length - 1]?.role === 'user') && (
            <div className={s.aiRow}>
              <div className={s.aiAvatar}>
                <Sparkles size={11} />
              </div>
              <div className={`${s.aiBubble} ${s.aiBubbleLoading}`}>
                <div className={s.typingDots}>
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          )}

          {/* Active Question Accordion agora reside na thread e acompanha o fluxo de scroll */}
          {activeQuestion && (
            <div className={s.questionAccordion}>
              <div className={s.questionMeta}>
                <span className={s.questionPill}>Pergunta ativa</span>
                <span className={s.questionMode}>{activeQuestion.mode === 'auto' ? 'Modo automático' : 'Modo guiado'}</span>
              </div>
              <div className={s.questionHeader}>
                <Sparkles size={13} style={{ color: 'var(--color-brand)' }} />
                <span>{activeQuestion.question}</span>
              </div>
              {activeQuestion.helperText && (
                <p className={s.questionHelper}>{activeQuestion.helperText}</p>
              )}
              <div className={s.questionOptions}>
                {activeQuestion.options.map((opt) => (
                  <button
                    key={opt.id}
                    className={s.questionOptionBtn}
                    onClick={() => {
                      answerQuestion({ optionLabel: opt.value ?? opt.label });
                      setQuestionFreeform('');
                    }}
                    title={opt.description}
                  >
                    <span className={s.questionOptionLabel}>{opt.label}</span>
                    {opt.description && <span className={s.questionOptionDesc}>{opt.description}</span>}
                  </button>
                ))}
                {activeQuestion.allowFreeform && (
                  <div className={s.questionFreeformWrap}>
                    <input
                      ref={questionInputRef}
                      className={s.questionInput}
                      value={questionFreeform}
                      onChange={(e) => setQuestionFreeform(e.target.value)}
                      placeholder="Outro caminho? Digite aqui"
                    />
                    <button
                      className={`${s.questionOptionBtn} ${s.questionFreeformBtn}`}
                      onClick={() => {
                        if (!questionFreeform.trim()) {
                          questionInputRef.current?.focus();
                          return;
                        }
                        answerQuestion({ freeform: questionFreeform.trim() });
                        setQuestionFreeform('');
                      }}
                    >
                      Enviar outro
                    </button>
                  </div>
                )}
                {activeQuestion.allowSkip && (
                  <button
                    className={`${s.questionOptionBtn} ${s.questionSkipBtn}`}
                    onClick={() => {
                      answerQuestion({ skipped: true });
                      setQuestionFreeform('');
                    }}
                  >
                    Pular (Automático)
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Generation progress row */}
          {workerStatus === 'running' && (
            <div className={s.progressRow}>
              <div className={s.progressHeader}>
                <span className={s.progressEyebrow}>Fábrica em execução</span>
                <span className={s.progressValue}>{progress}%</span>
              </div>
              <p className={s.progressLabel}>{progressLabel || 'Gerando...'}</p>
              <div className={s.progressTrack}>
                <div className={s.progressBar} style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* Input area */}
        <div className={s.inputArea}>

          {/* /btw context pills */}
          {(btwContext.length > 0 || asanaContext.length > 0) && (
            <div className={s.btwStrip}>
              {btwContext.map((c, i) => (
                <span key={`btw-${i}`} className={s.btwPill}>
                  <span className={s.btwTag}>/btw</span>
                  <span className={s.btwPillText}>{c}</span>
                  <button
                    type="button"
                    className={s.pillRemove}
                    onClick={() => setBtwContext(prev => prev.filter((_, j) => j !== i))}
                  ><X size={9} /></button>
                </span>
              ))}
              {asanaContext.map((c, i) => {
                const firstLine = c.split('\n').find(l => l.startsWith('•'))?.slice(2) ?? `${i + 1} tarefa${i > 0 ? 's' : ''}`;
                return (
                  <span key={`asana-${i}`} className={s.asanaPill}>
                    <img src="/asana-logo.svg" width={10} height={10} alt="Asana" className={s.asanaPillLogo} />
                    {firstLine.length > 30 ? firstLine.slice(0, 28) + '…' : firstLine}
                    <button
                      type="button"
                      className={s.pillRemove}
                      onClick={() => setAsanaContext(prev => prev.filter((_, j) => j !== i))}
                    ><X size={9} /></button>
                  </span>
                );
              })}
            </div>
          )}

          {/* Attachment strip */}
          {attachment && (
            <div className={s.attachStrip}>
              <Paperclip size={11} />
              <span>{attachmentPreviewLabel(attachment)}</span>
              <button className={s.attachRemove} onClick={() => setAttachment(null)}><X size={11} /></button>
            </div>
          )}

          <div className={s.inputWrap}>
            {/* Slash command menu */}
            {showSlash && filteredSlash.length > 0 && (
              <div className={s.slashMenu}>
                {filteredSlash.map((cmd, i) => (
                  <div
                    key={cmd.id}
                    className={`${s.slashItem} ${i === slashIdx ? s.slashActive : ''}`}
                    onMouseDown={e => { e.preventDefault(); applySlash(cmd.id); }}
                    onMouseEnter={() => setSlashIdx(i)}
                  >
                    <span className={s.slashLabel}>{cmd.label}</span>
                    <span className={s.slashDesc}>{cmd.desc}</span>
                  </div>
                ))}
              </div>
            )}

            <div className={s.inputBar}>
              <button
                className={s.iconBtn}
                onClick={() => fileRef.current?.click()}
                title="Anexar arquivo"
              >
                <Paperclip size={15} />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.pdf"
                style={{ display: 'none' }}
                onChange={handleFile}
              />
              <textarea
                ref={inputRef}
                className={s.inputField}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKey}
                placeholder={
                  isStreaming
                    ? 'Gerando... digite algo para adicionar contexto em tempo real'
                    : messages.length === 0
                    ? 'Descreva o que você quer criar...'
                    : 'Refine ou peça ajustes... use / para comandos'
                }
                rows={1}
                disabled={false}
              />
              <button
                className={`${s.sendBtn} ${canSend ? s.sendActive : ''}`}
                onClick={handleSend}
                disabled={!canSend}
                title={canGenerate ? undefined : permHint}
              >
                <ArrowUp size={15} />
              </button>
            </div>
          </div>

          <p className={s.inputHint}>
            {canGenerate
              ? 'Enter envia · Shift+Enter nova linha · / para comandos'
              : permHint}
          </p>
        </div>
      </aside>

      {/* ── Right panel: preview ───────────────────────────────────────────── */}
      <main className={s.previewPanel}>
        {currentDesign.length === 0 ? (
          <div className={s.previewEmpty}>
            <div className={s.previewEmptyGradient} />
            <div className={s.previewEmptyContent}>
              {workerStatus === 'running' ? (
                <div className={s.buildView}>
                  <div className={s.buildStage}>
                    <div className={s.buildSkeleton}>
                      <div className={s.buildSkBlock} />
                      <div className={s.buildSkLine} />
                      <div className={s.buildSkLine} style={{ width: '64%' }} />
                      <div className={s.buildSkLine} style={{ width: '40%' }} />
                    </div>
                  </div>
                  <div className={s.previewProgressWrap}>
                    <div className={s.previewProgressBar} style={{ width: `${Math.max(4, progress)}%` }} />
                  </div>
                  <p className={s.previewProgressLabel}>{progressLabel || 'Preparando...'} · {progress}%</p>
                  <div className={s.buildFilmstrip}>
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className={s.buildFilmCard} />
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <p className={s.previewEmptyTitle}>Preview em tempo real</p>
                  <p className={s.previewEmptyHint}>O design aparece aqui durante a geração</p>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className={s.previewContent}>
            {/* Progress overlay during update */}
            {workerStatus === 'running' && (
              <div className={s.previewTopBar}>
                <div className={s.previewTopProgress} style={{ width: `${progress}%` }} />
              </div>
            )}

            {/* Save status badge */}
            {saveStatus && (
              <div
                style={{
                  position: 'absolute', top: 12, right: 12, zIndex: 5,
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 11, fontWeight: 500, padding: '5px 10px', borderRadius: 20,
                  background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(8px)',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
                  color: saveStatus === 'saving' ? '#92400e' : '#166534',
                }}
              >
                {saveStatus === 'saving' ? (
                  <>
                    <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                    Salvando rascunho…
                  </>
                ) : (
                  <>
                    <Check size={12} /> Salvo
                  </>
                )}
              </div>
            )}

            {/* Slide renderer */}
            <div className={s.slideWrap}>
              {isHtmlDesign ? (
                <HtmlSlideRenderer
                  content={currentDesign[0] as unknown as HtmlDesignPostContent}
                  activeSlide={safeSlide}
                  hideNav
                />
              ) : isIrDesign ? (
                <IRSlideRenderer
                  content={currentDesign[0]}
                  activeSlide={safeSlide}
                  hideNav
                />
              ) : (
                <DesignRenderer
                  pages={[currentDesign[safeSlide] ?? currentDesign[0]]}
                  canvasWidth={1920}
                  canvasHeight={1080}
                  hideNav
                />
              )}
            </div>

            {/* Slide navigation */}
            {slideCount > 1 && (
              <div className={s.slideNav}>
                <button
                  className={s.slideNavBtn}
                  onClick={() => setPreviewSlide(Math.max(0, safeSlide - 1))}
                  disabled={safeSlide === 0}
                >‹</button>
                <span className={s.slideNavLabel}>
                  {safeSlide + 1} / {slideCount}
                </span>
                <button
                  className={s.slideNavBtn}
                  onClick={() => setPreviewSlide(Math.min(slideCount - 1, safeSlide + 1))}
                  disabled={safeSlide >= slideCount - 1}
                >›</button>
              </div>
            )}

            {/* Thumbnail strip */}
            {slideCount > 1 && (
              <div className={s.thumbStrip}>
                {Array.from({ length: slideCount }).map((_, i) => (
                  <button
                    key={i}
                    className={`${s.thumb} ${i === safeSlide ? s.thumbActive : ''}`}
                    onClick={() => setPreviewSlide(i)}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
