'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Loader2, Mail, LogOut } from 'lucide-react';
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
}

export default function PerfilPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');

  const loadProfile = async () => {
    try {
      setLoading(true);
      setErrorMsg('');
      const data = await api.get<UserProfile>('/settings/perfil');
      setProfile(data);
      setName(data.name);
    } catch (err) {
      console.error(err);
      setErrorMsg('Não foi possível carregar as informações do perfil.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg('');
    setErrorMsg('');
    setActionLoading(true);

    try {
      const payload: { name?: string; password?: string } = { name };
      if (password) {
        if (password.length < 8) {
          setErrorMsg('A nova senha deve ter pelo menos 8 caracteres.');
          setActionLoading(false);
          return;
        }
        payload.password = password;
      }

      await api.put('/settings/perfil', payload);
      setSuccessMsg('Perfil atualizado com sucesso!');
      setPassword('');
      loadProfile();
    } catch (err) {
      console.error(err);
      setErrorMsg(err instanceof Error ? err.message : 'Falha ao atualizar o perfil.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    document.cookie = 'auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    router.push('/login');
  };

  if (loading) {
    return (
      <div className={styles.container} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Loader2 size={32} className={styles.spin} style={{ color: 'var(--color-brand)' }} />
        <p style={{ marginTop: '16px', color: 'var(--color-text-secondary)' }}>Carregando perfil...</p>
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
        title="Meu Perfil"
        description="Gerencie suas credenciais de conta e configurações pessoais."
      />

      {successMsg && <div className={styles.msgSuccess}>{successMsg}</div>}
      {errorMsg && <div className={styles.msgError}>{errorMsg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px', marginTop: '24px' }}>
        <Card padding="md">
          <form onSubmit={handleUpdate} className={styles.form}>
            <div className={styles.formGroup}>
              <span className={styles.label}>E-mail da Conta</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', backgroundColor: '#f5f5f4', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                <Mail size={16} />
                <span>{profile?.email}</span>
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Nome de Exibição</label>
              <input 
                type="text" 
                required 
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Nova Senha</label>
              <input 
                type="password" 
                className={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Deixe em branco para manter a atual"
              />
            </div>

            <Button type="submit" disabled={actionLoading} style={{ alignSelf: 'flex-start' }}>
              {actionLoading ? <Loader2 size={14} className={styles.spin} /> : 'Salvar Alterações'}
            </Button>
          </form>

          <hr style={{ margin: '32px 0 24px 0', border: 'none', borderTop: '1px solid var(--color-border)' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ fontSize: '14px', fontWeight: 700, margin: 0 }}>Sair da conta</h4>
              <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: '2px 0 0 0' }}>Encerra a sessão ativa neste navegador.</p>
            </div>
            <button onClick={handleLogout} className={styles.disconnectBtn} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <LogOut size={14} />
              <span>Desconectar</span>
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}
