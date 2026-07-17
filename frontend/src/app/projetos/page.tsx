'use client';

import React, { useEffect, useState } from 'react';
import { Globe, Plus, Clock } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { api } from '@/lib/api';
import styles from '../galeria/galeria.module.css';

interface BrandDiscovery {
  id: string;
  slug: string;
  name: string;
  color: string | null;
  pendingRequest: boolean;
  user?: { name: string; email: string };
  _count: { posts: number };
}

export default function ProjetosPage() {
  const [brands, setBrands] = useState<BrandDiscovery[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchBrands();
  }, []);

  const fetchBrands = async () => {
    try {
      const res = await api.get<BrandDiscovery[]>('/brands/discover');
      setBrands(res || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRequestAccess = async (slug: string) => {
    try {
      await api.post(`/brands/${slug}/request-access`, {});
      setBrands(prev => prev.map(b => b.slug === slug ? { ...b, pendingRequest: true } : b));
    } catch (err) {
      console.error('Failed to request access', err);
    }
  };

  if (isLoading) {
    return <div style={{ padding: '2rem' }}>Carregando projetos...</div>;
  }

  // Agrupar brands por owner
  const groupedBrands = brands.reduce((acc, brand) => {
    const ownerName = brand.user?.name || brand.user?.email || 'Desconhecidos / Sem dono';
    if (!acc[ownerName]) {
      acc[ownerName] = [];
    }
    acc[ownerName].push(brand);
    return acc;
  }, {} as Record<string, BrandDiscovery[]>);

  const ownerGroups = Object.entries(groupedBrands).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div>
      <PageHeader
        title="Projetos da Equipe"
        description="Descubra e solicite acesso a projetos criados por outros membros da agência."
        icon={<Globe size={24} style={{ color: 'var(--color-brand)' }} />}
      />

      {brands.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 0', color: 'var(--color-text-secondary)' }}>
          <Globe size={48} style={{ margin: '0 auto 1rem', opacity: 0.2 }} />
          <h3>Nenhum projeto novo</h3>
          <p>Você já tem acesso a todos os projetos cadastrados na plataforma.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem', paddingBottom: '2rem' }}>
          {ownerGroups.map(([ownerName, ownerBrands]) => (
            <section key={ownerName}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
                Projetos de {ownerName}
              </h2>
              
              <div className={styles.grid}>
                {ownerBrands.map(brand => (
                  <div key={brand.id} className={styles.cardWrapper}>
                    <Card hover padding="none">
                      <div
                        className={styles.cardBanner}
                        style={{ backgroundColor: brand.color || 'var(--color-brand)' }}
                      >
                        <span className={styles.cardInitials}>
                          {brand.name.substring(0, 2).toUpperCase()}
                        </span>
                      </div>
                      
                      <div className={styles.cardBody}>
                        <h3 className={styles.cardTitle}>{brand.name}</h3>
                        <div className={styles.cardMeta}>
                          <span>{brand._count.posts} {brand._count.posts === 1 ? 'arte' : 'artes'}</span>
                        </div>
                        
                        <div style={{ marginTop: '1rem' }}>
                          {brand.pendingRequest ? (
                            <Button variant="secondary" disabled style={{ width: '100%', opacity: 0.5 }}>
                              <Clock size={16} /> Acesso Pendente
                            </Button>
                          ) : (
                            <Button variant="primary" onClick={() => handleRequestAccess(brand.slug)} style={{ width: '100%' }}>
                              <Plus size={16} /> Solicitar Acesso
                            </Button>
                          )}
                        </div>
                      </div>
                    </Card>
                  </div>
                ))}
              </div>
            </section>
      ))}
        </div>
      )}
    </div>
  );
}
