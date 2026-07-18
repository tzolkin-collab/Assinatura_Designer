'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Plus } from 'lucide-react';
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

interface TenantMember {
  role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
  user: {
    id: string;
    name: string;
    email: string;
  };
}

interface TenantBrand {
  id: string;
  name: string;
  slug: string;
  color: string;
  createdAt: string;
  members: TenantMember[];
  _count: {
    posts: number;
    folders: number;
  };
}

export default function TenantsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [tenants, setTenants] = useState<TenantBrand[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = async () => {
    try {
      setLoading(true);
      setErrorMsg('');
      const userProfile = await api.get<UserProfile>('/settings/perfil');
      setProfile(userProfile);

      if (userProfile.role !== 'ADMIN') {
        router.push('/configuracoes');
        return;
      }

      const brands = await api.get<TenantBrand[]>('/settings/tenants');
      setTenants(brands);
    } catch (err) {
      console.error(err);
      setErrorMsg('Não foi possível carregar os dados de Tenants/Marcas.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return (
      <div className={styles.container} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Loader2 size={32} className={styles.spin} style={{ color: 'var(--color-brand)' }} />
        <p style={{ marginTop: '16px', color: 'var(--color-text-secondary)' }}>Carregando tenants...</p>
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
        title="Gestão de Tenants"
        description="Gerenciamento centralizado de marcas, acessos de membros e criação de tenants."
        actions={
          <Link href="/onboarding">
            <Button size="sm">
              <Plus size={16} />
              <span>Nova Marca</span>
            </Button>
          </Link>
        }
      />

      {errorMsg && <div className={styles.msgError}>{errorMsg}</div>}

      <div style={{ marginTop: '24px' }}>
        <Card padding="md">
          <div style={{ overflowX: 'auto' }}>
            <table className={styles.tenantTable}>
              <thead>
                <tr>
                  <th>Marca</th>
                  <th>Slug / Tenant ID</th>
                  <th>Criativos / Pastas</th>
                  <th>Membros com Acesso</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tenant) => (
                  <tr key={tenant.id} className={styles.tenantRow}>
                    <td>
                      <div className={styles.tenantNameCol}>
                        <div className={styles.tenantColorBadge} style={{ backgroundColor: tenant.color }} />
                        <span style={{ fontWeight: 700 }}>{tenant.name}</span>
                      </div>
                    </td>
                    <td><code>{tenant.slug}</code></td>
                    <td>{tenant._count.posts} posts / {tenant._count.folders} pastas</td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {tenant.members.map((m) => (
                          <span key={m.user.id} className={styles.memberBadge} data-role={m.role} title={m.user.email}>
                            {m.user.name} ({m.role.toLowerCase()})
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
