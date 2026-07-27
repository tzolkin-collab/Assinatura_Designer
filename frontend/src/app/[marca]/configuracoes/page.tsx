'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Bot, Palette, Eye, PlugZap, ChevronRight, Trash2, X, Users, Image as ImageIcon, BarChart3, Brain } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import styles from './configuracoes.module.css';
import { api } from '@/lib/api';

const CONFIG_SECTIONS = [
  {
    key: 'agent',
    label: 'Agente e Memória',
    description: 'Configure o SystemPrompt do Gemini e gerencie as regras/preferências aprendidas da marca.',
    icon: <Bot size={20} />,
  },
  {
    key: 'branding',
    label: 'Branding',
    description: 'Identidade visual, cores, tipografia e diretrizes da marca.',
    icon: <Palette size={20} />,
  },
  {
    key: 'referencias',
    label: 'Referências',
    description: 'Benchmarks e análises de marcas concorrentes via Gemini.',
    icon: <Eye size={20} />,
  },
  {
    key: 'equipe',
    label: 'Equipe e Permissões',
    description: 'Convide clientes e designers e defina quem pode editar ou apenas visualizar.',
    icon: <Users size={20} />,
  },
  {
    key: 'midia',
    label: 'Biblioteca de Mídia',
    description: 'Gerencie os uploads (imagens e fontes) compartilhados por esta marca.',
    icon: <ImageIcon size={20} />,
  },
  {
    key: 'billing',
    label: 'Gastos de IA',
    description: 'Consumo e custo estimado por modelo, mês a mês — gasto e impostos separados.',
    icon: <BarChart3 size={20} />,
  },
];

export default function ConfiguracoesPage() {
  const params = useParams();
  const router = useRouter();
  const marca = decodeURIComponent(params.marca as string);
  const slug = params.marca as string;

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleDeleteBrand = async () => {
    if (deleteConfirm !== marca) return;
    setDeleting(true);
    try {
      await api.delete(`/brands/${slug}`);
      router.push('/galeria');
    } catch {
      setDeleting(false);
    }
  };

  const closeModal = () => {
    if (deleting) return;
    setShowDeleteModal(false);
    setDeleteConfirm('');
  };

  return (
    <div>
      <Link href={`/${params.marca}/galeria`} className={styles.backLink}>
        <ArrowLeft size={16} />
        Voltar para galeria
      </Link>

      <PageHeader
        title="Configurações do Projeto"
        description={`Gerencie as configurações internas de "${marca}".`}
      />

      <div className={styles.infoRow}>
        <div className={styles.infoItem}>
          <span className={styles.infoLabel}>Slug</span>
          <code className={styles.infoValue}>{params.marca}</code>
        </div>
        <div className={styles.infoItem}>
          <span className={styles.infoLabel}>Projeto</span>
          <span className={styles.infoValue}>{marca}</span>
        </div>
      </div>

      <div className={styles.sections}>
        {CONFIG_SECTIONS.map((section) => (
          <Link
            key={section.key}
            href={`/${params.marca}/configuracoes/${section.key}`}
            className={styles.sectionLink}
          >
            <Card hover padding="md" style={{ height: '100%' }}>
              <div className={styles.sectionRow}>
                <div className={styles.sectionIcon}>{section.icon}</div>
                <div className={styles.sectionText}>
                  <h3 className={styles.sectionTitle}>{section.label}</h3>
                  <p className={styles.sectionDesc}>{section.description}</p>
                </div>
                <ChevronRight size={16} className={styles.sectionArrow} />
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <div className={styles.dangerZone}>
        <h3 className={styles.dangerTitle}>Zona de Perigo</h3>
        <div className={styles.dangerRow}>
          <div>
            <p className={styles.dangerLabel}>Apagar marca</p>
            <p className={styles.dangerDesc}>Remove permanentemente a marca e todo o seu conteúdo.</p>
          </div>
          <Button size="sm" onClick={() => setShowDeleteModal(true)} style={{ backgroundColor: 'transparent', borderColor: '#ef4444', color: '#ef4444' }}>
            <Trash2 size={14} />
            Apagar marca
          </Button>
        </div>
      </div>

      {showDeleteModal && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Apagar marca</h2>
              <button className={styles.modalClose} onClick={closeModal}>
                <X size={18} />
              </button>
            </div>
            <div className={styles.deleteWarning}>
              <p>
                Esta ação é <strong>irreversível</strong>. Todos os posts, pastas e
                configurações de <strong>{marca}</strong> serão apagados permanentemente.
              </p>
              <p className={styles.deleteConfirmLabel}>
                Digite <strong>{marca}</strong> para confirmar:
              </p>
              <input
                className={styles.deleteInput}
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder={marca}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleDeleteBrand()}
              />
            </div>
            <div className={styles.modalActions}>
              <Button type="button" variant="secondary" size="sm" onClick={closeModal} disabled={deleting}>
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={deleteConfirm !== marca || deleting}
                onClick={handleDeleteBrand}
                style={{ backgroundColor: '#ef4444', borderColor: '#ef4444' }}
              >
                {deleting ? 'Apagando...' : 'Apagar marca'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
