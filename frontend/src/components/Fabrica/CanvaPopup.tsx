'use client';

import { useState, useEffect } from 'react';
import { ExternalLink, Loader2, X, FileImage } from 'lucide-react';
import { API_BASE } from '@/lib/api';

interface CanvaDesign {
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
}

const getToken = () =>
  typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;

const authHeaders = (): Record<string, string> => {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

export function CanvaPopup({ onClose, onInject }: Props) {
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
    const editUrl = design.urls?.edit_url || design.urls?.view_url || '';
    const text = `[Contexto Canva]\nDesign: "${design.title || 'Sem título'}"\nID: ${design.id}\nLink: ${editUrl}`;
    onInject(text);
    onClose();
  };

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={POPUP} onClick={(e) => e.stopPropagation()}>
        <div style={HEADER}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <FileImage size={15} style={{ color: '#8b5cf6' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#1d1c1a' }}>Conectar Canva</span>
          </div>
          <button style={CLOSE_BTN} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {status === 'loading' && (
          <div style={CENTER}>
            <Loader2 size={24} style={{ color: '#8b5cf6' }} className="animate-spin" />
          </div>
        )}

        {status === 'error' && (
          <div style={CENTER}>
            <p style={{ fontSize: 12, color: '#ef4444', textAlign: 'center', margin: 0 }}>
              Erro ao carregar o Canva. Tente novamente mais tarde.
            </p>
          </div>
        )}

        {status === 'disconnected' && (
          <div style={{ ...CENTER, flexDirection: 'column', gap: '12px' }}>
            <p style={{ fontSize: 12, color: '#6b7280', textAlign: 'center', margin: 0 }}>
              Você ainda não conectou sua conta do Canva individual.
            </p>
            <button style={CONNECT_BTN} onClick={handleConnectCanva}>
              Conectar Canva
            </button>
          </div>
        )}

        {status === 'connected' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            {loadingDesigns ? (
              <div style={CENTER}>
                <Loader2 size={24} style={{ color: '#8b5cf6' }} className="animate-spin" />
              </div>
            ) : designs.length === 0 ? (
              <div style={CENTER}>
                <p style={{ fontSize: 12, color: '#6b7280', textAlign: 'center', margin: 0 }}>
                  Nenhum design recente encontrado no seu Canva.
                </p>
              </div>
            ) : (
              <div style={SCROLL_AREA}>
                <p style={SECTION_LABEL}>Selecione um Design para contexto</p>
                {designs.map((design) => (
                  <button
                    key={design.id}
                    style={LIST_ITEM}
                    onClick={() => handleSelectDesign(design)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(139, 92, 246, 0.05)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                        <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {design.title || 'Sem título'}
                        </span>
                        <span style={{ fontSize: 10, color: '#9ca3af' }}>ID: {design.id.slice(0, 8)}...</span>
                      </div>
                      <ExternalLink size={12} style={{ color: '#c1bfba', flexShrink: 0 }} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const OVERLAY: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '16px',
};

const POPUP: React.CSSProperties = {
  width: '100%',
  maxWidth: 320,
  maxHeight: 440,
  background: '#ffffff',
  border: '1px solid rgba(0,0,0,0.08)',
  borderRadius: 12,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
};

const HEADER: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 14px',
  borderBottom: '1px solid rgba(0,0,0,0.06)',
  background: '#f8f6f2',
};

const CLOSE_BTN: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#96948f',
  cursor: 'pointer',
  padding: 2,
};

const CENTER: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 1,
  padding: 28,
};

const SCROLL_AREA: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '4px 0',
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize: 10,
  color: '#96948f',
  padding: '4px 14px 2px',
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  margin: 0,
};

const LIST_ITEM: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  color: '#1d1c1a',
  fontSize: 12,
  padding: '8px 14px',
  cursor: 'pointer',
  transition: 'background 0.1s',
};

const CONNECT_BTN: React.CSSProperties = {
  background: '#8b5cf6',
  border: 'none',
  borderRadius: 8,
  color: '#fff',
  fontSize: 12,
  fontWeight: 500,
  padding: '8px 16px',
  cursor: 'pointer',
  boxShadow: '0 2px 4px rgba(139, 92, 246, 0.2)',
};
