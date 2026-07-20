'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { Gauge, BarChart3 } from 'lucide-react';
import { useAiUsage } from '@/lib/hooks';
import { formatTokens, formatCost, formatMoney, prettyModel } from '@/lib/aiUsageFormat';
import styles from './AiSpendBadge.module.css';

/**
 * Widget de transparência de gasto de IA — mostra, sem sair da tela, quanto esta marca
 * já consumiu HOJE (tokens vs teto) e o custo estimado, com a quebra por modelo num
 * popover. O teto de gasto existia mas era invisível: só se descobria que ele existe
 * quando cortava. Aqui ele fica à vista.
 */
export default function AiSpendBadge({ slug, compact }: { slug: string; compact?: boolean }) {
  const { usage, loading } = useAiUsage(slug);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora — popover não deve prender o foco da tela.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (loading || !usage) return null;

  const used = usage.brandTokens ?? 0;
  const budget = usage.brandBudget ?? 0;
  const pct = budget > 0 ? Math.min(100, (used / budget) * 100) : 0;
  const fillClass =
    pct >= 90 ? styles.miniBarFillDanger : pct >= 70 ? styles.miniBarFillWarn : '';

  const costLabel = formatCost(usage.cost);

  return (
    <div className={`${styles.wrap} ${compact ? styles.compact : ''}`} ref={wrapRef}>
      <button
        type="button"
        className={styles.badge}
        onClick={() => setOpen((v) => !v)}
        title="Gasto de IA hoje — clique para ver por modelo"
      >
        <Gauge size={14} className={styles.badgeIcon} />
        <span className={styles.badgeLabel}>IA hoje</span>
        {budget > 0 && (
          <span className={styles.miniBar}>
            <span className={`${styles.miniBarFill} ${fillClass}`} style={{ width: `${pct}%` }} />
          </span>
        )}
        <span className={styles.badgeMeta}>
          {formatTokens(used)}{budget > 0 ? ` / ${formatTokens(budget)}` : ''} tok
          {costLabel !== '—' ? ` · ${costLabel}` : ''}
        </span>
      </button>

      {open && (
        <div className={styles.popover}>
          <div className={styles.popoverHeader}>
            <h4 className={styles.popoverTitle}>Gasto de IA de hoje</h4>
            <span className={styles.popoverDay}>{usage.day}</span>
          </div>

          <div className={styles.totalRow}>
            <div>
              <div className={styles.totalCost}>{costLabel}</div>
              {usage.cost.total > 0 && usage.taxRate > 0 && (
                <div className={styles.taxLine}>
                  Gasto {formatMoney(usage.cost.base, usage.cost.currency)} + impostos{' '}
                  {formatMoney(usage.cost.tax, usage.cost.currency)}
                </div>
              )}
            </div>
            <div className={styles.totalTokens}>
              {formatTokens(used)} tokens
              {budget > 0 ? ` · ${pct.toFixed(0)}% do teto` : ''}
            </div>
          </div>

          <div className={styles.modelList}>
            {usage.models.length === 0 ? (
              <div className={styles.empty}>Nenhuma geração de IA hoje.</div>
            ) : (
              usage.models.map((m) => (
                <div key={m.model} className={styles.modelRow}>
                  <span className={styles.modelName} title={m.model}>{prettyModel(m.model)}</span>
                  <span className={styles.modelTokens}>{formatTokens(m.totalTokens)} tok</span>
                  <span className={styles.modelCost}>{formatCost(m.cost)}</span>
                </div>
              ))
            )}
          </div>

          <div className={styles.footer}>
            <Link href={`/${slug}/configuracoes/billing`} className={styles.billingLink}>
              <BarChart3 size={13} />
              Billing por modelo
            </Link>
            {usage.cost.total > 0 && <span className={styles.estimateNote}>valores estimados</span>}
          </div>
        </div>
      )}
    </div>
  );
}
