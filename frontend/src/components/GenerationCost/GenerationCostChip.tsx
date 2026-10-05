'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, CircleDollarSign, Info, Loader2, RefreshCw } from 'lucide-react';
import { formatTokens } from '@/lib/aiUsageFormat';
import {
  costWarnings,
  formatChipLabel,
  formatImageCount,
  formatRoleTokens,
  formatSummaryLine,
  formatUsd,
  roleRows,
} from '@/lib/generationCostFormat';
import { useGenerationCost } from './useGenerationCost';
import styles from './GenerationCostChip.module.css';

interface GenerationCostChipProps {
  /** Sem post ainda (ex.: a Fábrica antes do primeiro slide), não há o que estimar: não renderiza. */
  postId?: string;
  /** Muda → refaz a busca (terminou uma geração, entrou um slide, acabou uma edição). */
  refreshKey?: string | number;
  /** Lado do chip em que o popover se ancora. `end` abre para a esquerda; `start`, para a direita. */
  align?: 'start' | 'end';
}

/**
 * Chip "Custo estimado US$ x,xx" com o detalhamento num popover.
 *
 * Compartilhado entre o header do editor e a barra do artefato da Fábrica. É SEMPRE
 * rotulado como estimativa: o número vem dos tokens gravados no rastro × uma tabela de
 * preços, não da fatura do Google. Quando algo ficou fora da conta, o popover diz o quê.
 */
export default function GenerationCostChip({ postId, refreshKey, align = 'end' }: GenerationCostChipProps) {
  const { cost, loading, error, refresh } = useGenerationCost(postId, refreshKey);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  // Fecha ao clicar fora ou com Esc: popover não deve prender a tela.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!postId) return null;

  // ── Rótulo do chip conforme o estado ──────────────────────────────────────────
  let chipClass = styles.chip;
  let label: string;
  let icon = <CircleDollarSign size={13} className={styles.icon} aria-hidden />;
  let title = 'Custo estimado deste deck — clique para ver o detalhamento';

  if (!cost && loading) {
    chipClass = `${styles.chip} ${styles.muted}`;
    label = 'Custo estimado…';
    icon = <Loader2 size={13} className={`${styles.icon} ${styles.spin}`} aria-hidden />;
    title = 'Calculando o custo estimado';
  } else if (!cost && error) {
    chipClass = `${styles.chip} ${styles.muted} ${styles.errorChip}`;
    label = 'Custo indisponível';
    icon = <AlertTriangle size={13} className={styles.icon} aria-hidden />;
    title = error;
  } else if (cost && !cost.available) {
    chipClass = `${styles.chip} ${styles.muted}`;
    label = 'Custo indisponível';
    icon = <Info size={13} className={styles.icon} aria-hidden />;
    title = cost.reason;
  } else if (cost && cost.available) {
    label = formatChipLabel(cost);
    if (cost.partial) chipClass = `${styles.chip} ${styles.partial}`;
  } else {
    return null;
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={chipClass}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-busy={loading}
        title={title}
      >
        {icon}
        <span className={styles.label}>{label}</span>
      </button>

      {open && (
        <div
          id={popoverId}
          role="dialog"
          aria-label="Detalhamento do custo estimado"
          className={`${styles.popover} ${align === 'start' ? styles.popoverStart : styles.popoverEnd}`}
        >
          <div className={styles.header}>
            <h4 className={styles.title}>Custo estimado deste deck</h4>
            {cost && cost.available && <span className={styles.badgeEstimate}>estimativa</span>}
          </div>

          {cost && cost.available ? (
            <>
              <div className={styles.totalRow}>
                <div className={styles.total}>
                  {cost.partial ? '≥ ' : ''}
                  {formatUsd(cost.totalUsd)}
                </div>
                <div className={styles.totalMeta}>
                  {formatTokens(cost.inputTokens + cost.outputTokens)} tokens
                </div>
              </div>
              <div className={styles.summary}>{formatSummaryLine(cost)}</div>

              <div className={styles.rows}>
                {roleRows(cost.byRole).map((row) => (
                  <div key={row.role} className={styles.row}>
                    <div className={styles.rowMain}>
                      <span className={styles.rowLabel}>{row.label}</span>
                      <span className={styles.rowUsd}>{formatUsd(row.usd)}</span>
                    </div>
                    <div className={styles.rowMeta}>
                      {row.role === 'image'
                        ? `${formatImageCount(cost.imageCount)} · ${formatRoleTokens(row)}`
                        : `${row.calls} chamada${row.calls > 1 ? 's' : ''} · ${formatRoleTokens(row)}`}
                    </div>
                  </div>
                ))}
              </div>

              {error && (
                <div className={styles.warning} role="note">
                  <AlertTriangle size={12} aria-hidden />
                  <span>Não consegui atualizar agora; este é o último valor carregado.</span>
                </div>
              )}

              {costWarnings(cost).map((w) => (
                <div key={w} className={styles.warning} role="note">
                  <AlertTriangle size={12} aria-hidden />
                  <span>{w}</span>
                </div>
              ))}
            </>
          ) : cost && !cost.available ? (
            <div className={styles.message}>{cost.reason}</div>
          ) : loading ? (
            <div className={styles.message}>Calculando…</div>
          ) : (
            <div className={styles.message}>{error ?? 'Não consegui carregar o custo estimado.'}</div>
          )}

          <div className={styles.footer}>
            <span className={styles.footnote}>
              Estimativa: tokens registrados × tabela de preços. Não é a fatura do Google.
            </span>
            <button
              type="button"
              className={styles.refresh}
              onClick={refresh}
              disabled={loading}
              aria-label="Atualizar o custo estimado"
              title="Atualizar"
            >
              <RefreshCw size={12} className={loading ? styles.spin : undefined} aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
