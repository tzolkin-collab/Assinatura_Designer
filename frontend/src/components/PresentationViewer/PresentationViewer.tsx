'use client';

// Casca de apresentação pública (Fase 5, Fatia 1 — navegação; Fatia 2 — palco ao
// vivo). Reaproveita o HtmlSlideRenderer tal como é: o conteúdo de cada slide já
// é o HTML/CSS estático sanitizado de sempre, sem nenhuma mudança no
// gerador/sanitizador pra esta fatia. A "interatividade" aqui é navegação —
// botões, teclado, autoplay, tela cheia — construída uma vez em React, nunca JS
// gerado pela IA.
//
// Menu num canto (em vez de barra ocupando a largura toda): numa apresentação
// ao vivo a tela do apresentador costuma ser ESPELHADA pro projetor/TV — tudo
// que aparece nela, a plateia vê junto, em tempo real. Uma barra full-width
// clicável parece "chrome de app" mesmo em tela cheia; um menu discreto no
// canto some no fundo escuro quando não está em uso.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, MessageCircle, Maximize, Maximize2, Minimize, Pause, Play, Send, Share2, X } from 'lucide-react';
import type { HtmlDesignPostContent } from '@/lib/designContent';
import {
  fetchPresentationChat,
  submitPresentationQuestion,
  togglePresentationChat,
  type HostingConfig,
  type PresentationChatMessage,
} from '@/lib/presentationHosting';
import { getApiErrorMessage } from '@/lib/api';
import dynamic from 'next/dynamic';
import styles from './PresentationViewer.module.css';

const HtmlSlideRenderer = dynamic(() => import('@/components/DesignDocument/HtmlSlideRenderer'), { ssr: false });

const AUTOPLAY_INTERVAL_MS = 6000;
const CHAT_POLL_MS = 3000;

export interface PresentationViewerProps {
  name: string | null;
  content: HtmlDesignPostContent;
  hostingConfig: HostingConfig;
  /** Slug público — necessário só pro compartilhar/QR e pro chat ao vivo. */
  slug?: string;
  /** true quando quem abriu é o próprio designer logado, dono da marca. */
  isOwner?: boolean;
  /** Só vem quando isOwner — precisa pra ligar/desligar o chat. */
  postId?: string;
  chatEnabledInitial?: boolean;
}

/** Fecha um popover ancorado a um botão sem fechar no MESMO clique que abriu —
 *  o popover nasce por cima de onde o dedo/mouse está, então um listener
 *  síncrono capturaria o próprio clique de abertura. Um tick de atraso resolve.
 *  Recebe o setState direto (estável entre renders) em vez de um callback
 *  inline, senão o efeito reagendaria o listener a cada re-render do pai. */
function useCloseOnOutsideClick(open: boolean, setOpen: (v: boolean) => void) {
  useEffect(() => {
    if (!open) return;
    function onPointerDown() { setOpen(false); }
    const t = setTimeout(() => document.addEventListener('pointerdown', onPointerDown, { once: true }), 0);
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', onPointerDown); };
  }, [open, setOpen]);
}

export default function PresentationViewer({
  name, content, hostingConfig, slug, isOwner, postId, chatEnabledInitial,
}: PresentationViewerProps) {
  const slideCount = content.slides?.length ?? 0;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(!!hostingConfig.autoplay);
  const [fullscreen, setFullscreen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // ── Compartilhar (link + QR) — pego de DENTRO da apresentação em execução,
  // igual ao Meet: você abre a call e só então pega o link pra convidar, em vez
  // de caçar numa tela de config separada. Só o autor vê este botão. ──────────
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [shareQr, setShareQr] = useState<string | null>(null);
  const [shareCopiado, setShareCopiado] = useState(false);
  const [qrExpanded, setQrExpanded] = useState(false);

  // Menu do canto some fora da tela e só entra quando o mouse chega perto da
  // borda esquerda (igual à Sidebar do app) — mas continua visível enquanto um
  // popover dele estiver aberto, mesmo que o mouse se afaste pra apontar pro
  // slide (senão o popover sumiria com o menu no meio da leitura). Ver
  // `menuVisible` mais abaixo, depois que `chatPanelOpen` existe.
  const [zoneHover, setZoneHover] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') setShareUrl(window.location.href);
  }, []);

  useEffect(() => {
    if (!shareOpen || !shareUrl) return;
    let cancelled = false;
    import('qrcode').then(({ default: QRCode }) =>
      QRCode.toDataURL(shareUrl, { margin: 1, width: 480 }),
    ).then((dataUrl) => { if (!cancelled) setShareQr(dataUrl); })
      .catch(() => { if (!cancelled) setShareQr(null); });
    return () => { cancelled = true; };
  }, [shareOpen, shareUrl]);

  const handleCopyShareUrl = () => {
    navigator.clipboard?.writeText(shareUrl).then(() => {
      setShareCopiado(true);
      setTimeout(() => setShareCopiado(false), 1500);
    }).catch(() => {});
  };

  const shareWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!shareOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (shareWrapRef.current && !shareWrapRef.current.contains(e.target as Node)) setShareOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [shareOpen]);

  useCloseOnOutsideClick(qrExpanded, setQrExpanded);

  // ── Chat de perguntas da plateia — efêmero, opt-in pelo palestrante. Some da
  // interface da plateia inteiramente quando desligado (nunca um campo vazio
  // "esperando" pra ninguém usar). ─────────────────────────────────────────────
  const [chatEnabled, setChatEnabled] = useState(!!chatEnabledInitial);
  const [chatMessages, setChatMessages] = useState<PresentationChatMessage[]>([]);
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const menuVisible = zoneHover || shareOpen || chatPanelOpen;
  const [seenCount, setSeenCount] = useState(0);
  const [togglingChat, setTogglingChat] = useState(false);
  const [questionText, setQuestionText] = useState('');
  const [questionSending, setQuestionSending] = useState(false);
  const [questionSent, setQuestionSent] = useState(false);
  const [questionErro, setQuestionErro] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    const poll = () => {
      fetchPresentationChat(slug).then((state) => {
        if (cancelled) return;
        setChatEnabled(state.enabled);
        if (isOwner) setChatMessages(state.messages);
      }).catch(() => {});
    };
    poll();
    const t = setInterval(poll, CHAT_POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [slug, isOwner]);

  const unreadCount = Math.max(0, chatMessages.length - seenCount);

  const handleOpenChatPanel = () => {
    setChatPanelOpen((o) => !o);
    setSeenCount(chatMessages.length);
  };

  const handleToggleChat = async () => {
    if (!postId) return;
    setTogglingChat(true);
    try {
      const { enabled } = await togglePresentationChat(postId, !chatEnabled);
      setChatEnabled(enabled);
    } catch {
      // Falha silenciosa aqui é aceitável — o próximo polling (3s) corrige
      // sozinho o estado exibido se o toggle não tiver realmente aplicado.
    } finally {
      setTogglingChat(false);
    }
  };

  const handleSubmitQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug || !questionText.trim()) return;
    setQuestionSending(true);
    setQuestionErro(null);
    try {
      await submitPresentationQuestion(slug, questionText.trim());
      setQuestionText('');
      setQuestionSent(true);
      setTimeout(() => setQuestionSent(false), 2500);
    } catch (err) {
      setQuestionErro(getApiErrorMessage(err, 'Não foi possível enviar.'));
    } finally {
      setQuestionSending(false);
    }
  };

  const chatWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!chatPanelOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (chatWrapRef.current && !chatWrapRef.current.contains(e.target as Node)) setChatPanelOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [chatPanelOpen]);

  // ── Navegação ────────────────────────────────────────────────────────────
  const safeIndex = Math.min(Math.max(index, 0), Math.max(0, slideCount - 1));

  const goTo = useCallback((i: number) => {
    setIndex(Math.min(Math.max(i, 0), Math.max(0, slideCount - 1)));
  }, [slideCount]);

  const next = useCallback(() => goTo(safeIndex + 1), [goTo, safeIndex]);
  const prev = useCallback(() => goTo(safeIndex - 1), [goTo, safeIndex]);

  // Foco inicial no container: sem isto, o primeiro Tab/clique tende a focar o
  // iframe do slide (documento separado) e os atalhos de teclado abaixo nunca
  // mais recebem evento nenhum no window pai.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  // Atalhos de teclado — seta/espaço avança, seta esquerda volta, F alterna tela cheia.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && qrExpanded) { e.preventDefault(); setQrExpanded(false); return; }
      if (qrExpanded) return; // QR ampliado ocupa a tela — não navega slide por baixo.
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFullscreen(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, prev, qrExpanded]);

  // Autoplay: para sozinho no último slide (não faz loop — evitar surpresa numa
  // apresentação institucional que "recomeça sozinha" sem avisar).
  useEffect(() => {
    if (!playing) return;
    if (safeIndex >= slideCount - 1) { setPlaying(false); return; }
    const t = setTimeout(next, AUTOPLAY_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [playing, safeIndex, slideCount, next]);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      rootRef.current?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  if (slideCount === 0) {
    return (
      <div className={styles.empty}>
        <p>Esta apresentação ainda não tem slides.</p>
      </div>
    );
  }

  const showChatIcon = isOwner || chatEnabled;

  return (
    <div className={styles.root} ref={rootRef} tabIndex={-1}>
      <div className={styles.stage}>
        <HtmlSlideRenderer content={content} activeSlide={safeIndex} hideNav />
        {/* Slide é um iframe estático (sem interação própria nesta fatia) — sem
            este captador de clique, um clique no slide move o foco do teclado
            PRA DENTRO do iframe (documento separado), e o keydown de navegação
            do viewer para de chegar no window pai. */}
        <div
          className={styles.clickCatcher}
          onClick={() => rootRef.current?.focus()}
        />

        {/* Zona de hover — invisível, só existe pra detectar "mouse perto da
            borda esquerda" numa faixa mais larga que o menu em si (senão fica
            difícil de "encontrar" o menu escondido). */}
        <div
          className={styles.cornerMenuZone}
          onMouseEnter={() => setZoneHover(true)}
          onMouseLeave={() => setZoneHover(false)}
          onClick={() => rootRef.current?.focus()}
        >
        {/* Menu do canto — some fora da tela por padrão (ver comentário no topo do arquivo). */}
        <div className={[styles.cornerMenu, menuVisible ? styles.cornerMenuVisible : ''].join(' ')}>
          <button
            type="button"
            className={styles.cornerBtn}
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? 'Pausar apresentação automática' : 'Reproduzir apresentação automática'}
            title={playing ? 'Pausar' : 'Reproduzir automaticamente'}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>

          <button
            type="button"
            className={styles.cornerBtn}
            onClick={toggleFullscreen}
            aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            title={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
          >
            {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>

          {isOwner && (
            <div className={styles.cornerItemWrap} ref={shareWrapRef}>
              <button
                type="button"
                className={styles.cornerBtn}
                onClick={() => setShareOpen((o) => !o)}
                aria-label="Compartilhar"
                title="Compartilhar"
              >
                <Share2 size={16} />
              </button>

              {shareOpen && (
                <div className={styles.sidePopover}>
                  <span className={styles.sidePopoverTitle}>Convidar pra esta apresentação</span>
                  <div className={styles.shareUrlRow}>
                    <span className={styles.shareUrlText}>{shareUrl}</span>
                    <button type="button" className={styles.shareCopyBtn} onClick={handleCopyShareUrl} title="Copiar link">
                      {shareCopiado ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                  {shareQr && (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={shareQr} alt="QR code desta apresentação" width={144} height={144} className={styles.shareQrImage} />
                      <button type="button" className={styles.shareExpandBtn} onClick={() => { setQrExpanded(true); setShareOpen(false); }}>
                        <Maximize2 size={13} /> Ampliar QR pra plateia
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {showChatIcon && (
            <div className={styles.cornerItemWrap} ref={chatWrapRef}>
              <button
                type="button"
                className={styles.cornerBtn}
                onClick={handleOpenChatPanel}
                aria-label="Perguntas da plateia"
                title="Perguntas da plateia"
              >
                <MessageCircle size={16} />
                {isOwner && unreadCount > 0 && <span className={styles.chatBadge}>{unreadCount > 9 ? '9+' : unreadCount}</span>}
              </button>

              {chatPanelOpen && (
                <div className={styles.sidePopover}>
                  {isOwner ? (
                    <>
                      <div className={styles.chatToggleRow}>
                        <span className={styles.sidePopoverTitle}>Perguntas da plateia</span>
                        <button
                          type="button"
                          className={[styles.chatSwitch, chatEnabled ? styles.chatSwitchOn : ''].join(' ')}
                          onClick={handleToggleChat}
                          disabled={togglingChat}
                          role="switch"
                          aria-checked={chatEnabled}
                          aria-label={chatEnabled ? 'Desativar perguntas' : 'Ativar perguntas'}
                        >
                          <span className={styles.chatSwitchKnob} />
                        </button>
                      </div>
                      <p className={styles.chatHint}>
                        {chatEnabled ? 'Ativado — a plateia pode mandar perguntas.' : 'Desativado — ninguém vê a caixa de pergunta.'}
                      </p>
                      <div className={styles.chatMessages}>
                        {chatMessages.length === 0 ? (
                          <p className={styles.chatEmpty}>Nenhuma pergunta ainda.</p>
                        ) : (
                          [...chatMessages].reverse().map((m) => (
                            <div key={m.id} className={styles.chatMessage}>{m.text}</div>
                          ))
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <span className={styles.sidePopoverTitle}>Fazer uma pergunta</span>
                      <form onSubmit={handleSubmitQuestion} className={styles.chatForm}>
                        <textarea
                          className={styles.chatTextarea}
                          value={questionText}
                          onChange={(e) => setQuestionText(e.target.value)}
                          placeholder="Digite sua pergunta pro palestrante…"
                          maxLength={500}
                          rows={3}
                        />
                        {questionErro && <p className={styles.chatError}>{questionErro}</p>}
                        {questionSent && <p className={styles.chatSentHint}>Pergunta enviada!</p>}
                        <button type="submit" className={styles.chatSendBtn} disabled={questionSending || !questionText.trim()}>
                          <Send size={13} /> {questionSending ? 'Enviando…' : 'Enviar'}
                        </button>
                      </form>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        </div>
      </div>

      <footer className={styles.footer}>
        <span>{name ?? 'Apresentação'}</span>
        <span className={styles.brand}>Feito com Assinatura Designer</span>
      </footer>

      {qrExpanded && shareQr && (
        <div className={styles.qrFullscreen}>
          <button
            type="button"
            className={styles.qrFullscreenClose}
            onClick={(e) => { e.stopPropagation(); setQrExpanded(false); }}
            aria-label="Fechar"
          >
            <X size={20} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shareQr} alt="QR code desta apresentação, ampliado" className={styles.qrFullscreenImage} />
          <span className={styles.qrFullscreenUrl}>{shareUrl}</span>
        </div>
      )}
    </div>
  );
}
