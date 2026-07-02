'use client';

import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { useRouter } from 'next/navigation';
import { useBrainSession, type AuditResult, type BrainPhase } from '@/hooks/useBrainSession';
import { BrainMessage } from './BrainMessage';
import { StructurePanel } from './StructurePanel';
import DesignRenderer, { DesignPage } from '@/components/Fabrica/DesignRenderer';
import HtmlSlideRenderer from '@/components/DesignDocument/HtmlSlideRenderer';
import { type HtmlDesignPostContent } from '@/lib/designContent';
import { AsanaPopup } from '@/components/Fabrica/AsanaPopup';
import s from './fabrica-chat.module.css';

const PHASE_LABELS: Record<string, string> = {
  listening: 'Escutando',
  clarifying: 'Refinando briefing',
  ready: 'Preparando geração',
  running: 'Gerando',
  reviewing: 'Revisando',
  revising: 'Corrigindo',
  done: 'Concluído',
  error: 'Erro',
};

const PHASES_ORDER = [
  'listening',
  'clarifying',
  'ready',
  'running',
  'reviewing',
  'revising',
  'done',
];

const GENERATING_PHASES: BrainPhase[] = ['ready', 'running', 'reviewing', 'revising'];

function WaitUX({ phase, workerProgress }: { phase: BrainPhase, workerProgress: number }) {
  const [msgIdx, setMsgIdx] = useState(0);
  const msgs = [
    "Analisando referências e estruturando o design...",
    "Pensando na melhor forma de distribuir o conteúdo...",
    "Aplicando a identidade visual da marca...",
    "Revisando proporções e alinhamentos...",
    "Quase lá, finalizando a geração...",
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setMsgIdx(i => (i + 1) % msgs.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [msgs.length]);

  return (
    <div className={s.brainRow}>
      <div className={s.brainAvatar}>
        <svg className={s.brainAvatarIcon} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
        </svg>
      </div>
      <div className={s.brainContent}>
        <p className={s.brainText} style={{ opacity: 0.8, fontStyle: 'italic' }}>
          {msgs[msgIdx]} <span className={s.streamingDot} />
        </p>
        {workerProgress > 0 && (
          <div style={{ marginTop: 8, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Progresso: {Math.round(workerProgress)}% ({PHASE_LABELS[phase] ?? phase})
          </div>
        )}
      </div>
    </div>
  );
}

interface Props {
  brandSlug: string;
  brandName: string;
  marca: string;
}

export function FabricaChat({ brandSlug, brandName, marca }: Props) {
  const router = useRouter();
  const {
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
  } = useBrainSession({ brandSlug });

  const [input, setInput] = useState('');
  const [rightTab, setRightTab] = useState<'preview' | 'structure'>('structure');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [showAsana, setShowAsana] = useState(false);
  
  const [inspectorMode, setInspectorMode] = useState(false);
  const [selectedElements, setSelectedElements] = useState<any[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isStreaming]);

  // Track scroll position for scroll-to-bottom FAB
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const handleScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollBtn(distanceFromBottom > 120);
    };
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input]);

  // Pula pra aba de preview apenas quando os slides ficam prontos
  useEffect(() => {
    if (pages.length > 0) {
      setRightTab('preview');
      setIsRightPanelOpen(true);
    }
  }, [pages.length]);

  // Atalho global Ctrl+A / Cmd+A para Asana
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Permitir que Ctrl+A funcione nativamente dentro de inputs e textareas para "Selecionar tudo"
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setShowAsana(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Inspector Mode listener
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'ELEMENT_SELECTED') {
        const elData = event.data.data;
        setSelectedElements(prev => {
          // Avoid duplicates by identifier
          if (prev.some(el => el.identifier === elData.identifier)) return prev;
          return [...prev, elData];
        });
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    
    if (text === '/edit') {
      setInspectorMode(prev => !prev);
      setInput('');
      return;
    }

    if (text === '/editor') {
      const postId = structure.worker?.postId;
      if (postId) {
        router.push(`/${marca}/editor/${postId}`);
      }
      setInput('');
      return;
    }

    let finalText = text;
    if (selectedElements.length > 0) {
      const elementsContext = selectedElements.map((el, i) => 
        `[Elemento #${i + 1} - ${el.identifier}]`
      ).join(', ');
      finalText = `Elementos referenciados: ${elementsContext}\n\n${text}`;
      setSelectedElements([]);
      setInspectorMode(false);
    }

    setInput('');
    sendMessage(finalText);
  }, [input, isStreaming, sendMessage, selectedElements]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleFormSubmit(formId: string, response: string) {
    submitForm(formId, response);
  }

  const currentPhaseIdx = PHASES_ORDER.indexOf(phase);
  const lastMessage = messages[messages.length - 1];
  const isWaitingForForm = lastMessage?.role === 'brain' && !!lastMessage.form;

  return (
    <div className={s.root}>
      {/* ── Overlay Mobile ──────────────────────────────────────────────── */}
      {(isSidebarOpen || isRightPanelOpen) && (
        <div 
          className={s.mobileOverlay} 
          onClick={() => {
            setIsSidebarOpen(false);
            setIsRightPanelOpen(false);
          }} 
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className={`${s.sidebar} ${isSidebarOpen ? s.open : ''}`}>
        <div className={s.sidebarHeader}>
          <div className={s.sidebarLogo}>
            <div className={s.brainAvatar} style={{ width: 24, height: 24, borderRadius: 6 }}>
              <svg width={12} height={12} viewBox="0 0 20 20" fill="white">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <div className={s.sidebarBrand}>Designer IA</div>
              <div className={s.sidebarMeta}>{brandName}</div>
            </div>
          </div>
        </div>

        <div className={s.sidebarBody}>
          <div className={s.sidebarSection}>
            <div className={s.sidebarSectionLabel}>Processo</div>
            <div className={s.phaseList}>
              {PHASES_ORDER.map((p, idx) => {
                const state =
                  idx < currentPhaseIdx ? 'done'
                  : idx === currentPhaseIdx ? 'active'
                  : 'pending';
                return (
                  <div
                    key={p}
                    className={`${s.phaseItem} ${state === 'active' ? s.active : ''} ${state === 'done' ? s.done : ''}`}
                  >
                    <span className={s.phaseDot} />
                    {PHASE_LABELS[p] ?? p}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </aside>

      {/* ── Chat ────────────────────────────────────────────────────────── */}
      <main className={s.chat}>
        <div className={s.chatHeader}>
          <div className={s.chatHeaderLeft}>
            <button className={s.mobileMenuBtn} onClick={() => setIsSidebarOpen(true)}>
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <span className={s.chatTitle}>Agente Cérebro</span>
            <span className={`${s.chatPhase} ${phase === 'listening' ? s.idle : ''}`}>
              {PHASE_LABELS[phase] ?? phase}
            </span>
          </div>
          <div className={s.chatHeaderRight}>
            <button className={s.mobileMenuBtn} onClick={() => setIsRightPanelOpen(true)}>
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="15" y1="3" x2="15" y2="21" />
              </svg>
            </button>
          </div>
        </div>

        <div className={s.thread} ref={threadRef}>
          {messages.length === 0 ? (
            <div className={s.emptyState}>
              <svg className={s.emptyIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
              </svg>
              <p className={s.emptyTitle}>O que você quer criar?</p>
              <p className={s.emptySubtitle}>
                Descreva a peça que você precisa — carrossel, apresentação, proposta — e o agente conduz o processo.
              </p>
              <div className={s.suggestionChips}>
                {[
                  'Carrossel para Instagram',
                  'Apresentação comercial',
                  'Post de lançamento',
                  'Stories animados',
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    className={s.suggestionChip}
                    onClick={() => {
                      setInput(suggestion);
                      textareaRef.current?.focus();
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => {
              const isLast = idx === messages.length - 1;

              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className={s.userRow}>
                    <div className={s.userBubble}>{msg.content}</div>
                  </div>
                );
              }

              if (msg.role === 'brain') {
                return (
                  <BrainMessage
                    key={msg.id}
                    message={msg}
                    isStreaming={isLast && isStreaming}
                    onFormSubmit={handleFormSubmit}
                  />
                );
              }

              return null;
            })
          )}
          
          {(workerStatus === 'running' || GENERATING_PHASES.includes(phase)) && pages.length === 0 && (
            <WaitUX phase={phase} workerProgress={workerProgress} />
          )}
        </div>

        {showScrollBtn && messages.length > 0 && (
          <button
            className={s.scrollFab}
            onClick={() => {
              const el = threadRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            }}
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
        {error && (
          <div className={s.errorToast}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Input */}
        {isWaitingForForm ? (
          <div className={s.inputAreaDisabled}>
            <p>👆 Selecione uma das opções acima para continuar</p>
          </div>
        ) : (
          <div className={s.inputArea}>
            {inspectorMode && (
              <div style={{ padding: '8px 12px', background: 'rgba(255, 107, 53, 0.1)', color: '#FF6B35', fontSize: '0.85rem', borderRadius: 8, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l5.5 5.5-5.5-5.5zm-8 0L1.5 20.5 7 15zm8-8l5.5-5.5L15 7zm-8 0L1.5 1.5 7 7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  Modo Inspecionar Ativo: Clique nos elementos do painel direito para selecioná-los.
                </div>
                <button onClick={() => setInspectorMode(false)} style={{ background: 'none', border: 'none', color: '#FF6B35', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>Desativar</button>
              </div>
            )}
            {selectedElements.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {selectedElements.map((el, i) => (
                  <div key={el.identifier} style={{ padding: '4px 8px', background: 'var(--bg-layer)', border: '1px solid var(--border)', borderRadius: 12, fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 600 }}>#{i + 1}</span> {el.tagName} {el.identifier.replace(el.tagName, '')}
                    <button 
                      onClick={() => setSelectedElements(prev => prev.filter(p => p.identifier !== el.identifier))}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className={s.inputBox}>
              <textarea
                ref={textareaRef}
                className={s.input}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="O que você quer criar hoje? (/edit para inspecionar, /editor para abrir editor)"
                disabled={isStreaming}
                rows={1}
              />
              <button
                className={s.sendBtn}
                onClick={handleSend}
                disabled={!input.trim() || isStreaming}
              >
                {isStreaming ? (
                  <div className={s.btnSpinner} />
                ) : (
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                )}
              </button>
            </div>
            <div className={s.inputHint}>Enter para enviar · Shift+Enter para quebrar linha</div>
          </div>
        )}
      </main>

      {/* ── Asana Popup ─────────────────────────────────────────────────── */}
      {showAsana && (
        <AsanaPopup
          onClose={() => setShowAsana(false)}
          onInject={(text) => {
            setInput(prev => prev ? `${prev}\n\n${text}` : text);
            // Dá um pequeno atraso para focar após fechar o modal
            setTimeout(() => textareaRef.current?.focus(), 50);
          }}
        />
      )}

      {/* ── Painel direito ───────────────────────────────────────────────── */}
      <aside className={`${s.rightPanel} ${isRightPanelOpen ? s.open : ''}`}>
        <div className={s.rightTabs}>
          <button
            className={`${s.rightTab} ${rightTab === 'preview' ? s.active : ''}`}
            onClick={() => setRightTab('preview')}
          >
            <svg className={s.rightTabIcon} viewBox="0 0 16 16" fill="currentColor">
              <path d="M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z" />
              <path d="M0 8s3-5.5 8-5.5S16 8 16 8s-3 5.5-8 5.5S0 8 0 8zm8 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
            </svg>
            Preview
          </button>
          <button
            className={`${s.rightTab} ${rightTab === 'structure' ? s.active : ''}`}
            onClick={() => setRightTab('structure')}
          >
            <svg className={s.rightTabIcon} viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zm8 0A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zm-8 8A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zm8 0A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3z" />
            </svg>
            Estrutura
          </button>
        </div>

        <div className={s.rightPanelBody}>
          {rightTab === 'preview' ? (
            <PreviewTab
              pages={pages}
              postId={structure.worker?.postId}
              marca={marca}
              router={router}
              phase={phase}
              workerProgress={workerProgress}
              slideCount={structure.brief?.slideCount ?? structure.brief?.outlineCount ?? 0}
              audit={structure.audit}
              inspectorMode={inspectorMode}
            />
          ) : (
            <StructurePanel
              structure={structure}
              workerProgress={workerProgress}
            />
          )}
        </div>
      </aside>
    </div>
  );
}

// ── Preview Tab ───────────────────────────────────────────────────────────────

const PreviewTab = memo(function PreviewTab({
  pages,
  postId,
  marca,
  router,
  phase,
  workerProgress,
  slideCount,
  audit,
  inspectorMode,
}: {
  pages: unknown[];
  postId?: string;
  marca: string;
  router: ReturnType<typeof useRouter>;
  phase: BrainPhase;
  workerProgress: number;
  slideCount: number;
  audit?: AuditResult;
  inspectorMode?: boolean;
}) {
  const [previewSlide, setPreviewSlide] = useState(0);

  const designPages = pages as DesignPage[];
  const htmlDesign = (pages[0] as { kind?: string } | undefined)?.kind === 'html-design'
    ? (pages[0] as unknown as HtmlDesignPostContent)
    : null;

  const count = htmlDesign ? htmlDesign.slides.length : designPages.length;

  // Garantir que previewSlide não exceda o tamanho (se o post mudar)
  useEffect(() => {
    if (previewSlide >= count && count > 0) {
      setPreviewSlide(count - 1);
    }
  }, [count, previewSlide]);

  if (pages.length === 0) {
    return (
      <div className={s.previewEmpty}>
        <svg className={s.previewEmptyIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
        </svg>
        <p className={s.previewEmptyText}>
          O preview vai aparecer aqui quando o worker terminar de criar os slides.
        </p>
      </div>
    );
  }

  const canvasWidth = htmlDesign ? htmlDesign.width : (designPages[0]?.width || 1080);
  const canvasHeight = htmlDesign ? htmlDesign.height : (designPages[0]?.height || 1350);

  return (
    <div className={s.previewWrapper}>
      <div className={s.previewCanvas}>
        {htmlDesign ? (
          <HtmlSlideRenderer
            content={htmlDesign}
            activeSlide={Math.min(previewSlide, count - 1)}
            hideNav
            mode="contain"
            inspectorMode={inspectorMode}
          />
        ) : (
          <DesignRenderer
            pages={[designPages[Math.min(previewSlide, count - 1)] ?? designPages[0]]}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
            mode="contain"
          />
        )}

        {count > 1 && (
          <div className={s.slideNav}>
            <button
              className={s.slideNavBtn}
              onClick={() => setPreviewSlide(i => Math.max(0, i - 1))}
              disabled={previewSlide === 0}
            >‹</button>
            <span className={s.slideNavLabel}>
              {Math.min(previewSlide, count - 1) + 1} / {count}
            </span>
            <button
              className={s.slideNavBtn}
              onClick={() => setPreviewSlide(i => Math.min(count - 1, i + 1))}
              disabled={previewSlide >= count - 1}
            >›</button>
          </div>
        )}
      </div>



      <div className={s.previewActions}>
        {postId && (
          <button
            className={`${s.previewBtn} ${s.primary}`}
            onClick={() => router.push(`/${marca}/editor/${postId}`)}
          >
            Editar no editor
          </button>
        )}
        <button
          className={s.previewBtn}
          onClick={() => router.push(`/${marca}/editor`)}
        >
          Ver galeria
        </button>
      </div>
    </div>
  );
});
