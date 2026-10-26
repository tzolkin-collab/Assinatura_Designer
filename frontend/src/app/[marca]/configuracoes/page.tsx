'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, Trash2, X } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import styles from './configuracoes.module.css';
import { api } from '@/lib/api';
import { BRAND_SETTINGS } from '@/lib/navigation';

const CONFIG_SECTIONS = BRAND_SETTINGS.map((section) => ({
  key: section.key,
  label: section.label,
  description: section.description,
  icon: <section.icon size={20} />,
}));

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
      <PageHeader
        title="Configurações"
        description={`Ajustes internos de ${marca}.`}
      />

      <nav className={styles.sections} aria-label="Seções de configuração">
        {CONFIG_SECTIONS.map((section) => (
          <Link
            key={section.key}
            href={`/${params.marca}/configuracoes/${section.key}`}
            className={styles.sectionLink}
          >
            <span className={styles.sectionIcon}>{section.icon}</span>
            <span className={styles.sectionText}>
              <span className={styles.sectionTitle}>{section.label}</span>
              <span className={styles.sectionDesc}>{section.description}</span>
            </span>
            <ChevronRight size={16} className={styles.sectionArrow} aria-hidden="true" />
          </Link>
        ))}
      </nav>

      <p className={styles.slugNote}>
        Endereço da marca: <code>/{params.marca}</code>
      </p>

      <div className={styles.dangerZone}>
        <h3 className={styles.dangerTitle}>Zona de perigo</h3>
        <div className={styles.dangerRow}>
          <div>
            <p className={styles.dangerLabel}>Apagar marca</p>
            <p className={styles.dangerDesc}>Remove permanentemente a marca e todo o seu conteúdo.</p>
          </div>
          <Button size="sm" onClick={() => setShowDeleteModal(true)} style={{ backgroundColor: 'transparent', borderColor: 'var(--color-error)', color: 'var(--color-error)' }}>
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
