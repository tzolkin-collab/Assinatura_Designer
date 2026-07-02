'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Plus, Filter, Loader2, X, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import styles from './galeria.module.css';
import { api, ApiError } from '@/lib/api';

interface Brand {
  slug: string;
  name: string;
  color?: string;
  updatedAt: string;
  _count?: { posts: number };
}

export default function GaleriaPage() {
  const router = useRouter();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Nova Marca modal
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#171717');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Apagar marca
  const [deleteTarget, setDeleteTarget] = useState<Brand | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api.get<Brand[]>('/brands')
      .then((data) => setBrands(data ?? []))
      .catch(() => setBrands([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (showModal) setTimeout(() => nameInputRef.current?.focus(), 50);
  }, [showModal]);

  const filtered = brands.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreateBrand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const brand = await api.post<Brand>('/brands', { name: newName.trim(), color: newColor });
      setBrands((prev) => [brand, ...prev]);
      setShowModal(false);
      setNewName('');
      setNewColor('#171717');
      router.push(`/${brand.slug}/galeria`);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Erro ao criar marca.');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteBrand = async () => {
    if (!deleteTarget || deleteConfirm !== deleteTarget.name) return;
    setDeleting(true);
    try {
      await api.delete(`/brands/${deleteTarget.slug}`);
      setBrands((prev) => prev.filter((b) => b.slug !== deleteTarget.slug));
      setDeleteTarget(null);
      setDeleteConfirm('');
    } catch {
      // manter modal aberto em caso de erro
    } finally {
      setDeleting(false);
    }
  };

  const closeDeleteModal = () => {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteConfirm('');
  };

  return (
    <div>
      <PageHeader
        title="Galeria de Marcas"
        description="Gerencie seus projetos e acesse as configurações de cada marca."
        actions={
          <Link href="/onboarding">
            <Button size="sm">
              <Plus size={16} />
              Nova Marca
            </Button>
          </Link>
        }
      />

      {/* Search & Filters */}
      <div className={styles.toolbar}>
        <div className={styles.searchWrapper}>
          <Input
            placeholder="Buscar marcas..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            icon={<Search size={16} />}
          />
        </div>
        <Button variant="secondary" size="sm">
          <Filter size={14} />
          Filtros
        </Button>
      </div>

      {loading ? (
        <div className={styles.loadingState}>
          <Loader2 className={styles.spinner} />
          <p>Carregando marcas...</p>
        </div>
      ) : (
        <>
          <div className={styles.grid}>
            {filtered.map((brand) => (
              <div key={brand.slug} className={styles.cardWrapper}>
                <Link href={`/${brand.slug}/galeria`} className={styles.cardLink}>
                  <Card hover padding="none">
                    <div className={styles.cardBanner} style={{ backgroundColor: brand.color || '#171717' }}>
                      <span className={styles.cardInitial}>{brand.name[0]}</span>
                    </div>
                    <div className={styles.cardBody}>
                      <h3 className={styles.cardTitle}>{brand.name}</h3>
                      <div className={styles.cardMeta}>
                        <span>{brand._count?.posts || 0} posts</span>
                        <span className={styles.dot}>·</span>
                        <span>{new Date(brand.updatedAt).toLocaleDateString('pt-BR')}</span>
                      </div>
                    </div>
                  </Card>
                </Link>
                <button
                  className={styles.cardDeleteBtn}
                  onClick={(e) => { e.preventDefault(); setDeleteTarget(brand); }}
                  title="Apagar marca"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>

          {filtered.length === 0 && (
            <div className={styles.empty}>
              <p>{search ? `Nenhuma marca encontrada para "${search}"` : 'Nenhuma marca criada ainda.'}</p>
            </div>
          )}
        </>
      )}

      {/* Apagar Marca Modal */}
      {deleteTarget && (
        <div className={styles.modalOverlay} onClick={closeDeleteModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Apagar marca</h2>
              <button className={styles.modalClose} onClick={closeDeleteModal}>
                <X size={18} />
              </button>
            </div>

            <div className={styles.deleteWarning}>
              <p>
                Esta ação é <strong>irreversível</strong>. Todos os posts, pastas e
                configurações de <strong>{deleteTarget.name}</strong> serão apagados permanentemente.
              </p>
              <p className={styles.deleteConfirmLabel}>
                Digite <strong>{deleteTarget.name}</strong> para confirmar:
              </p>
              <input
                className={styles.formInput}
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder={deleteTarget.name}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleDeleteBrand()}
              />
            </div>

            <div className={styles.modalActions}>
              <Button type="button" variant="secondary" size="sm" onClick={closeDeleteModal} disabled={deleting}>
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={deleteConfirm !== deleteTarget.name || deleting}
                onClick={handleDeleteBrand}
                style={{ backgroundColor: '#ef4444', borderColor: '#ef4444' }}
              >
                {deleting ? 'Apagando...' : 'Apagar marca'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Nova Marca Modal */}
      {showModal && (
        <div className={styles.modalOverlay} onClick={() => setShowModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Nova Marca</h2>
              <button className={styles.modalClose} onClick={() => setShowModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateBrand} className={styles.modalForm}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Nome da marca</label>
                <input
                  ref={nameInputRef}
                  className={styles.formInput}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ex: Minha Marca"
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Cor de destaque</label>
                <div className={styles.colorPickerRow}>
                  <input
                    type="color"
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    className={styles.colorPicker}
                  />
                  <span className={styles.colorValue}>{newColor}</span>
                </div>
              </div>

              {createError && <p className={styles.formError}>{createError}</p>}

              <div className={styles.modalActions}>
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowModal(false)}>
                  Cancelar
                </Button>
                <Button type="submit" size="sm" disabled={creating || !newName.trim()}>
                  {creating ? 'Criando...' : 'Criar Marca'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
