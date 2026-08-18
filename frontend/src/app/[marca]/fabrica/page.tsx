'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowUp, Paperclip, Sparkles, Wifi, WifiOff, X, MessageSquarePlus, Check, Loader2 } from 'lucide-react';
import dynamic from 'next/dynamic';
const HtmlSlideRenderer = dynamic(() => import('@/components/DesignDocument/HtmlSlideRenderer'), { ssr: false });
import { type HtmlDesignPostContent } from '@/lib/designContent';
const AsanaPopup = dynamic(() => import('@/components/Fabrica/AsanaPopup').then(mod => ({ default: mod.AsanaPopup })), { ssr: false });
const CanvaPopup = dynamic(() => import('@/components/Fabrica/CanvaPopup').then(mod => ({ default: mod.CanvaPopup })), { ssr: false });
const DrivePopup = dynamic(() => import('@/components/Fabrica/DrivePopup').then(mod => ({ default: mod.DrivePopup })), { ssr: false });
import { NotificationCard } from '@/components/Fabrica/NotificationCard';
const FolderPicker = dynamic(() => import('@/components/Fabrica/FolderPicker'), { ssr: false });
const ArtifactPanel = dynamic(() => import('@/components/Fabrica/ArtifactPanel').then(mod => ({ default: mod.ArtifactPanel })), { ssr: false });
import { RealtimePreview } from '@/components/Fabrica/RealtimePreview';
const AiSpendBadge = dynamic(() => import('@/components/AiUsage/AiSpendBadge'), { ssr: false });
import { ChatMessageRow } from '@/components/Fabrica/ChatMessageRow';
import BrandBundlePanel from '@/components/Fabrica/BrandBundlePanel';
import { useFabricaWs } from '@/hooks/useFabricaWs';
import { API_BASE } from '@/lib/api';
import { useBrandPermissions } from '@/hooks/useBrandPermissions';
import s from './fabrica.module.css';

// ── Types ─────────────────────────────────────────────────────────────────────

type Attachment = { name: string; mimeType: string; dataBase64: string };

// O arquivo é convertido a base64 no NAVEGADOR e vai inteiro pelo WebSocket —
// não há upload nem teto em lugar nenhum da pilha. Com um anexo só isso já era
// arriscado; liberando vários, sem limite, uma seleção de PDFs estoura o frame
// e o request do Gemini.
//
// O teto é medido em bytes de ARQUIVO, não do base64: é o número que o usuário
// vê no explorador e o único que ele consegue conferir. Base64 infla ~33%, então
// 9MB de arquivo dão ~12MB no fio, dentro do limite de inline data do modelo.
const MAX_ANEXOS = 5;
const MAX_BYTES_ARQUIVOS = 9 * 1024 * 1024;
const MB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)}MB`;

function attachmentPreviewLabel(attachment: Attachment): string {
  if (attachment.mimeType.startsWith('image/')) return `${attachment.name} · imagem`;
  return attachment.name;
}

const BrandbookUploaderModal = dynamic(() => import('@/components/Brandbook/BrandbookUploaderModal'), { ssr: false });

const SLASH_COMMANDS = [
  { id: 'btw',   label: '/btw',   desc: 'Contexto extra sem interromper' },
  { id: 'brandbook', label: '/brandbook', desc: 'Importar/atualizar Brandbook completo' },
  { id: 'asana', label: '/asana', desc: 'Abrir painel do Asana' },
  { id: 'canva', label: '/canva', desc: 'Abrir painel do Canva' },
  { id: 'drive', label: '/drive', desc: 'Abrir painel do Google Drive' },
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
  const searchParams = useSearchParams();
  const sessionIdFromUrl = searchParams ? searchParams.get('sessionId') : null;

  // Carregado uma única vez na inicialização para evitar o loop de reconexão infinito
  // ao ler o sessionStorage em cada render.
  const [cachedSessionId] = useState<string | null>(() =>
    typeof window !== 'undefined' ? sessionStorage.getItem(`fabrica_session_${marca}`) : null
  );

  const initialSessionId = sessionIdFromUrl || cachedSessionId;

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
    cancelGeneration,
    clearNotification,
    applySlideLocal,
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
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachErro, setAttachErro] = useState<string | null>(null);
  // Espelho síncrono da lista: o handler precisa decidir sobre o valor ATUAL,
  // e o estado do React só chega no próximo render.
  const attachmentsRef = useRef<Attachment[]>([]);
  const aplicarAnexos = useCallback((lista: Attachment[]) => {
    attachmentsRef.current = lista;
    setAttachments(lista);
  }, []);
  const [questionFreeform, setQuestionFreeform] = useState('');
  const [btwContext, setBtwContext] = useState<string[]>([]);
  const [asanaContext, setAsanaContext] = useState<string[]>([]);
  const [asanaAttachments, setAsanaAttachments] = useState<Attachment[]>([]);

  // UI state
  const [showSlash, setShowSlash] = useState(false);
  const [slashSearch, setSlashSearch] = useState('');
  const [slashIdx, setSlashIdx] = useState(0);
  const [showAsana, setShowAsana] = useState(false);
  const [showCanva, setShowCanva] = useState(false);
  const [showDrive, setShowDrive] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [showBrandbook, setShowBrandbook] = useState(false);
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
    if (id === 'brandbook') {
      setShowBrandbook(true);
      setShowSlash(false);
      setSlashSearch('');
      setInput(v => v.replace(/(\/[a-zA-Z0-9-]*)$/, ''));
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
    if (id === 'canva') {
      setShowCanva(true);
      setShowSlash(false);
      setSlashSearch('');
      // Clear the slash command from input
      setInput(v => v.replace(/(\/[a-zA-Z0-9-]*)$/, ''));
      return;
    }
    if (id === 'drive') {
      setShowDrive(true);
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
      fullMessage += `\n\n[Contexto Externo]\n${asanaContext.join('\n\n')}`;
    }
    
    const outboundAttachments: Attachment[] = [];
    if (attachments.length > 0) outboundAttachments.push(...attachments);
    if (asanaAttachments.length > 0) outboundAttachments.push(...asanaAttachments);

    sendMessage(fullMessage, outboundAttachments.length > 0 ? outboundAttachments : undefined);
    setInput('');
    aplicarAnexos([]);
    setAttachErro(null);
    setAsanaAttachments([]);
    setBtwContext([]);
    setAsanaContext([]);
  }, [input, isStreaming, btwContext, asanaContext, asanaAttachments, attachments, aplicarAnexos, sendMessage, postId, router, marca]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlash && filteredSlash.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx(i => (i + 1) % filteredSlash.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSlashIdx(i => (i - 1 + filteredSlash.length) % filteredSlash.length); return; }
      if (e.key === 'Enter')     { e.preventDefault(); applySlash(filteredSlash[slashIdx].id); return; }
      if (e.key === 'Escape')    { e.preventDefault(); setShowSlash(false); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // Bytes reais do arquivo a partir do base64 (infla 4/3, menos o padding).
  // Evita carregar um campo a mais no tipo e no que trafega pelo WebSocket.
  const bytesDe = (a: Attachment) => Math.floor((a.dataBase64.length * 3) / 4);

  // `fileToBase64` de um PDF grande leva segundos, e nesse intervalo o usuário
  // consegue abrir o seletor de novo. Dois handlers liam o mesmo
  // `attachments.length` do closure, cada um concluía que cabiam mais dois, e a
  // caixa terminava acima do teto que existe justamente para não estourar o
  // frame. A reserva é feita em ref, ANTES do await, então o segundo handler já
  // enxerga o que o primeiro tomou.
  const reservaRef = useRef({ vagas: 0, bytes: 0 });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const escolhidos = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (escolhidos.length === 0) return;
    setAttachErro(null);

    const emUso = attachmentsRef.current;
    const reserva = reservaRef.current;
    const motivos: string[] = [];

    const espaco = MAX_ANEXOS - emUso.length - reserva.vagas;
    if (espaco <= 0) { setAttachErro(`Máximo de ${MAX_ANEXOS} anexos por mensagem.`); return; }

    let orcamento = MAX_BYTES_ARQUIVOS - emUso.reduce((t, a) => t + bytesDe(a), 0) - reserva.bytes;
    const aprovados: File[] = [];
    for (const f of escolhidos) {
      if (aprovados.length >= espaco) { motivos.push(`só cabem ${MAX_ANEXOS} anexos por mensagem`); break; }
      if (f.size > orcamento) { motivos.push(`"${f.name}" não coube em ${MB(MAX_BYTES_ARQUIVOS)} somando os anexos`); continue; }
      orcamento -= f.size;
      aprovados.push(f);
    }

    // Todos os motivos, não só o último: violar contagem E tamanho ao mesmo
    // tempo dizia apenas "máximo de N anexos", e quem removia arquivos
    // continuava sendo recusado sem nunca saber que o problema era o tamanho.
    if (motivos.length > 0) setAttachErro([...new Set(motivos)].join('; ') + '.');
    if (aprovados.length === 0) return;

    reserva.vagas += aprovados.length;
    reserva.bytes += aprovados.reduce((t, f) => t + f.size, 0);
    try {
      const prontos = await Promise.all(aprovados.map(fileToBase64));
      aplicarAnexos([...attachmentsRef.current, ...prontos]);
    } finally {
      reserva.vagas -= aprovados.length;
      reserva.bytes -= aprovados.reduce((t, f) => t + f.size, 0);
    }
  };

  const handleNewConversation = useCallback(() => {
    if ((isStreaming || workerStatus === 'running')
      && !window.confirm('Começar uma nova conversa? A geração atual continua no servidor, mas some daqui.')) {
      return;
    }
    resetSession();
    router.replace(`/${marca}/fabrica`);
    setInput('');
    aplicarAnexos([]);
    setAttachErro(null);
    setBtwContext([]);
    setAsanaContext([]);
    setPreviewSlide(0);
    setShowAsana(false);
  }, [isStreaming, workerStatus, resetSession, aplicarAnexos, router, marca]);

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

  // ── Normaliza o formato do design pro preview (html-design, legacy) ─
  const designKind = (currentDesign[0] as { kind?: string } | undefined)?.kind;
  const isHtmlDesign = designKind === 'html-design';
  // totalSlides (do WS, ver useFabricaWs) é o total DE VERDADE assim que o primeiro
  // slide chega — slides.length sozinho só reflete o maior índice já recebido e
  // cresce aos saltos conforme os lotes chegam fora de ordem.
  const htmlDesignContent = currentDesign[0] as unknown as (HtmlDesignPostContent & { totalSlides?: number }) | undefined;
  const slideCount = isHtmlDesign
    ? Math.max(htmlDesignContent?.slides?.length ?? 0, htmlDesignContent?.totalSlides ?? 0)
    : currentDesign.length;

  // Índice clampeado (derivado): se um novo design tiver menos slides que o anterior,
  // mantém o preview dentro do range sem precisar de setState em effect.
  const safeSlide = Math.min(previewSlide, Math.max(0, slideCount - 1));
  // Slot ainda não chegou (geração progressiva em andamento) — mostra esqueleto
  // em vez de um iframe vazio/branco.
  const activeSlideMissing = isHtmlDesign && workerStatus === 'running' && !htmlDesignContent?.slides?.[safeSlide];

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
          onInject={(text, atts) => {
            setAsanaContext(prev => [...prev, text]);
            if (atts && atts.length > 0) {
              setAsanaAttachments(prev => [...prev, ...atts]);
            }
            setShowAsana(false);
          }}
        />
      )}

      {/* Canva popup */}
      {showCanva && (
        <CanvaPopup
          onClose={() => setShowCanva(false)}
          onInject={text => {
            setAsanaContext(prev => [...prev, text]);
            setShowCanva(false);
          }}
        />
      )}

      {/* Google Drive popup */}
      {showDrive && (
        <DrivePopup
          onClose={() => setShowDrive(false)}
          onInject={(text, atts) => {
            setAsanaContext(prev => [...prev, text]);
            if (atts && atts.length > 0) {
              setAsanaAttachments(prev => [...prev, ...atts]);
            }
            setShowDrive(false);
          }}
        />
      )}

      {/* ── Left panel: chat ───────────────────────────────────────────────── */}
      <aside className={s.chatPanel}>

        {/* Header */}
        <div className={s.chatHeader}>
          <div className={s.chatHeaderLeft}>
            <span className={s.chatTitle}>{brandName || marca}</span>
          </div>
          <div className={s.chatHeaderRight}>
            <AiSpendBadge slug={marca} compact />
            <button
              className={s.newConvBtn}
              onClick={handleNewConversation}
              disabled={!canGenerate}
              title={canGenerate ? "Iniciar uma nova conversa" : permHint}
              aria-label="Iniciar nova conversa"
            >
              <MessageSquarePlus size={14} /> Nova
            </button>
            <div className={s.connectionBadge} role="status" title={connected ? 'Conectado' : 'Reconectando...'}>
              <span className={`${s.connectionDot} ${connected ? s.connectionOnline : s.connectionOffline}`} />
              <span className={s.connectionLabel}>{connected ? 'Online' : 'Reconectando...'}</span>
            </div>
          </div>
        </div>

        {/* Thread */}
        <div
          className={s.thread}
          ref={threadRef}
          onScroll={handleThreadScroll}
          role="log"
          aria-live="polite"
          aria-label="Conversa com a fábrica"
        >
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
              <div className={s.suggestChips}>
                {[
                  'Carrossel com 5 dicas de finanças',
                  'Apresentação comercial de 6 slides',
                  'Proposta de serviços em PDF',
                ].map((sug, i) => (
                  <button
                    key={i}
                    className={s.suggestChip}
                    onClick={() => {
                      setInput(sug);
                      inputRef.current?.focus();
                    }}
                  >
                    {sug}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            displayMessages.map(msg => {
              const isLastAiMsg = msg.role === 'assistant' && msg.id === messages[messages.length - 1]?.id;
              return (
                <ChatMessageRow
                  key={msg.id}
                  message={msg}
                  isStreamingMsg={isStreaming && isLastAiMsg}
                  onApproveImage={(url) => {
                    const approveMsg = `Adorei a imagem ${url}. Por favor, aplique ela no meu design usando [EDIT].`;
                    sendMessage(approveMsg);
                  }}
                  onRegenerateImage={(prompt) => {
                    const regenMsg = `Pode gerar outra imagem para esse prompt? "${prompt}"`;
                    sendMessage(regenMsg);
                  }}
                />
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
                <Sparkles size={13} className={s.questionHeaderIcon} />
                <span>{activeQuestion.question}</span>
              </div>
              {activeQuestion.helperText && (
                <p className={s.questionHelper}>{activeQuestion.helperText}</p>
              )}
              {activeQuestion.previewImages && activeQuestion.previewImages.length > 0 && (
                <div className={s.questionPreviewGrid}>
                  {activeQuestion.previewImages.map((img, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <div key={`${img.url}-${i}`} className={s.questionPreviewCard}>
                      <img src={img.url} alt={img.label} className={s.questionPreviewImg} />
                      <span className={s.questionPreviewLabel}>{img.label}</span>
                    </div>
                  ))}
                </div>
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
                    {opt.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={opt.imageUrl} alt={opt.label} className={s.questionOptionImg} />
                    )}
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

          {/* Marca de atividade — o progresso NUMÉRICO mora no preview, e só lá.
              Barra, percentual, etapa e "parar" apareciam aqui e lá ao mesmo tempo:
              o mesmo label renderizado duas vezes na tela, competindo por atenção.
              Aqui fica apenas o sinal de que a Fábrica está viva, sem repetir dado. */}
          {workerStatus === 'running' && (
            <div className={s.chatActivity} role="status">
              <Loader2 size={13} className={s.spin} />
              <span>Gerando…</span>
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
          {attachments.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
              {attachments.map((att, idx) => (
                <div key={`${att.name}-${idx}`} className={s.attachStrip}>
                  <Paperclip size={11} />
                  <span>{attachmentPreviewLabel(att)}</span>
                  <button
                    className={s.attachRemove}
                    aria-label={`Remover ${att.name}`}
                    onClick={() => { aplicarAnexos(attachmentsRef.current.filter((_, i) => i !== idx)); setAttachErro(null); }}
                  ><X size={11} /></button>
                </div>
              ))}
            </div>
          )}

          {attachErro && (
            <div role="status" style={{ fontSize: 12, color: 'var(--color-danger, #b91c1c)', marginBottom: 8 }}>
              {attachErro}
            </div>
          )}

          {asanaAttachments.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
              {asanaAttachments.map((att, idx) => (
                <div key={idx} className={s.attachStrip}>
                  <Paperclip size={11} style={{ color: '#8b5cf6' }} />
                  <span>{att.name}</span>
                  <button className={s.attachRemove} onClick={() => setAsanaAttachments(prev => prev.filter((_, i) => i !== idx))}><X size={11} /></button>
                </div>
              ))}
            </div>
          )}

          <div className={s.inputWrap}>
            {/* Slash command menu */}
            {showSlash && filteredSlash.length > 0 && (
              <div className={s.slashMenu} role="listbox">
                {filteredSlash.map((cmd, i) => (
                  <div
                    key={cmd.id}
                    className={`${s.slashItem} ${i === slashIdx ? s.slashActive : ''}`}
                    role="option"
                    aria-selected={i === slashIdx}
                    onMouseDown={e => { e.preventDefault(); applySlash(cmd.id); }}
                    onMouseEnter={() => setSlashIdx(i)}
                  >
                    <span className={s.slashLabel}>{cmd.label}</span>
                    <span className={s.slashDesc}>{cmd.desc}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Referências que a IA vai usar na geração — visíveis ANTES de
                gerar, junto dos demais controles de pré-envio (destino, anexo). */}
            <BrandBundlePanel slug={marca} />

            {/* Destino do deck, escolhido ANTES de gerar — sem isto ele nascia solto
                na raiz e só era achado caçando na galeria. */}
            <FolderPicker marca={marca} sessionId={sessionId} disabled={isStreaming || !canGenerate} />

            <div className={`${s.inputBar} ${!canGenerate ? s.inputBarDisabled : ''}`}>
              <button
                className={s.iconBtn}
                onClick={() => fileRef.current?.click()}
                title={canGenerate ? `Anexar arquivos (até ${MAX_ANEXOS})` : permHint}
                aria-label="Anexar arquivos"
                disabled={!canGenerate}
              >
                <Paperclip size={15} />
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,.pdf"
                className={s.visuallyHidden}
                onChange={handleFile}
              />
              <textarea
                ref={inputRef}
                className={s.inputField}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKey}
                aria-label="Mensagem para a fábrica"
                aria-describedby="fabricaInputHint"
                placeholder={
                  !canGenerate
                    ? 'Você não tem permissão para interagir com a fábrica nesta marca.'
                    : isStreaming
                    ? 'Gerando... digite algo para adicionar contexto em tempo real'
                    : messages.length === 0
                    ? 'Descreva o que você quer criar...'
                    : 'Refine ou peça ajustes... use / para comandos'
                }
                rows={1}
                disabled={!canGenerate}
              />
              <button
                className={`${s.sendBtn} ${canSend ? s.sendActive : ''}`}
                onClick={handleSend}
                disabled={!canSend}
                title={canGenerate ? undefined : permHint}
                aria-label="Enviar mensagem"
              >
                <ArrowUp size={15} />
              </button>
            </div>
          </div>

          <p className={s.inputHint} id="fabricaInputHint">
            {canGenerate
              ? 'Enter envia · Shift+Enter nova linha · / para comandos'
              : permHint}
          </p>
        </div>
      </aside>

      {/* ── Right panel: preview ───────────────────────────────────────────── */}
      <main className={s.previewPanel}>

        {/* Modo de revisão: configuração PERMANENTE da sessão. Morava dentro do
            card de notificação — some quando o card some, e o usuário perdia o
            controle sem entender por quê. Aqui fica sempre alcançável, ao lado do
            preview, que é onde a revisão de fato acontece. */}
        <div className={s.previewBar}>
          <span className={s.previewBarLabel}>Aprovação</span>
          <div className={s.modeToggle} role="group" aria-label="Modo de aprovação">
            <button
              type="button"
              className={`${s.modeBtn} ${reviewMode === 'auto' ? s.modeBtnOn : ''}`}
              onClick={() => setReviewMode('auto')}
              aria-pressed={reviewMode === 'auto'}
              title="A Fábrica aprova sozinha e segue"
            >
              Auto
            </button>
            <button
              type="button"
              className={`${s.modeBtn} ${reviewMode === 'manual' ? s.modeBtnOn : ''}`}
              onClick={() => setReviewMode('manual')}
              aria-pressed={reviewMode === 'manual'}
              title="Cada peça espera sua aprovação"
            >
              Manual
            </button>
          </div>
        </div>

        {/* Ancorado, não flutuante: como bloco no fluxo ele empurra o preview em
            vez de cobrir justamente a arte sobre a qual você precisa decidir. */}
        <NotificationCard
          notification={notification}
          marca={marca}
          postId={postId}
          onApprove={approve}
          onDecline={decline}
          onDismiss={clearNotification}
        />

        {currentDesign.length === 0 ? (
          <div className={s.previewEmpty}>
            <div className={s.previewEmptyGradient} />
            <div className={s.previewEmptyContent}>
              {workerStatus === 'running' ? (
                <div className={s.buildView} style={{ padding: 0 }}>
                  <RealtimePreview messages={messages} isGenerating={true} />
                  
                  <div className={s.previewProgressWrap} style={{ position: 'absolute', bottom: 16, left: 16, right: 16, zIndex: 10 }}>
                    <div className={s.previewProgressBar} style={{ width: `${Math.max(4, progress)}%` }} />
                  </div>
                  <p className={s.previewProgressLabel} style={{ position: 'absolute', bottom: 32, left: 16, zIndex: 10, color: '#333', background: 'rgba(255,255,255,0.8)', padding: '2px 8px', borderRadius: 4 }}>
                    {progressLabel || 'Preparando...'} · {progress}%
                  </p>
                  
                  <button
                    type="button"
                    className={s.previewCancelBtn}
                    onClick={cancelGeneration}
                    title="Parar geração"
                    style={{ position: 'absolute', top: 16, right: 16, zIndex: 10 }}
                  >
                    Parar Geração
                  </button>
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
          <ArtifactPanel
            design={currentDesign[0]}
            postId={postId}
            slideIndex={safeSlide}
            slideCount={slideCount}
            gerando={workerStatus === 'running'}
            onSlideCodeSaved={applySlideLocal}
          >
          <div className={s.previewContent}>
            {/* Progress overlay during update */}
            {workerStatus === 'running' && (
              <div className={s.previewTopBar}>
                <div className={s.previewTopProgress} style={{ width: `${progress}%` }} />
              </div>
            )}

            {/* Save status badge */}
            {saveStatus && (
              <div className={`${s.saveBadge} ${saveStatus === 'saving' ? s.saveBadgeSaving : s.saveBadgeSaved}`}>
                {saveStatus === 'saving' ? (
                  <>
                    <Loader2 size={12} className={s.saveBadgeSpin} />
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
              {activeSlideMissing ? (
                <div className={s.slideSkeleton} key={`skeleton-${safeSlide}`}>
                  <div className={s.slideSkeletonShimmer} />
                  <span className={s.slideSkeletonLabel}>Gerando slide {safeSlide + 1}…</span>
                </div>
              ) : isHtmlDesign ? (
                <HtmlSlideRenderer
                  // key força remount por slide: dispara a transição de entrada
                  // (fade/scale) do CSS a cada slide novo em vez de um "pop" instantâneo.
                  key={`slide-${safeSlide}`}
                  content={currentDesign[0] as unknown as HtmlDesignPostContent}
                  activeSlide={safeSlide}
                  hideNav
                />
              ) : null}
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
          </ArtifactPanel>
        )}
      </main>

      <BrandbookUploaderModal
        slug={marca}
        isOpen={showBrandbook}
        onClose={() => setShowBrandbook(false)}
        onSuccess={(data) => {
          setBtwContext((prev) => [
            ...prev,
            `Brandbook atualizado via upload (${data.svgsIndexed.total} SVGs indexados, cores: ${data.colors.join(', ')})`,
          ]);
        }}
      />
    </div>
  );
}
