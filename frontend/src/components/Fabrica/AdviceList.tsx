'use client';

// Lista "Orientações" — substitui o /btw. Mostra o que foi enviado enquanto a IA
// trabalhava, com o status evoluindo de "pendente" para "aplicada (etapa X)".
// Editável e removível SÓ enquanto pendente (o servidor também garante isso do
// lado dele — ver backend/src/lib/advice.ts `editAdvice`/`removePendingAdvice` —
// então esconder os botões aqui é conveniência de UI, não a única trava).

import { useEffect, useRef, useState } from 'react';
import { Check, Clock, Pencil, X } from 'lucide-react';
import { adviceStatusLabel, type AdviceItem } from '@/lib/advice';
import s from './AdviceList.module.css';

interface Props {
  items: AdviceItem[];
  onEdit: (id: string, text: string) => void;
  onRemove: (id: string) => void;
}

export function AdviceList({ items, onEdit, onRemove }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editingId) editRef.current?.focus();
  }, [editingId]);

  if (items.length === 0) return null;

  const startEdit = (item: AdviceItem) => {
    setEditingId(item.id);
    setEditText(item.text);
  };

  const commitEdit = () => {
    if (!editingId) return;
    const clean = editText.trim();
    if (clean) onEdit(editingId, clean);
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  return (
    // aria-live: cada mudança de status (pendente → aplicada) é anunciada sem o
    // usuário precisar manter o foco na lista — ele está digitando no campo abaixo.
    <div className={s.list} role="status" aria-live="polite" aria-label="Orientações enviadas durante a geração">
      {items.map((item) => {
        const isEditing = editingId === item.id;
        const isPending = item.status === 'pending';
        return (
          <div key={item.id} className={`${s.item} ${isPending ? s.itemPending : s.itemApplied}`}>
            <span className={s.statusIcon} aria-hidden="true">
              {isPending ? <Clock size={12} /> : <Check size={12} />}
            </span>

            {isEditing ? (
              <textarea
                ref={editRef}
                className={s.editField}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
                  if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                }}
                onBlur={commitEdit}
                aria-label={`Editar orientação: ${item.text}`}
                rows={1}
              />
            ) : (
              <span className={s.text}>{item.text}</span>
            )}

            <span className={s.status}>{adviceStatusLabel(item)}</span>

            {isPending && !isEditing && (
              <span className={s.actions}>
                <button
                  type="button"
                  className={s.actionBtn}
                  onClick={() => startEdit(item)}
                  aria-label={`Editar orientação "${item.text}"`}
                  title="Editar"
                >
                  <Pencil size={11} />
                </button>
                <button
                  type="button"
                  className={s.actionBtn}
                  onClick={() => onRemove(item.id)}
                  aria-label={`Remover orientação "${item.text}"`}
                  title="Remover"
                >
                  <X size={12} />
                </button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
