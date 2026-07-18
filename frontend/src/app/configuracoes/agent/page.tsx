'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Bot, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import styles from '../configuracoes.module.css';

interface AgentConfig {
  models: {
    main: string;
    utility: string;
  };
  thinkingBudget: number;
  dailyTokenBudget: number;
  brandDailyTokenBudget: number;
}

export default function GlobalAgentSettingsPage() {
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    api.get<AgentConfig>('/settings/agent')
      .then((data) => {
        setConfig(data);
      })
      .catch((err) => {
        console.error(err);
        setErrorMsg('Não foi possível carregar as configurações globais do Agente.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className={styles.container} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Loader2 size={32} className={styles.spin} style={{ color: 'var(--color-brand)' }} />
        <p style={{ marginTop: '16px', color: 'var(--color-text-secondary)' }}>Carregando configurações de IA...</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <Link href="/configuracoes" className={styles.backLink} style={{ display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'none', marginBottom: '16px', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
        <ArrowLeft size={14} />
        <span>Voltar para Configurações Gerais</span>
      </Link>

      <PageHeader
        title="Agente IA Geral"
        description="Parâmetros globais, modelos ativos do Gemini e tetos de orçamento de tokens."
      />

      {errorMsg && <div className={styles.msgError}>{errorMsg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px', marginTop: '24px' }}>
        <Card padding="md">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{ backgroundColor: 'var(--color-brand-light)', color: 'var(--color-brand)', padding: '8px', borderRadius: '8px' }}>
              <Bot size={20} />
            </div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>Modelos do Gemini Conectados</h3>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
            <div style={{ padding: '16px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', backgroundColor: '#fafaf9' }}>
              <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Modelo Principal (Main)</span>
              <p style={{ margin: '4px 0 0 0', fontFamily: 'monospace', fontSize: '14px', fontWeight: 700, color: 'var(--color-text)' }}>
                {config?.models.main || 'Carregando...'}
              </p>
              <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '4px', display: 'block' }}>
                Usado para criação de roteiros e composições visuais complexas.
              </span>
            </div>

            <div style={{ padding: '16px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', backgroundColor: '#fafaf9' }}>
              <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Modelo Auxiliar (Utility)</span>
              <p style={{ margin: '4px 0 0 0', fontFamily: 'monospace', fontSize: '14px', fontWeight: 700, color: 'var(--color-text)' }}>
                {config?.models.utility || 'Carregando...'}
              </p>
              <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '4px', display: 'block' }}>
                Usado para stubs, correção ortográfica e extração rápida de logos.
              </span>
            </div>
          </div>
        </Card>

        <Card padding="md">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '8px', borderRadius: '8px' }}>
              <ShieldAlert size={20} />
            </div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>Orçamento e Tetos de Segurança (Tokens)</h3>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            <div>
              <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Teto Diário do Sistema</span>
              <p style={{ margin: '4px 0 0 0', fontSize: '20px', fontWeight: 700 }}>
                {config?.dailyTokenBudget ? config.dailyTokenBudget.toLocaleString('pt-BR') : 'Sem Limite'}
              </p>
              <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>Tokens por dia (global)</span>
            </div>

            <div>
              <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Teto Diário por Marca (Tenant)</span>
              <p style={{ margin: '4px 0 0 0', fontSize: '20px', fontWeight: 700 }}>
                {config?.brandDailyTokenBudget ? config.brandDailyTokenBudget.toLocaleString('pt-BR') : 'Sem Limite'}
              </p>
              <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>Tokens por dia (individual)</span>
            </div>

            <div>
              <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Limite de Thinking (Gemini 2.0)</span>
              <p style={{ margin: '4px 0 0 0', fontSize: '20px', fontWeight: 700 }}>
                {config?.thinkingBudget ? config.thinkingBudget.toLocaleString('pt-BR') : 'Inativo'}
              </p>
              <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>Tokens de raciocínio</span>
            </div>
          </div>
          <p style={{ margin: '20px 0 0 0', fontSize: '12px', color: 'var(--color-text-secondary)', lineHeight: '1.5', padding: '10px', backgroundColor: '#fafaf9', borderLeft: '3px solid #ef4444', borderRadius: '4px' }}>
            <strong>Nota de Segurança:</strong> Se os limites diários forem atingidos, novas requisições de IA serão recusadas temporariamente para evitar vazamentos de orçamento ou retries em loop infinito do Chromium. Os valores são configurados nas variáveis de ambiente do backend.
          </p>
        </Card>
      </div>
    </div>
  );
}
