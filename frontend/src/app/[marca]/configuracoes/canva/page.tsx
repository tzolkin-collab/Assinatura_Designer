'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle, AlertCircle, Info, Loader2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import styles from './canva.module.css';
import { api, getApiErrorMessage } from '@/lib/api';
import { useBrandPermissions } from '@/hooks/useBrandPermissions';

interface CanvaStatus {
  connected: boolean;
  canvaUserId: string | null;
  expiresAt: string | null;
}

export default function CanvaConfigPage() {
  const params = useParams();
  const slug = params.marca as string;

  const [status, setStatus] = useState<CanvaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [erro, setErro] = useState('');

  const { can, hint } = useBrandPermissions();
  const canManage = can('manage-integrations');

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const res = await api.get<CanvaStatus>(`/canva/${slug}/status`);
      setStatus(res);
    } catch (err) {
      console.error('Failed to fetch Canva status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (slug) fetchStatus();
  }, [slug]);

  const handleConnect = async () => {
    setErro('');
    try {
      setActionLoading(true);
      const res = await api.get<{ authUrl: string }>(`/canva/${slug}/auth-url`);
      if (res.authUrl) {
        window.location.href = res.authUrl;
      }
    } catch (err) {
      setErro(getApiErrorMessage(err, 'Erro ao iniciar a integração com o Canva.'));
      setActionLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Tem certeza de que deseja desconectar sua conta do Canva?')) return;
    setErro('');
    try {
      setActionLoading(true);
      await api.delete(`/canva/${slug}/disconnect`);
      await fetchStatus();
    } catch (err) {
      setErro(getApiErrorMessage(err, 'Erro ao desconectar do Canva.'));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div>
      <Link href={`/${slug}/configuracoes`} className={styles.backLink}>
        <ArrowLeft size={16} />
        Voltar para configurações
      </Link>

      <PageHeader
        title="Integração Direta Canva"
        description="Conecte seu perfil do Canva para exportar apresentações e designs prontos direto para sua conta do Canva."
      />

      <div className={styles.content}>
        {loading ? (
          <Card padding="lg">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '20px 0' }}>
              <Loader2 className="animate-spin" size={24} style={{ animation: 'lyrFade 1s infinite' }} />
              <span>Verificando integração...</span>
            </div>
          </Card>
        ) : (
          <>
            {/* Status */}
            <Card padding="lg">
              <div className={styles.statusHeader}>
                <div className={status?.connected ? styles.statusIcon : styles.statusIconDisconnected}>
                  {status?.connected ? <CheckCircle size={28} /> : <AlertCircle size={28} />}
                </div>
                <div>
                  <h3 className={styles.statusTitle}>
                    {status?.connected ? 'Canva Conectado' : 'Canva Desconectado'}
                  </h3>
                  <p className={styles.statusDesc}>
                    {status?.connected
                      ? `Sua conta do Canva está conectada e pronta para exportações.`
                      : 'Conecte sua conta do Canva para exportar seus slides como assets automaticamente.'}
                  </p>
                </div>
              </div>

              {status?.connected && (
                <div className={styles.infoGrid}>
                  <div className={styles.infoItem}>
                    <span className={styles.infoLabel}>ID do Usuário Canva</span>
                    <code className={styles.infoValue}>{status.canvaUserId || 'Carregado'}</code>
                  </div>
                  <div className={styles.infoItem}>
                    <span className={styles.infoLabel}>Expiração do Token</span>
                    <span className={styles.infoValue}>
                      {status.expiresAt ? new Date(status.expiresAt).toLocaleString() : 'Recorrente'}
                    </span>
                  </div>
                </div>
              )}

              {erro && (
                <p style={{ fontSize: '13px', color: '#ef4444', marginTop: '12px' }} role="alert">
                  {erro}
                </p>
              )}

              {!canManage && (
                <p style={{ fontSize: '13px', color: 'var(--color-text-dim)', marginTop: '12px' }}>
                  {hint} Conectar ou desconectar o Canva é uma ação de administrador.
                </p>
              )}

              <div className={styles.actions}>
                {status?.connected ? (
                  <button className={styles.btnSecondary} onClick={handleDisconnect} disabled={actionLoading || !canManage} title={canManage ? undefined : hint}>
                    Desconectar Canva
                  </button>
                ) : (
                  <button className={styles.btnPrimary} onClick={handleConnect} disabled={actionLoading || !canManage} title={canManage ? undefined : hint} style={{ background: '#7c3aed', opacity: canManage ? 1 : 0.5 }}>
                    {actionLoading ? 'Conectando...' : 'Conectar ao Canva'}
                  </button>
                )}
              </div>
            </Card>

            {/* Guide */}
            {!status?.connected && (
              <Card padding="lg">
                <div className={styles.guideHeader}>
                  <Info size={18} />
                  <h4>Benefícios da Integração</h4>
                </div>
                <ul className={styles.steps} style={{ listStyleType: 'disc', paddingLeft: 20 }}>
                  <li>
                    <strong>Exportação com 1 Clique:</strong> Não precisa baixar ZIP de imagens e subir manualmente.
                  </li>
                  <li>
                    <strong>Direto na Galeria de Imagens:</strong> Os slides caem na sua aba de "Uploads" no Canva.
                  </li>
                  <li>
                    <strong>Sincronização Segura:</strong> Integração via OAuth 2.0 PKCE segura oficial do Canva.
                  </li>
                </ul>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
