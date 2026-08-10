'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Bot, Brain, Trash2, Plus } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Toast from '@/components/ui/Toast';
import Card from '@/components/ui/Card';
import styles from './agent.module.css';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

interface BrandConfig {
  agentPrompt: string;
}

interface BrandMemory {
  brandSlug: string;
  preferences: Record<string, string>;
  updatedAt: number;
}

const DEFAULT_PROMPT = `Você é um assistente de design especializado em criação de conteúdo para redes sociais.

## Identidade
- Você trabalha para a marca [NOME_DA_MARCA]
- Segue rigorosamente a identidade visual definida
- Prioriza tipografia limpa e legibilidade

## Capacidades
- Gerar briefings detalhados para posts
- Analisar referências de marcas
- Sugerir paletas e composições
- Criar textos publicitários

## Diretrizes
- Mantenha consistência visual entre os criativos
- Use a paleta de cores oficial da marca
- Siga as referências de design aprovadas`;

export default function AgentPage() {
  const params = useParams();
  const slug = params.marca as string;
  const marca = decodeURIComponent(slug);
  
  // Agent State
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [savingAgent, setSavingAgent] = useState(false);
  
  // Memory State
  const [memory, setMemory] = useState<BrandMemory | null>(null);
  const [loadingMemory, setLoadingMemory] = useState(true);
  const [savingMemory, setSavingMemory] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    // Load Agent Config
    api.get<BrandConfig>(`/settings/${slug}/config`)
      .then((cfg) => { if (cfg?.agentPrompt) setPrompt(cfg.agentPrompt); })
      .catch(() => {});

    // Load Memory
    api.get<BrandMemory>(`/brands/${slug}/memory`)
      .then((mem) => { setMemory(mem); })
      .catch((err) => { console.error('Falha ao carregar memória', err); })
      .finally(() => setLoadingMemory(false));
  }, [slug]);

  const handleSaveAgent = async () => {
    setSavingAgent(true);
    setToast(null);
    try {
      await api.put(`/settings/${slug}/config`, { agentPrompt: prompt });
      setToast({ message: 'Agente IA salvo com sucesso!', type: 'success' });
    } catch {
      setToast({ message: 'Erro ao salvar. Tente novamente.', type: 'error' });
    } finally {
      setSavingAgent(false);
    }
  };

  const handleUpdateMemory = async (newPreferences: Record<string, string>) => {
    setSavingMemory(true);
    try {
      const mem = await api.put<BrandMemory>(`/brands/${slug}/memory`, {
        preferences: newPreferences,
      });
      setMemory(mem);
    } catch (err) {
      console.error('Falha ao atualizar memória', err);
    } finally {
      setSavingMemory(false);
    }
  };

  const handleAddMemory = () => {
    if (!newKey.trim() || !newValue.trim() || !memory) return;
    
    const key = newKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const updated = { ...memory.preferences, [key]: newValue.trim() };
    
    handleUpdateMemory(updated);
    setNewKey('');
    setNewValue('');
  };

  const handleDeleteMemory = (key: string) => {
    if (!memory) return;
    const updated = { ...memory.preferences };
    delete updated[key];
    handleUpdateMemory(updated);
  };

  // Ctrl+S shortcut for Agent Prompt
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveAgent();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  return (
    <div className={styles.container}>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <Link href={`/${params.marca}/configuracoes`} className={styles.backLink}>
        <ArrowLeft size={16} />
        Voltar para configurações
      </Link>

      <PageHeader
        title="Agente e Memória da IA"
        description={`Contexto base e regras aprendidas dinamicamente pelo Agente Criativo para "${marca}".`}
      />

      <div className={styles.twoColumns}>
        {/* Coluna 1: Prompt do Agente */}
        <section className={styles.section}>
          <div className={styles.premiumCard}>
            <div className={styles.cardContent}>
              <div className={styles.header}>
                <div className={styles.iconWrapper}>
                  <Bot size={24} />
                </div>
                <div className={styles.titleWrapper}>
                  <h3 className={styles.title}>System Prompt</h3>
                  <p className={styles.description}>
                    O comportamento base do agente. Use para definir a persona, tom de voz e como ele deve responder.
                  </p>
                </div>
              </div>

              <div className={styles.editorWrapper}>
                <textarea
                  className={styles.textarea}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Defina o comportamento do agente..."
                />
                <div className={styles.hint}>
                  <span>Salvo automaticamente pelo atalho Ctrl+S</span>
                  <span>{prompt.length.toLocaleString()} caracteres</span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto' }}>
                <Button size="sm" onClick={handleSaveAgent} disabled={savingAgent}>
                  <Save size={14} />
                  {savingAgent ? 'Salvando...' : 'Salvar Prompt'}
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Coluna 2: Memória (Regras e Preferências) */}
        <section className={styles.section}>
          <div className={styles.premiumCard}>
            <div className={styles.cardContent}>
              <div className={styles.header}>
                <div className={`${styles.iconWrapper} ${styles.memoryIcon}`}>
                  <Brain size={24} />
                </div>
                <div className={styles.titleWrapper}>
                  <h3 className={styles.title}>Preferências e Regras</h3>
                  <p className={styles.description}>
                    Memória dinâmica: o agente preenche essa lista organicamente durante o uso para aprender o gosto da marca.
                  </p>
                </div>
              </div>

              {loadingMemory ? (
                <div className={styles.emptyState}>Carregando...</div>
              ) : (
                <div className={styles.memoryList}>
                  {Object.entries(memory?.preferences || {}).length === 0 ? (
                    <div className={styles.emptyState}>
                      Nenhuma regra aprendida ainda. Adicione manualmente ou diga no chat algo como "nunca use a logo preta".
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
                            onClick={() => handleDeleteMemory(key)}
                            disabled={savingMemory}
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
                    disabled={savingMemory || loadingMemory}
                  />
                </div>
                <div className={styles.inputGroup}>
                  <input
                    type="text"
                    className={styles.input}
                    placeholder="Regra (ex: Sempre usar azul)"
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    disabled={savingMemory || loadingMemory}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddMemory();
                    }}
                  />
                </div>
                <div className={styles.addButton}>
                  <Button size="sm" onClick={handleAddMemory} disabled={!newKey.trim() || !newValue.trim() || savingMemory || loadingMemory}>
                    <Plus size={16} /> Adicionar
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
