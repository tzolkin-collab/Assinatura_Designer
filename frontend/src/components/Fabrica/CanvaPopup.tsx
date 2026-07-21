'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, X, ImageOff, Search, AlertCircle } from 'lucide-react';
import { API_BASE } from '@/lib/api';
import styles from './connectorPopup.module.css';

export interface CanvaDesign {
  id: string;
  title?: string;
  urls?: {
    edit_url?: string;
    view_url?: string;
  };
  thumbnail?: {
    url?: string;
  };
  page_count?: number;
  updated_at?: number;
}

interface Props {
  onClose: () => void;
  onInject: (text: string) => void;
  /** Quando fornecido, o clique num design chama isto em vez de injetar texto
   *  no chat — usado fora da Fábrica (ex: biblioteca de mídia, que importa o
   *  design escolhido pro pool de assets em vez de referenciá-lo em conversa).
   *  O popup espera a Promise: mostra o spinner NO card clicado e só fecha
   *  sozinho se der certo — erro fica visível pro usuário tentar de novo. */
  onSelectDesign?: (design: CanvaDesign) => Promise<void> | void;
}

const getToken = () =>
  typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;

const authHeaders = (): Record<string, string> => {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

function formatUpdated(unixSeconds: number | undefined): string {
  if (!unixSeconds) return '';
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export function CanvaPopup({ onClose, onInject, onSelectDesign }: Props) {
  const [status, setStatus] = useState<'loading' | 'connected' | 'disconnected' | 'error'>('loading');
  const [designs, setDesigns] = useState<CanvaDesign[]>([]);
  const [loadingDesigns, setLoadingDesigns] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [continuation, setContinuation] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [importingId, setImportingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  const fetchDesigns = useCallback(async (query: string, cont?: string) => {
    const params = new URLSearchParams();
    if (query) params.set('query', query);
    if (cont) params.set('continuation', cont);
    const qs = params.toString();
    const r = await fetch(`${API_BASE}/canva/designs${qs ? `?${qs}` : ''}`, { headers: authHeaders() });
    return r.json() as Promise<{ designs?: CanvaDesign[]; continuation?: string }>;
  }, []);

  const loadFirstPage = useCallback((query: string) => {
    setLoadingDesigns(true);
    setErrorId(null);
    fetchDesigns(query)
      .then((d) => {
        setDesigns(d.designs ?? []);
        setContinuation(d.continuation);
        setStatus('connected');
      })
      .catch(() => setStatus('error'))
      .finally(() => setLoadingDesigns(false));
  }, [fetchDesigns]);

  useEffect(() => {
    fetch(`${API_BASE}/canva/status`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d: { data?: { connected?: boolean } }) => {
        if (!d.data?.connected) {
          setStatus('disconnected');
          return;
        }
        loadFirstPage('');
      })
      .catch(() => setStatus('error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Busca com debounce — refaz a primeira página a cada digitação, como Drive/Asana.
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (status !== 'connected' && status !== 'loading') return;
    if (status === 'loading') return;
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => loadFirstPage(search), 350);
    return () => clearTimeout(searchDebounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const loadMore = async () => {
    if (!continuation || loadingMore) return;
    setLoadingMore(true);
    try {
      const d = await fetchDesigns(search, continuation);
      setDesigns((prev) => [...prev, ...(d.designs ?? [])]);
      setContinuation(d.continuation);
    } catch {
      // silencioso: o botão "carregar mais" continua disponível pra nova tentativa
    } finally {
      setLoadingMore(false);
    }
  };

  const handleConnectCanva = async () => {
    try {
      const res = await fetch(`${API_BASE}/canva/auth-url`, { headers: authHeaders() });
      const data = await res.json();
      if (data.data?.authUrl) {
        window.location.href = data.data.authUrl;
      } else {
        alert('Não foi possível obter a URL de autenticação do Canva.');
      }
    } catch (err) {
      console.error(err);
      alert('Falha ao iniciar conexão com Canva.');
    }
  };

  const handleSelectDesign = async (design: CanvaDesign) => {
    if (importingId) return; // um import por vez
    if (!onSelectDesign) {
      const editUrl = design.urls?.edit_url || design.urls?.view_url || '';
      const text = `[Contexto Canva]\nDesign: "${design.title || 'Sem título'}"\nID: ${design.id}\nLink: ${editUrl}`;
      onInject(text);
      onClose();
      return;
    }

    setImportingId(design.id);
    setErrorId(null);
    try {
      await onSelectDesign(design);
      onClose();
    } catch (err) {
      console.error('[CanvaPopup] Falha ao importar design:', err);
      setErrorId(design.id);
    } finally {
      setImportingId(null);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`${styles.popup} ${styles.popupWide}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerTitleGroup}>
            <div className={styles.headerIconBadge} style={{ background: '#f2ecff' }}>
              <img src="/icons/canva.svg" width={16} height={16} alt="" />
            </div>
            <span className={styles.headerTitle}>Canva</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {status === 'loading' && (
          <div className={styles.center}>
            <Loader2 size={22} className={styles.spin} style={{ color: 'var(--color-text-tertiary)' }} />
          </div>
        )}

        {status === 'error' && (
          <div className={styles.center}>
            <p className={`${styles.centerText} ${styles.centerTextError}`}>
              Erro ao carregar o Canva. Tente novamente mais tarde.
            </p>
          </div>
        )}

        {status === 'disconnected' && (
          <div className={styles.center}>
            <img src="/icons/canva.svg" width={32} height={32} alt="" style={{ opacity: 0.6 }} />
            <p className={styles.centerText}>
              Você ainda não conectou sua conta do Canva individual.
            </p>
            <button className={styles.connectBtn} onClick={handleConnectCanva}>
              Conectar Canva
            </button>
          </div>
        )}

        {status === 'connected' && (
          <div className={styles.content}>
            <div className={styles.toolbar}>
              <div className={styles.searchWrap}>
                <Search size={13} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
                <input
                  className={styles.searchInput}
                  placeholder="Buscar nos seus designs..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            {loadingDesigns ? (
              <div className={styles.center}>
                <Loader2 size={20} className={styles.spin} style={{ color: 'var(--color-text-tertiary)' }} />
              </div>
            ) : designs.length === 0 ? (
              <div className={styles.center}>
                <p className={styles.centerText}>
                  {search ? 'Nenhum design encontrado para essa busca.' : 'Nenhum design recente encontrado no seu Canva.'}
                </p>
              </div>
            ) : (
              <>
                <p className={styles.sectionLabel}>
                  {onSelectDesign ? 'Selecione um design para importar' : 'Selecione um design para contexto'}
                </p>
                <div className={styles.grid}>
                  {designs.map((design) => {
                    const isImporting = importingId === design.id;
                    const hasError = errorId === design.id;
                    return (
                      <button
                        key={design.id}
                        className={styles.gridItem}
                        onClick={() => handleSelectDesign(design)}
                        title={design.title || 'Sem título'}
                        disabled={importingId !== null}
                        style={hasError ? { borderColor: 'var(--color-error)' } : undefined}
                      >
                        <div style={{ position: 'relative' }}>
                          {design.thumbnail?.url ? (
                            <img src={design.thumbnail.url} alt="" className={styles.gridThumb} />
                          ) : (
                            <div className={styles.gridThumbFallback}>
                              <ImageOff size={20} />
                            </div>
                          )}
                          {isImporting && (
                            <div style={OVERLAY_SPINNER}>
                              <Loader2 size={20} className={styles.spin} style={{ color: '#fff' }} />
                            </div>
                          )}
                          {hasError && !isImporting && (
                            <div style={{ ...OVERLAY_SPINNER, background: 'rgba(224,0,0,0.75)' }}>
                              <AlertCircle size={20} style={{ color: '#fff' }} />
                            </div>
                          )}
                        </div>
                        <div className={styles.gridInfo}>
                          <div className={styles.gridName}>{design.title || 'Sem título'}</div>
                          {(design.page_count || design.updated_at) && (
                            <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                              {[design.page_count ? `${design.page_count} pág.` : '', formatUpdated(design.updated_at)].filter(Boolean).join(' · ')}
                            </div>
                          )}
                          {hasError && (
                            <div style={{ fontSize: 10, color: 'var(--color-error)', marginTop: 2 }}>
                              Falhou — toque para tentar de novo
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {continuation && (
                  <div style={{ padding: '0 16px 12px' }}>
                    <button className={styles.btnGhostFull} onClick={loadMore} disabled={loadingMore}>
                      {loadingMore && <Loader2 size={13} className={styles.spin} />}
                      {loadingMore ? 'Carregando...' : 'Carregar mais designs'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const OVERLAY_SPINNER: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
