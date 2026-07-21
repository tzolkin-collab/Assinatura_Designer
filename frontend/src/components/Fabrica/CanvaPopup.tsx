'use client';

import { useState, useEffect } from 'react';
import { Loader2, X, ImageOff, Palette } from 'lucide-react';
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
}

interface Props {
  onClose: () => void;
  onInject: (text: string) => void;
  /** Quando fornecido, o clique num design chama isto em vez de injetar texto
   *  no chat — usado fora da Fábrica (ex: biblioteca de mídia, que importa o
   *  design escolhido pro pool de assets em vez de referenciá-lo em conversa). */
  onSelectDesign?: (design: CanvaDesign) => void;
}

const getToken = () =>
  typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;

const authHeaders = (): Record<string, string> => {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

export function CanvaPopup({ onClose, onInject, onSelectDesign }: Props) {
  const [status, setStatus] = useState<'loading' | 'connected' | 'disconnected' | 'error'>('loading');
  const [designs, setDesigns] = useState<CanvaDesign[]>([]);
  const [loadingDesigns, setLoadingDesigns] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/canva/status`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d: { data?: { connected?: boolean } }) => {
        if (!d.data?.connected) {
          setStatus('disconnected');
          return;
        }
        setLoadingDesigns(true);
        return fetch(`${API_BASE}/canva/designs`, { headers: authHeaders() })
          .then((r) => r.json())
          .then((pd: { designs?: CanvaDesign[] }) => {
            setDesigns(pd.designs ?? []);
            setStatus('connected');
          });
      })
      .catch(() => setStatus('error'))
      .finally(() => setLoadingDesigns(false));
  }, []);

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

  const handleSelectDesign = (design: CanvaDesign) => {
    if (onSelectDesign) {
      onSelectDesign(design);
      return;
    }
    const editUrl = design.urls?.edit_url || design.urls?.view_url || '';
    const text = `[Contexto Canva]\nDesign: "${design.title || 'Sem título'}"\nID: ${design.id}\nLink: ${editUrl}`;
    onInject(text);
    onClose();
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`${styles.popup} ${styles.popupWide}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerTitleGroup}>
            <div className={styles.headerIconBadge} style={{ background: '#f2ecff' }}>
              <Palette size={14} style={{ color: '#8b3dff' }} />
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
            <Palette size={32} style={{ color: 'var(--color-text-tertiary)', opacity: 0.5 }} />
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
            {loadingDesigns ? (
              <div className={styles.center}>
                <Loader2 size={20} className={styles.spin} style={{ color: 'var(--color-text-tertiary)' }} />
              </div>
            ) : designs.length === 0 ? (
              <div className={styles.center}>
                <p className={styles.centerText}>
                  Nenhum design recente encontrado no seu Canva.
                </p>
              </div>
            ) : (
              <>
                <p className={styles.sectionLabel}>
                  {onSelectDesign ? 'Selecione um design para importar' : 'Selecione um design para contexto'}
                </p>
                <div className={styles.grid}>
                  {designs.map((design) => (
                    <button
                      key={design.id}
                      className={styles.gridItem}
                      onClick={() => handleSelectDesign(design)}
                      title={design.title || 'Sem título'}
                    >
                      {design.thumbnail?.url ? (
                        <img src={design.thumbnail.url} alt="" className={styles.gridThumb} />
                      ) : (
                        <div className={styles.gridThumbFallback}>
                          <ImageOff size={20} />
                        </div>
                      )}
                      <div className={styles.gridInfo}>
                        <div className={styles.gridName}>{design.title || 'Sem título'}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
