'use client';

import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Tags } from 'lucide-react';
import { TEXT_STATUS_OPTIONS, insertStatusMarker, type TextStatusTag } from '@/lib/textStatus';
import s from './TextStatusMenu.module.css';

interface Props {
  value: string;
  /** Recebe o texto novo e a posição do cursor depois da marca. */
  onChange: (text: string, caret: number) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
}

/**
 * Botão "Status do texto": põe a marca (`[FALA]`, `[APOIO]`...) numa linha própria, no cursor ou em volta
 * da seleção. As marcas são o contrato com o backend; aqui a pessoa não precisa decorar a sintaxe.
 */
export default function TextStatusMenu({ value, onChange, inputRef, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, inputRef]);

  const pick = (tag: TextStatusTag) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const { text, caret } = insertStatusMarker(value, start, end, tag);
    onChange(text, caret);
    setOpen(false);
    requestAnimationFrame(() => {
      const target = inputRef.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className={s.root} ref={rootRef}>
      <button
        type="button"
        className={s.trigger}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Status do texto"
        title="Marcar o que é texto da peça, fala, contexto ou interno"
      >
        <Tags size={15} />
      </button>
      {open && (
        <div className={s.menu} id={menuId} role="menu" aria-label="Status do texto">
          <p className={s.menuTitle}>Marcar a partir do cursor (ou o trecho selecionado)</p>
          {TEXT_STATUS_OPTIONS.map((o) => (
            <button key={o.tag} type="button" role="menuitem" className={s.item} onClick={() => pick(o.tag)}>
              <span className={s.itemHead}>
                <span className={s.itemLabel}>{o.label}</span>
                <span className={o.visible ? s.badgeIn : s.badgeOut}>{o.visible ? 'na arte' : 'fora da arte'}</span>
              </span>
              <span className={s.itemHint}>{o.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
