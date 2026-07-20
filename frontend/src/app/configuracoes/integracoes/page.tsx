'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, PlugZap } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import styles from '../configuracoes.module.css';

interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'DESIGNER';
  connections: {
    asana: boolean;
    googleDrive: boolean;
    canva: boolean;
  };
}

function IntegracoesContent() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const searchParams = useSearchParams();
  const connected = searchParams.get('connected');

  const loadProfile = async () => {
    try {
      setLoading(true);
      setErrorMsg('');
      const data = await api.get<UserProfile>('/settings/perfil');
      setProfile(data);
    } catch (err) {
      console.error(err);
      setErrorMsg('Não foi possível carregar as conexões de integrações.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
    if (connected === 'asana') {
      setSuccessMsg('Integração com o Asana realizada com sucesso!');
    } else if (connected === 'canva') {
      setSuccessMsg('Integração com o Canva realizada com sucesso!');
    }
  }, [connected]);

  const handleDisconnect = async (provider: 'asana' | 'google' | 'canva') => {
    if (!confirm(`Deseja desconectar a integração do ${provider.toUpperCase()}?`)) return;
    setErrorMsg('');
    setSuccessMsg('');
    setActionLoading(true);

    try {
      await api.delete(`/settings/connections/${provider}`);
      setSuccessMsg(`Integração do ${provider.toUpperCase()} desconectada.`);
      loadProfile();
    } catch (err) {
      console.error(err);
      setErrorMsg('Não foi possível desconectar a integração.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleConnectAsana = async () => {
    try {
      const { url } = await api.get<{ url: string }>('/asana/auth-url');
      window.location.href = url;
    } catch (err) {
      console.error(err);
      alert('Falha ao iniciar conexão com Asana.');
    }
  };

  const handleConnectCanva = async () => {
    try {
      const { authUrl } = await api.get<{ authUrl: string }>('/canva/auth-url');
      window.location.href = authUrl;
    } catch (err) {
      console.error(err);
      alert('Falha ao iniciar conexão com Canva.');
    }
  };

  if (loading) {
    return (
      <div className={styles.container} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Loader2 size={32} className={styles.spin} style={{ color: 'var(--color-brand)' }} />
        <p style={{ marginTop: '16px', color: 'var(--color-text-secondary)' }}>Carregando integrações...</p>
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
        title="Minhas Integrações"
        description="Conecte e gerencie seus perfis de aplicativos integrados ao Assinatura."
      />

      {successMsg && <div className={styles.msgSuccess}>{successMsg}</div>}
      {errorMsg && <div className={styles.msgError}>{errorMsg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px', marginTop: '24px' }}>
        <Card padding="md">
          <div className={styles.integrationList}>
            {/* Asana Integration */}
            <div className={styles.integrationRow}>
              <div className={styles.integrationInfo}>
                <div className={styles.integrationIconWrapper} style={{ backgroundColor: 'rgba(244, 63, 94, 0.1)', color: '#f43f5e' }}>A</div>
                <div>
                  <div className={styles.integrationName}>Asana</div>
                  <div className={styles.integrationStatus}>
                    Status:{' '}
                    {profile?.connections.asana ? (
                      <span className={styles.statusConnected}>Conectado via OAuth</span>
                    ) : (
                      'Não conectado'
                    )}
                  </div>
                </div>
              </div>
              <div>
                {profile?.connections.asana ? (
                  <button onClick={() => handleDisconnect('asana')} className={styles.disconnectBtn} disabled={actionLoading}>
                    Desconectar
                  </button>
                ) : (
                  <button onClick={handleConnectAsana} className={styles.connectBtn} disabled={actionLoading}>
                    Conectar Asana
                  </button>
                )}
              </div>
            </div>

            {/* Google Drive Integration */}
            <div className={styles.integrationRow}>
              <div className={styles.integrationInfo}>
                <div className={styles.integrationIconWrapper} style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>G</div>
                <div>
                  <div className={styles.integrationName}>Google Drive</div>
                  <div className={styles.integrationStatus}>
                    Status:{' '}
                    {profile?.connections.googleDrive ? (
                      <span className={styles.statusConnected}>Conectado</span>
                    ) : (
                      'Não conectado'
                    )}
                  </div>
                </div>
              </div>
              <div>
                {profile?.connections.googleDrive ? (
                  <button onClick={() => handleDisconnect('google')} className={styles.disconnectBtn} disabled={actionLoading}>
                    Desconectar
                  </button>
                ) : (
                  <button onClick={() => alert('Integração simulada do Google Drive')} className={styles.connectBtn} disabled={actionLoading}>
                    Conectar Drive
                  </button>
                )}
              </div>
            </div>

            {/* Canva User Integration */}
            <div className={styles.integrationRow}>
              <div className={styles.integrationInfo}>
                <div className={styles.integrationIconWrapper} style={{ backgroundColor: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6' }}>C</div>
                <div>
                  <div className={styles.integrationName}>Canva Individual</div>
                  <div className={styles.integrationStatus}>
                    Status:{' '}
                    {profile?.connections.canva ? (
                      <span className={styles.statusConnected}>Conectado</span>
                    ) : (
                      'Não conectado'
                    )}
                  </div>
                </div>
              </div>
              <div>
                {profile?.connections.canva ? (
                  <button onClick={() => handleDisconnect('canva')} className={styles.disconnectBtn} disabled={actionLoading}>
                    Desconectar
                  </button>
                ) : (
                  <button onClick={handleConnectCanva} className={styles.connectBtn} disabled={actionLoading}>
                    Conectar Canva
                  </button>
                )}
              </div>
            </div>

          </div>
        </Card>
      </div>
    </div>
  );
}

export default function IntegracoesPage() {
  return (
    <Suspense fallback={
      <div className={styles.container} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Loader2 size={32} className={styles.spin} style={{ color: 'var(--color-brand)' }} />
        <p style={{ marginTop: '16px', color: 'var(--color-text-secondary)' }}>Carregando integrações...</p>
      </div>
    }>
      <IntegracoesContent />
    </Suspense>
  );
}

