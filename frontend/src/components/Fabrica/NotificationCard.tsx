'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ExternalLink, RefreshCw, X } from 'lucide-react';
import type { FabricaNotification } from '@/hooks/useFabricaWs';
import s from './NotificationCard.module.css';

interface Props {
  notification: FabricaNotification | null;
  marca: string;
  postId?: string;
  onApprove: () => void;
  onDecline: (reason?: string) => void;
  onDismiss: () => void;
}

// "Pronto" é aviso, não pedido: ninguém precisa despachá-lo para seguir. Ancorado
// no fluxo, um card que só some no clique empurra o preview para baixo por tempo
// indeterminado. Revisão e erro NÃO expiram — os dois pedem uma decisão.
const AUTO_DISMISS_MS = 8000;

export function NotificationCard({
  notification,
  marca,
  postId,
  onApprove,
  onDecline,
  onDismiss,
}: Props) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
  const [declineText, setDeclineText] = useState('');
  const declineRef = useRef<HTMLTextAreaElement>(null);

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

  useEffect(() => {
    if (notification?.kind !== 'done') return;
    const t = setTimeout(() => {
      setVisible(false);
      onDismiss();
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [notification, onDismiss]);

  if (!notification || !visible) return null;

  const isDone = notification.kind === 'done';
  const isReview = notification.kind === 'needs_review';
  const isError = notification.kind === 'error';

  const dismiss = () => {
    setVisible(false);
    setTimeout(onDismiss, 250);
  };

  const tone = isDone ? s.done : isReview ? s.review : s.error;
  const label = isDone ? 'Pronto' : isReview ? 'Revisar' : 'Erro';

  return (
    <div className={`${s.card} ${tone}`} role="status">

      <div className={s.header}>
        <div className={s.badge}>
          <div className={s.dot} />
          <span className={s.label}>{label}</span>
        </div>
        <button onClick={dismiss} className={s.dismiss} aria-label="Dispensar aviso">
          <X size={11} />
        </button>
      </div>

      <p className={s.message}>{notification.message}</p>

      {showDecline && (
        <div className={s.declineWrap}>
          <textarea
            ref={declineRef}
            value={declineText}
            onChange={e => setDeclineText(e.target.value)}
            placeholder="O que deve ser corrigido?"
            className={s.declineInput}
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

      <div className={s.actions}>
        {isDone && postId && (
          <button
            className={`${s.btn} ${s.btnPrimary}`}
            onClick={() => router.push(`/${marca}/editor/${postId}`)}
          >
            <ExternalLink size={11} /> Editar
          </button>
        )}

        {isReview && !showDecline && (
          <>
            <button className={`${s.btn} ${s.btnPrimary}`} onClick={() => { onApprove(); dismiss(); }}>
              <Check size={11} /> Aprovar
            </button>
            <button className={`${s.btn} ${s.btnSecondary}`} onClick={() => setShowDecline(true)}>
              <RefreshCw size={11} /> Refazer
            </button>
          </>
        )}

        {isReview && showDecline && (
          <>
            <button
              className={`${s.btn} ${s.btnPrimary}`}
              onClick={() => { onDecline(declineText.trim() || undefined); setShowDecline(false); dismiss(); }}
            >
              <RefreshCw size={11} /> Confirmar
            </button>
            <button className={`${s.btn} ${s.btnSecondary}`} onClick={() => setShowDecline(false)}>
              Cancelar
            </button>
          </>
        )}

        {isError && (
          <button className={`${s.btn} ${s.btnSecondary}`} onClick={dismiss}>Fechar</button>
        )}
      </div>
    </div>
  );
}
