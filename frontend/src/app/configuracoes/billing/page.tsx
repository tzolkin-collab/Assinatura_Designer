'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, BarChart3, TrendingUp, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import styles from '../configuracoes.module.css';

interface BillingReport {
  brandSlug?: string;
  month: string;
  availableMonths: string[];
  currency: 'BRL' | 'USD';
  taxRate: number;
  totals: {
    calls: number;
    promptTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    totalTokens: number;
    cost: {
      base: number;
      tax: number;
      total: number;
    };
  };
  models: Array<{
    model: string;
    calls: number;
    promptTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    totalTokens: number;
    cost: {
      base: number;
      tax: number;
      total: number;
    };
  }>;
}

export default function GlobalBillingPage() {
  const [report, setReport] = useState<BillingReport | null>(null);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const loadBilling = async (month?: string) => {
    try {
      setLoading(true);
      setErrorMsg('');
      const query = month ? `?month=${month}` : '';
      const data = await api.get<BillingReport>(`/settings/billing${query}`);
      setReport(data);
      if (!selectedMonth) {
        setSelectedMonth(data.month);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Não foi possível obter o faturamento de IA global.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBilling();
  }, []);

  const handleMonthChange = (month: string) => {
    setSelectedMonth(month);
    loadBilling(month);
  };

  if (loading && !report) {
    return (
      <div className={styles.container} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Loader2 size={32} className={styles.spin} style={{ color: 'var(--color-brand)' }} />
        <p style={{ marginTop: '16px', color: 'var(--color-text-secondary)' }}>Carregando faturamento global...</p>
      </div>
    );
  }

  const symbol = report?.currency === 'BRL' ? 'R$' : 'U$';

  return (
    <div className={styles.container}>
      <Link href="/configuracoes" className={styles.backLink} style={{ display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'none', marginBottom: '16px', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
        <ArrowLeft size={14} />
        <span>Voltar para Configurações Gerais</span>
      </Link>

      <PageHeader
        title="Gastos de IA Globais"
        description="Faturamento consolidado, chamadas à API e custos estimados das operações do sistema."
        actions={
          report?.availableMonths && report.availableMonths.length > 1 ? (
            <select
              value={selectedMonth}
              onChange={(e) => handleMonthChange(e.target.value)}
              className={styles.input}
              style={{ width: '150px', height: '40px', padding: '0 8px' }}
            >
              {report.availableMonths.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : undefined
        }
      />

      {errorMsg && <div className={styles.msgError}>{errorMsg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px', marginTop: '24px' }}>
        {/* KPI Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          <Card padding="md">
            <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Gasto Total Consolidado</span>
            <p style={{ margin: '4px 0 0 0', fontSize: '24px', fontWeight: 800, color: 'var(--color-brand)' }}>
              {symbol} {report?.totals.cost.total.toFixed(2) || '0.00'}
            </p>
            <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>Inclui tributação sobre tokens</span>
          </Card>

          <Card padding="md">
            <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Consumo de Tokens</span>
            <p style={{ margin: '4px 0 0 0', fontSize: '24px', fontWeight: 800 }}>
              {report?.totals.totalTokens.toLocaleString('pt-BR') || '0'}
            </p>
            <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>Prompt + Output + Raciocínio</span>
          </Card>

          <Card padding="md">
            <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Total de Chamadas</span>
            <p style={{ margin: '4px 0 0 0', fontSize: '24px', fontWeight: 800 }}>
              {report?.totals.calls.toLocaleString('pt-BR') || '0'}
            </p>
            <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>Requisições completadas com sucesso</span>
          </Card>
        </div>

        {/* Cost Breakdown Table */}
        <Card padding="md">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <TrendingUp size={16} style={{ color: 'var(--color-brand)' }} />
            <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>Gasto por Modelo de Linguagem</h3>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className={styles.tenantTable}>
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th>Chamadas</th>
                  <th>Prompt Tokens</th>
                  <th>Output Tokens</th>
                  <th>Gasto Estimado</th>
                </tr>
              </thead>
              <tbody>
                {report?.models.map((row) => (
                  <tr key={row.model} className={styles.tenantRow}>
                    <td><strong style={{ fontFamily: 'monospace' }}>{row.model}</strong></td>
                    <td>{row.calls.toLocaleString('pt-BR')}</td>
                    <td>{row.promptTokens.toLocaleString('pt-BR')}</td>
                    <td>{row.outputTokens.toLocaleString('pt-BR')}</td>
                    <td><strong>{symbol} {row.cost.total.toFixed(3)}</strong></td>
                  </tr>
                ))}
                {report?.models.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-text-tertiary)' }}>
                      Nenhum consumo registrado neste período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Info Note */}
        <div style={{ display: 'flex', gap: '12px', padding: '16px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', backgroundColor: '#fafaf9' }}>
          <AlertCircle size={20} style={{ color: 'var(--color-brand)', flexShrink: 0 }} />
          <div>
            <h4 style={{ fontSize: '13px', fontWeight: 700, margin: '0 0 4px 0' }}>Informação sobre estimativas</h4>
            <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: 0, lineHeight: '1.5' }}>
              Os valores e orçamentos exibidos são gerados a partir do consumo real de tokens multiplicado pelos preços base declarados nas configurações. Os impostos incidentes sobre processamento de dados (como ISS e IOF na contratação internacional de serviços de nuvem) estão destacados na fiação de custos.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
