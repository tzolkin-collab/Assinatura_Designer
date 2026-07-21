'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Brain, Trash2, Plus } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { api } from '@/lib/api';
import styles from './memoria.module.css';

interface BrandMemory {
  brandSlug: string;
  preferences: Record<string, string>;
  updatedAt: number;
}

export default function MemoriaPage() {
  const params = useParams();
  const slug = params.marca as string;
  const marca = decodeURIComponent(slug);

  const [memory, setMemory] = useState<BrandMemory | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  useEffect(() => {
    async function loadMemory() {
      try {
        const res = await api.get(`/brands/${slug}/memory`) as any;
        setMemory(res.data.data);
      } catch (err) {
        console.error('Falha ao carregar memória', err);
      } finally {
        setLoading(false);
      }
    }
    loadMemory();
  }, [slug]);

  const handleUpdate = async (newPreferences: Record<string, string>) => {
    setSaving(true);
    try {
      const res = await api.put(`/brands/${slug}/memory`, {
        preferences: newPreferences,
      }) as any;
      setMemory(res.data.data);
    } catch (err) {
      console.error('Falha ao atualizar memória', err);
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = () => {
    if (!newKey.trim() || !newValue.trim() || !memory) return;
    
    const key = newKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const updated = { ...memory.preferences, [key]: newValue.trim() };
    
    handleUpdate(updated);
    setNewKey('');
    setNewValue('');
  };

  const handleDelete = (key: string) => {
    if (!memory) return;
    const updated = { ...memory.preferences };
    delete updated[key];
    handleUpdate(updated);
  };

  return (
    <div className={styles.container}>
      <Link href={`/${params.marca}/configuracoes`} className={styles.backLink}>
        <ArrowLeft size={16} />
        Voltar para Configurações
      </Link>

      <PageHeader
        title="Memória da IA"
        description={`Regras de design e preferências aprendidas sobre a marca "${marca}".`}
      />

      <section className={styles.section}>
        <Card>
          <div className={styles.cardContent}>
            <div className={styles.header}>
              <div className={styles.iconWrapper}>
                <Brain size={24} />
              </div>
              <div className={styles.titleWrapper}>
                <h3 className={styles.title}>Preferências e Regras</h3>
                <p className={styles.description}>
                  O Agente IA lê essas diretrizes toda vez que vai gerar um novo design para garantir consistência. Você pode dizer a ele no chat "sempre inclua o logo" e ele vai anotar aqui, ou você pode adicionar manualmente.
                </p>
              </div>
            </div>

            {loading ? (
              <div className={styles.emptyState}>Carregando...</div>
            ) : (
              <div className={styles.memoryList}>
                {Object.entries(memory?.preferences || {}).length === 0 ? (
                  <div className={styles.emptyState}>
                    Nenhuma regra aprendida ainda. O agente preencherá isso automaticamente durante o uso, ou você pode adicionar abaixo.
                  </div>
                ) : (
                  Object.entries(memory?.preferences || {}).map(([key, value]) => (
                    <div key={key} className={styles.memoryItem}>
                      <div className={styles.memoryContent}>
                        <div className={styles.memoryKey}>{key}</div>
                        <div className={styles.memoryValue}>{value}</div>
                      </div>
                      <div className={styles.memoryActions}>
                        <button
                          className={`${styles.actionButton} ${styles.danger}`}
                          onClick={() => handleDelete(key)}
                          disabled={saving}
                          title="Excluir regra"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            <div className={styles.form}>
              <div className={styles.inputGroup} style={{ flex: 0.3 }}>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="Chave (ex: background)"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  disabled={saving || loading}
                />
              </div>
              <div className={styles.inputGroup}>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="Regra (ex: Nunca usar fundos escuros)"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  disabled={saving || loading}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAdd();
                  }}
                />
              </div>
              <div className={styles.addButton}>
                <Button onClick={handleAdd} disabled={!newKey.trim() || !newValue.trim() || saving || loading}>
                  <Plus size={16} /> Adicionar
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
