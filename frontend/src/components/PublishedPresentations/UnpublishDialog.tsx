'use client';

import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import styles from './PublishedPresentations.module.css';

interface UnpublishDialogProps {
  title: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirmação de despublicar. Substitui o `window.confirm` do navegador (sem estilo, sem contexto). */
export default function UnpublishDialog({ title, busy, onCancel, onConfirm }: UnpublishDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Começa no botão seguro: Enter por engano cancela, não apaga o link.
  useEffect(() => { cancelRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  // O foco não sai do diálogo: Tab alterna entre os dois botões.
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const first = cancelRef.current;
    const last = confirmRef.current;
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div className={styles.dialogOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unpublish-title"
        aria-describedby="unpublish-desc"
        onKeyDown={trapTab}
      >
        <h2 id="unpublish-title" className={styles.dialogTitle}>Despublicar “{title}”?</h2>
        <p id="unpublish-desc" className={styles.dialogText}>
          O endereço atual deixa de funcionar para todo mundo que o recebeu. Se você publicar de
          novo, o endereço será outro. A arte em si não é apagada.
        </p>
        <div className={styles.dialogActions}>
          <button ref={cancelRef} type="button" className={styles.btnSecondary} onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button ref={confirmRef} type="button" className={styles.btnDanger} onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            Despublicar
          </button>
        </div>
      </div>
    </div>
  );
}
