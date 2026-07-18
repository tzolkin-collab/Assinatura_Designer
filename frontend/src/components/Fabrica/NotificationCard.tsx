'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ExternalLink, RefreshCw, X } from 'lucide-react';
import type { FabricaNotification, ReviewMode } from '@/hooks/useFabricaWs';

interface Props {
  notification: FabricaNotification | null;
  reviewMode: ReviewMode;
  marca: string;
  postId?: string;
  onApprove: () => void;
  onDecline: (reason?: string) => void;
  onSetMode: (mode: ReviewMode) => void;
  onDismiss: () => void;
}

export function NotificationCard({
  notification,
  reviewMode,
  marca,
  postId,
  onApprove,
  onDecline,
  onSetMode,
  onDismiss,
}: Props) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
  const [declineText, setDeclineText] = useState('');
  const declineRef = useRef<HTMLTextAreaElement>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (notification) {
      setVisible(true);
      setShowDecline(false);
      setDeclineText('');
    }
  }, [notification]);

  useEffect(() => {
    if (showDecline) declineRef.current?.focus();
  }, [showDecline]);

  if (!notification || !visible) return null;

  const isDone = notification.kind === 'done';
  const isReview = notification.kind === 'needs_review';
  const isError = notification.kind === 'error';

  const dismiss = () => {
    setVisible(false);
    setTimeout(onDismiss, 250);
  };

  const accent = isDone ? '#22c55e' : isReview ? '#f59e0b' : '#ef4444';
  const accentLight = isDone ? '#86efac' : isReview ? '#fcd34d' : '#fca5a5';
  const label = isDone ? 'Pronto' : isReview ? 'Revisar' : 'Erro';

  const accentText = isDone ? '#166534' : isReview ? '#92400e' : '#991b1b';

  return (
    <div style={{ ...(isMobile ? MOBILE_CARD : CARD), borderTop: `2px solid ${accent}` }}>

      {/* Header row */}
      <div style={HEADER_ROW}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: accent, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: accentText }}>{label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            style={{ ...PILL, ...(reviewMode === 'auto' ? PILL_ON : {}) }}
            onClick={() => onSetMode('auto')}
            title="Aprovação automática"
          >Auto</button>
          <button
            style={{ ...PILL, ...(reviewMode === 'manual' ? PILL_ON : {}) }}
            onClick={() => onSetMode('manual')}
            title="Aprovação manual"
          >Manual</button>
          <button onClick={dismiss} style={X_BTN}><X size={11} /></button>
        </div>
      </div>

      {/* Message */}
      <p style={{ fontSize: 12, color: '#63615c', margin: '6px 14px 0', lineHeight: 1.5 }}>
        {notification.message}
      </p>

      {/* Decline input */}
      {showDecline && (
        <div style={{ padding: '8px 14px 0' }}>
          <textarea
            ref={declineRef}
            value={declineText}
            onChange={e => setDeclineText(e.target.value)}
            placeholder="O que deve ser corrigido?"
            style={{
              width: '100%', background: '#f3f2ef',
              border: '1px solid rgba(0,0,0,0.08)', borderRadius: 7,
              color: '#1d1c1a', fontSize: 12, padding: '7px 9px',
              resize: 'none', outline: 'none', fontFamily: 'inherit',
              boxSizing: 'border-box', lineHeight: 1.5,
            }}
            rows={3}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onDecline(declineText.trim() || undefined);
                setShowDecline(false);
                dismiss();
              }
            }}
          />
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 14px 12px', flexWrap: 'wrap' }}>
        {isDone && (
          <>
            {postId && (
              <button
                style={BTN_PRIMARY}
                onClick={() => router.push(`/${marca}/editor/${postId}`)}
              >
                <ExternalLink size={11} /> Editar
              </button>
            )}
            <button style={BTN_SECONDARY} onClick={dismiss}>Fechar</button>
          </>
        )}

        {isReview && !showDecline && (
          <>
            <button style={BTN_PRIMARY} onClick={() => { onApprove(); dismiss(); }}>
              <Check size={11} /> Aprovar
            </button>
            <button style={BTN_SECONDARY} onClick={() => setShowDecline(true)}>
              <RefreshCw size={11} /> Refazer
            </button>
          </>
        )}

        {isReview && showDecline && (
          <>
            <button
              style={BTN_PRIMARY}
              onClick={() => { onDecline(declineText.trim() || undefined); setShowDecline(false); dismiss(); }}
            >
              <RefreshCw size={11} /> Confirmar
            </button>
            <button style={BTN_SECONDARY} onClick={() => setShowDecline(false)}>
              Cancelar
            </button>
          </>
        )}

        {isError && (
          <button style={BTN_SECONDARY} onClick={dismiss}>Fechar</button>
        )}
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const CARD: React.CSSProperties = {
  position: 'fixed', bottom: 20, right: 20, width: 290,
  background: '#ffffff',
  borderRight: '1px solid rgba(0,0,0,0.08)',
  borderBottom: '1px solid rgba(0,0,0,0.08)',
  borderLeft: '1px solid rgba(0,0,0,0.08)',
  borderRadius: 12, zIndex: 1000,
  boxShadow: '0 8px 30px rgba(0,0,0,0.1)',
};
const MOBILE_CARD: React.CSSProperties = {
  position: 'fixed', bottom: 12, left: 12, right: 12, width: 'auto',
  background: '#ffffff',
  borderRight: '1px solid rgba(0,0,0,0.08)',
  borderBottom: '1px solid rgba(0,0,0,0.08)',
  borderLeft: '1px solid rgba(0,0,0,0.08)',
  borderRadius: 12, zIndex: 1000,
  boxShadow: '0 8px 30px rgba(0,0,0,0.1)',
};
const HEADER_ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px 0',
};
const PILL: React.CSSProperties = {
  fontSize: 10, padding: '2px 8px', borderRadius: 20,
  borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(0,0,0,0.08)', background: 'transparent',
  color: '#96948f', cursor: 'pointer', transition: 'all 0.15s',
};
const PILL_ON: React.CSSProperties = {
  background: '#fdf2ef', borderColor: 'rgba(217,119,87,0.4)', color: '#d97757',
};
const X_BTN: React.CSSProperties = {
  background: 'none', border: 'none', color: '#96948f', cursor: 'pointer', padding: 2,
};
const BTN_PRIMARY: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 500,
  padding: '5px 11px', borderRadius: 7, background: '#d97757', border: 'none', color: '#fff', cursor: 'pointer',
};
const BTN_SECONDARY: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5, fontSize: 12,
  padding: '5px 11px', borderRadius: 7,
  background: '#f3f2ef', border: '1px solid rgba(0,0,0,0.08)',
  color: '#63615c', cursor: 'pointer',
};
