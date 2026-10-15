'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import Button from '@/components/ui/Button';
import { api, ApiError } from '@/lib/api';
import styles from '@/app/galeria/galeria.module.css';

interface NewCollabModalProps {
  /** Projeto-base de onde o desdobramento nasce. */
  parent: { slug: string; name: string };
  onClose: () => void;
  /** Chamado depois que o desdobramento foi criado (a tela recarrega a lista). */
  onCreated: () => void;
}

/**
 * Novo desdobramento (interno ou parceria) de um projeto-base. O desdobramento herda a
 * identidade da base: aqui se informa só o que muda (Cérebro de IA, §1.1.3 e §9).
 */
export default function NewCollabModal({ parent, onClose, onCreated }: NewCollabModalProps) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'INTERNAL' | 'PARTNERSHIP'>('INTERNAL');
  const [context, setContext] = useState('');
  const [partner, setPartner] = useState('');
  const [protagonism, setProtagonism] = useState(70);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const close = () => {
    if (!saving) onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const ctx = context.trim() ? { context: context.trim() } : {};
      const details =
        kind === 'PARTNERSHIP'
          ? { ...ctx, partner: { name: partner.trim() }, baseProtagonism: protagonism }
          : ctx;
      await api.post(`/brands/${parent.slug}/collabs`, { name: name.trim(), kind, details });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível criar o desdobramento.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={close}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Novo desdobramento de {parent.name}</h2>
          <button className={styles.modalClose} onClick={close} type="button" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className={styles.modalForm}>
          <p style={{ fontSize: '13px', color: 'var(--color-text-secondary, #666)', margin: '0 0 12px' }}>
            O desdobramento herda a identidade do projeto-base. Aqui você informa só o que muda.
          </p>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Nome</label>
            <input
              className={styles.formInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Mentoria, Amanda + Estadão"
              required
              autoFocus
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Tipo</label>
            <div style={{ display: 'flex', gap: '16px', fontSize: '14px' }}>
              <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input type="radio" name="collab-kind" checked={kind === 'INTERNAL'} onChange={() => setKind('INTERNAL')} />
                Interno
              </label>
              <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input type="radio" name="collab-kind" checked={kind === 'PARTNERSHIP'} onChange={() => setKind('PARTNERSHIP')} />
                Parceria com outra marca
              </label>
            </div>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Contexto e objetivo</label>
            <textarea
              className={styles.formInput}
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Para que serve este desdobramento"
            />
          </div>

          {kind === 'PARTNERSHIP' && (
            <>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Marca parceira</label>
                <input
                  className={styles.formInput}
                  value={partner}
                  onChange={(e) => setPartner(e.target.value)}
                  placeholder="Nome do parceiro"
                  required
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  Protagonismo de {parent.name}: {protagonism}%
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={protagonism}
                  onChange={(e) => setProtagonism(Number(e.target.value))}
                />
                <span style={{ fontSize: '12px', color: 'var(--color-text-secondary, #666)' }}>
                  É a força da narrativa e da identidade, não uma divisão exata de área. Logo e guia visual do parceiro entram depois, pela biblioteca do projeto.
                </span>
              </div>
            </>
          )}

          {error && (
            <p role="alert" style={{ color: '#b91c1c', fontSize: '13px', margin: '0 0 8px' }}>
              {error}
            </p>
          )}

          <div className={styles.modalActions}>
            <Button type="button" variant="secondary" size="sm" onClick={close} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={saving || !name.trim() || (kind === 'PARTNERSHIP' && !partner.trim())}>
              {saving ? 'Criando...' : 'Criar desdobramento'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
