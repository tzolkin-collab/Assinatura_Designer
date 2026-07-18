'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  User as UserIcon, 
  PlugZap, 
  Building2, 
  ChevronRight, 
  ArrowLeft,
  Loader2,
  Bot,
  BarChart3
} from 'lucide-react';
import { api } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import styles from './configuracoes.module.css';

interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'DESIGNER';
}

export default function GlobalSettingsPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    api.get<UserProfile>('/settings/perfil')
      .then((userProfile) => {
        setProfile(userProfile);
      })
      .catch((err) => {
        console.error(err);
        setErrorMsg('Não foi possível carregar as configurações de perfil.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className={styles.container} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Loader2 size={32} className={styles.spin} style={{ color: 'var(--color-brand)' }} />
        <p style={{ marginTop: '16px', color: 'var(--color-text-secondary)' }}>Carregando configurações...</p>
      </div>
    );
  }

  const CONFIG_SECTIONS = [
    {
      key: 'perfil',
      label: 'Meu Perfil',
      description: 'Gerencie seu nome de exibição, senha e credenciais de conta.',
      icon: <UserIcon size={20} />,
      href: '/configuracoes/perfil'
    },
    {
      key: 'integrations',
      label: 'Minhas Integrações',
      description: 'Conecte e gerencie suas contas de Asana (OAuth), Google Drive e Canva.',
      icon: <PlugZap size={20} />,
      href: '/configuracoes/integracoes'
    },
  ];

  // Adiciona as seções de admin se for ADMIN
  if (profile?.role === 'ADMIN') {
    CONFIG_SECTIONS.push(
      {
        key: 'agent',
        label: 'Agente IA Geral',
        description: 'Configure modelos padrão do Gemini, limites de tokens e orçamentos do sistema.',
        icon: <Bot size={20} />,
        href: '/configuracoes/agent'
      },
      {
        key: 'billing',
        label: 'Gastos de IA Globais',
        description: 'Visualize o consumo de tokens e custos estimados consolidados de todas as marcas.',
        icon: <BarChart3 size={20} />,
        href: '/configuracoes/billing'
      },
      {
        key: 'tenants',
        label: 'Gestão de Tenants',
        description: 'Gerencie marcas ativas no sistema, veja membros associados e crie novos tenants.',
        icon: <Building2 size={20} />,
        href: '/configuracoes/tenants'
      }
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Link href="/galeria" className={styles.backLink} style={{ display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'none', marginBottom: '16px', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
          <ArrowLeft size={14} />
          <span>Voltar para Galeria</span>
        </Link>
        <PageHeader
          title="Configurações Gerais"
          description="Gerencie as configurações da sua conta e do sistema."
        />
      </div>

      {errorMsg && <div className={styles.msgError}>{errorMsg}</div>}

      <div className={styles.sections} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px', marginTop: '24px' }}>
        {CONFIG_SECTIONS.map((section) => (
          <Link
            key={section.key}
            href={section.href}
            style={{ textDecoration: 'none' }}
          >
            <Card hover padding="md" style={{ height: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', height: '100%', position: 'relative', paddingRight: '20px' }}>
                <div style={{ color: 'var(--color-brand)', backgroundColor: 'var(--color-brand-light)', padding: '12px', borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {section.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-text)', margin: '0 0 4px 0' }}>{section.label}</h3>
                  <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: 0, lineHeight: '1.4' }}>{section.description}</p>
                </div>
                <ChevronRight size={16} style={{ position: 'absolute', right: 0, color: 'var(--color-text-tertiary)' }} />
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
