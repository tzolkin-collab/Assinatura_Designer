'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Toast from '@/components/ui/Toast';
import styles from './agent.module.css';
import { useState, useEffect, useCallback } from 'react';
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
- Analisar benchmarks de concorrentes
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
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    api.get<BrandConfig>(`/settings/${slug}/config`)
      .then((cfg) => { if (cfg?.agentPrompt) setPrompt(cfg.agentPrompt); })
      .catch(() => {});
  }, [slug]);

  const handleSave = async () => {
    setSaving(true);
    setToast(null);
    try {
      await api.put(`/settings/${slug}/config`, { agentPrompt: prompt });
      setToast({ message: 'Agente IA salvo com sucesso!', type: 'success' });
    } catch {
      setToast({ message: 'Erro ao salvar. Tente novamente.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // Ctrl+S shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  return (
    <div>
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
        title="Agente IA"
        description={`SystemPrompt do agente Gemini para "${marca}". Edite o contexto e comportamento da IA.`}
        actions={
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save size={14} />
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        }
      />

      <div className={styles.editorWrapper}>
        <label className={styles.label}>SystemPrompt</label>
        <textarea
          className={styles.textarea}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={20}
          placeholder="Defina o comportamento do agente..."
        />
        <p className={styles.hint}>
          Este prompt será usado como contexto nas interações com o Gemini na Fábrica.
          <span style={{ float: 'right' }}>{prompt.length.toLocaleString()} caracteres</span>
        </p>
      </div>
    </div>
  );
}
