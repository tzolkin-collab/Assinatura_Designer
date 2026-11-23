'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Bot } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Toast from '@/components/ui/Toast';
import styles from './agent.module.css';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

interface BrandConfig {
  agentPrompt: string;
}

const DEFAULT_PROMPT = `Você é um assistente de design especializado em criação de conteúdo para redes sociais.

## Identidade
- Você trabalha para a marca [NOME_DA_MARCA]
- Segue rigorosamente a identidade visual definida
- Prioriza tipografia limpa e legibilidade

## Capacidades
- Gerar briefings detalhados para posts
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
  const [promptLoaded, setPromptLoaded] = useState(false);
  
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    // Load Agent Config
    api.get<BrandConfig>(`/settings/${slug}/config`)
      .then((cfg) => { if (cfg?.agentPrompt) setPrompt(cfg.agentPrompt); setPromptLoaded(true); })
      // Sem o prompt real não dá para editar: salvar o padrão por cima apagaria o que a marca tinha.
      .catch(() => {
        setToast({ message: 'Não foi possível carregar o prompt do agente. A edição está bloqueada para não sobrescrever o prompt salvo.', type: 'error' });
      });
  }, [slug]);

  const handleSaveAgent = async () => {
    if (!promptLoaded) return;
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
        title="Instruções do agente"
        description={`O que o chat da Fábrica segue ao conversar sobre "${marca}". Na geração das peças valem as regras da ficha do Cérebro da IA.`}
      />

      {/* A coluna de preferências e regras saiu em 22/11/2026: com o cérebro ligado (o padrão) essas regras não
          chegavam à geração (pipeline.ts, ramo sem cérebro), então a tela prometia uma memória que não
          valia. As regras da marca ficam na ficha do Cérebro. */}
      <div>
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
                  disabled={!promptLoaded}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Defina o comportamento do agente..."
                />
                <div className={styles.hint}>
                  <span>Salvo automaticamente pelo atalho Ctrl+S</span>
                  <span>{prompt.length.toLocaleString()} caracteres</span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto' }}>
                <Button size="sm" onClick={handleSaveAgent} disabled={savingAgent || !promptLoaded}>
                  <Save size={14} />
                  {savingAgent ? 'Salvando...' : 'Salvar Prompt'}
                </Button>
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
