'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { useAiBilling } from '@/lib/hooks';
import { formatTokensFull, formatCost, formatMoney, formatMonth, prettyModel } from '@/lib/aiUsageFormat';
import styles from './billing.module.css';

export default function BillingPage() {
  const params = useParams();
  const slug = params.marca as string;
  const marca = decodeURIComponent(slug);

  const [month, setMonth] = useState<string | undefined>(undefined);
  const { billing, loading, error } = useAiBilling(slug, month);

  const maxTokens = billing ? Math.max(1, ...billing.models.map((m) => m.totalTokens)) : 1;

  return (
    <div>
      <Link href={`/${slug}/configuracoes`} className={styles.backLink}>
        <ArrowLeft size={16} />
        Voltar para configurações
      </Link>

      <PageHeader
        title="Gastos de IA"
        description={`Consumo e custo estimado por modelo em "${marca}". Os tokens são exatos (vêm do provedor); os valores em dinheiro são estimativa.`}
      />

      {error ? (
        <p className={styles.error}>Erro ao carregar: {error}</p>
      ) : loading || !billing ? (
        <p>Carregando…</p>
      ) : (
        <>
          <div className={styles.toolbar}>
            <select
              className={styles.monthSelect}
              value={billing.month}
              onChange={(e) => setMonth(e.target.value)}
              aria-label="Mês"
            >
              {billing.availableMonths.map((m) => (
                <option key={m} value={m}>{formatMonth(m)}</option>
              ))}
            </select>
            <p className={styles.estimateBanner}>
              Preço por modelo (input/output) configurável no servidor. Gasto e impostos
              são exibidos separados; a fatura oficial é a do provedor.
            </p>
          </div>

          <div className={styles.kpiRow}>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Custo total do mês</div>
              <div className={styles.kpiValue}>{formatCost(billing.totals.cost)}</div>
              {billing.totals.cost.total > 0 && (
                <div className={styles.kpiSub}>
                  Gasto {formatMoney(billing.totals.cost.base, billing.totals.cost.currency)}
                  {billing.taxRate > 0 && (
                    <> + impostos {formatMoney(billing.totals.cost.tax, billing.totals.cost.currency)} ({(billing.taxRate * 100).toFixed(2)}%)</>
                  )}
                </div>
              )}
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Tokens no mês</div>
              <div className={styles.kpiValue}>{formatTokensFull(billing.totals.totalTokens)}</div>
              <div className={styles.kpiSub}>
                {formatTokensFull(billing.totals.promptTokens)} entrada · {formatTokensFull(billing.totals.outputTokens + billing.totals.thinkingTokens)} saída
              </div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Chamadas de IA</div>
              <div className={styles.kpiValue}>{billing.totals.calls.toLocaleString('pt-BR')}</div>
              <div className={styles.kpiSub}>{billing.models.length} modelo(s) usado(s)</div>
            </div>
          </div>

          {billing.models.length === 0 ? (
            <div className={styles.empty}>Nenhuma geração de IA registrada em {formatMonth(billing.month)}.</div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.modelCell}>Modelo</th>
                    <th className={styles.num}>Chamadas</th>
                    <th className={styles.num}>Entrada</th>
                    <th className={styles.num}>Saída</th>
                    <th className={styles.num}>Tokens</th>
                    <th className={styles.num}>Gasto</th>
                    <th className={styles.num}>Impostos</th>
                    <th className={styles.num}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {billing.models.map((m) => (
                    <tr key={m.model}>
                      <td className={styles.modelCell}>
                        <div className={styles.modelName} title={m.model}>{prettyModel(m.model)}</div>
                        <div className={styles.shareBar}>
                          <div className={styles.shareBarFill} style={{ width: `${(m.totalTokens / maxTokens) * 100}%` }} />
                        </div>
                      </td>
                      <td className={styles.num}>{m.calls.toLocaleString('pt-BR')}</td>
                      <td className={styles.num}>{formatTokensFull(m.promptTokens)}</td>
                      <td className={styles.num}>{formatTokensFull(m.outputTokens + m.thinkingTokens)}</td>
                      <td className={styles.num}>{formatTokensFull(m.totalTokens)}</td>
                      <td className={styles.num}>{m.cost.base > 0 ? formatMoney(m.cost.base, m.cost.currency) : '—'}</td>
                      <td className={`${styles.num} ${styles.tax}`}>{m.cost.tax > 0 ? formatMoney(m.cost.tax, m.cost.currency) : '—'}</td>
                      <td className={`${styles.num} ${styles.total}`}>{formatCost(m.cost)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className={styles.num}>{billing.totals.calls.toLocaleString('pt-BR')}</td>
                    <td className={styles.num}>{formatTokensFull(billing.totals.promptTokens)}</td>
                    <td className={styles.num}>{formatTokensFull(billing.totals.outputTokens + billing.totals.thinkingTokens)}</td>
                    <td className={styles.num}>{formatTokensFull(billing.totals.totalTokens)}</td>
                    <td className={styles.num}>{billing.totals.cost.base > 0 ? formatMoney(billing.totals.cost.base, billing.totals.cost.currency) : '—'}</td>
                    <td className={styles.num}>{billing.totals.cost.tax > 0 ? formatMoney(billing.totals.cost.tax, billing.totals.cost.currency) : '—'}</td>
                    <td className={styles.num}>{formatCost(billing.totals.cost)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <p className={styles.priceHint}>
            {billing.currency === 'USD'
              ? 'Valores em US$. Defina AI_USD_TO_BRL no servidor para exibir em R$.'
              : 'Valores estimados em R$, convertidos do preço em US$ do provedor.'}
          </p>
        </>
      )}
    </div>
  );
}
