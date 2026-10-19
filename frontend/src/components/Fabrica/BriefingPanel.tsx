'use client';

import { useId, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { filledFields, type Briefing } from '@/lib/briefing';
import s from './BriefingPanel.module.css';

interface Props {
  value: Briefing;
  onChange: (next: Briefing) => void;
  disabled?: boolean;
}

const FIELDS: ReadonlyArray<{ key: keyof Briefing; label: string; hint: string; placeholder: string }> = [
  {
    key: 'approved',
    label: 'Texto aprovado por slide',
    hint: 'Aparece na arte, palavra por palavra.',
    placeholder: 'Slide 1: título e texto exatos\nSlide 2: ...',
  },
  {
    key: 'context',
    label: 'Fala / contexto não visível',
    hint: 'Orienta a IA, mas nunca aparece na arte.',
    placeholder: 'Roteiro de fala, cenário, público, tom...',
  },
  {
    key: 'internal',
    label: 'Informações internas ou proibidas',
    hint: 'Não entra na arte nem na orientação da IA.',
    placeholder: 'O que não pode aparecer nem ser citado...',
  },
];

/**
 * Briefing da peça em campos: o status do texto é o campo em que ele foi escrito. Quem monta a mensagem
 * para o backend é `composeBriefing`; aqui a pessoa só preenche.
 */
export default function BriefingPanel({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const filled = filledFields(value);

  return (
    <section className={s.root} aria-label="Briefing da peça">
      <button
        type="button"
        className={s.head}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>Briefing da peça</span>
        <span className={s.headCount}>{filled > 0 ? `${filled} de ${FIELDS.length} campos preenchidos` : 'opcional'}</span>
      </button>
      {open && (
        <div className={s.body} id={panelId}>
          {FIELDS.map((f) => (
            <label key={f.key} className={s.field}>
              <span className={s.label}>{f.label}</span>
              <span className={s.hint}>{f.hint}</span>
              <textarea
                className={s.area}
                value={value[f.key]}
                onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                disabled={disabled}
              />
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
