'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, Plus, Loader2, X, Trash2, Edit3, Lock, Check, TriangleAlert } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import styles from './galeria.module.css';
import { api } from '@/lib/api';
import NewCollabModal from '@/components/Collab/NewCollabModal';

interface Brand {
  id: string;
  /** BASE = projeto-base; INTERNAL / PARTNERSHIP = desdobramento ligado a um projeto-base. */
  kind?: 'BASE' | 'INTERNAL' | 'PARTNERSHIP';
  parentBrandId?: string | null;
  collab?: { baseProtagonism?: number; partner?: { name: string } } | null;
  slug: string;
  name: string;
  color?: string;
  logoUrl?: string;
  updatedAt: string;
  _count?: { posts: number };
  user?: {
    id: string;
    name: string;
    email: string;
  };
  myRole?: string;
  pendingRequest?: boolean;
}

/** Cor do texto legível sobre o fundo da marca (preto ou branco, pela luminância). */
function inkOn(hex: string | undefined): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#0a0a0a' : '#ffffff';
}

/** Capa da marca: o logo sobre a cor dela, ou só a cor quando não há logo (o nome está logo abaixo). */
function BrandCover({ brand, locked }: { brand: Brand; locked?: boolean }) {
  const bg = brand.color || '#171717';
  return (
    <div className={styles.cover} style={{ backgroundColor: bg, color: inkOn(bg) }}>
      {brand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoUrl} alt="" className={styles.coverLogo} />
      ) : null}
      {locked && <span className={styles.coverLock} aria-hidden="true"><Lock size={14} /></span>}
    </div>
  );
}

export default function GaleriaPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Aviso de "caiu aqui porque a marca não existe/você não tem acesso" —
  // useBrandPermissions redireciona pra cá com ?erro=marca-invalida em vez de
  // deixar a página da marca presa numa tela quebrada. Lido uma vez do query
  // param (não precisa reagir a mudanças) e a URL é limpa em seguida, senão
  // um refresh da página repetiria o aviso indefinidamente.
  const [erroMarcaInvalida, setErroMarcaInvalida] = useState(false);
  useEffect(() => {
    if (searchParams?.get('erro') === 'marca-invalida') {
      setErroMarcaInvalida(true);
      router.replace('/galeria');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  // Filtros
  const [filterMode, setFilterMode] = useState<'my' | 'discover'>('my');
  const [requestingAccessSlug, setRequestingAccessSlug] = useState<string | null>(null);

  // Apagar marca
  const [deleteTarget, setDeleteTarget] = useState<Brand | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Editar marca
  const [editTarget, setEditTarget] = useState<Brand | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#171717');
  const [savingEdit, setSavingEdit] = useState(false);

  // Novo desdobramento a partir de um projeto-base (o formulário é o NewCollabModal)
  const [collabParent, setCollabParent] = useState<Brand | null>(null);

  const loadBrands = () => {
    setLoading(true);
    const endpoint = filterMode === 'my' ? '/brands' : '/brands/discover';
    api.get<Brand[]>(endpoint)
      .then((data) => setBrands(data ?? []))
      .catch(() => setBrands([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadBrands();
  }, [filterMode]);

  const filtered = brands.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase())
  );

  // Agrupa as marcas pelo proprietário (owner)
  // Desdobramentos aparecem dentro do projeto-base, nao como cards soltos. Se a base nao esta
  // na lista (busca ou falta de acesso), o desdobramento sobe para o topo e nao some.
  const collabsOf: { [parentId: string]: Brand[] } = {};
  filtered.forEach((b) => {
    if (b.parentBrandId) (collabsOf[b.parentBrandId] ??= []).push(b);
  });
  const topLevel = filtered.filter(
    (b) => !b.parentBrandId || !filtered.some((p) => p.id === b.parentBrandId),
  );

  const groups: { [ownerName: string]: Brand[] } = {};
  topLevel.forEach((brand) => {
    const ownerName = brand.user?.name || 'Sem Proprietário';
    if (!groups[ownerName]) {
      groups[ownerName] = [];
    }
    groups[ownerName].push(brand);
  });

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

  const handleEditBrand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget || !editName.trim()) return;
    setSavingEdit(true);
    try {
      const updated = await api.put<Brand>(`/brands/${editTarget.slug}`, { name: editName.trim(), color: editColor });
      setBrands((prev) => prev.map((b) => (b.slug === editTarget.slug ? { ...b, ...updated } : b)));
      setEditTarget(null);
    } catch {
      // manter modal aberto em caso de erro
    } finally {
      setSavingEdit(false);
    }
  };

  const handleRequestAccess = async (brandSlug: string) => {
    setRequestingAccessSlug(brandSlug);
    try {
      await api.post(`/brands/${brandSlug}/request-access`, {});
      alert('Solicitação de acesso enviada com sucesso!');
      loadBrands();
    } catch (err) {
      console.error(err);
      alert('Não foi possível enviar a solicitação.');
    } finally {
      setRequestingAccessSlug(null);
    }
  };

  const openCollabModal = (brand: Brand) => setCollabParent(brand);

  const openEditModal = (brand: Brand) => {
    setEditTarget(brand);
    setEditName(brand.name);
    setEditColor(brand.color || '#171717');
  };

  const closeEditModal = () => {
    if (savingEdit) return;
    setEditTarget(null);
  };

  const closeDeleteModal = () => {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteConfirm('');
  };

  return (
    <div>
      <PageHeader
        title="Marcas"
        description="Entre numa marca para criar e publicar. Os desdobramentos herdam a identidade do projeto-base."
        actions={
          <Link href="/onboarding">
            <Button size="sm">
              <Plus size={16} />
              Novo Projeto
            </Button>
          </Link>
        }
      />

      {erroMarcaInvalida && (
        <div
          role="alert"
          style={{
            display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 16px',
            padding: '10px 14px', borderRadius: 10, fontSize: 13.5,
            background: '#fef3c7', border: '1px solid #fde68a', color: '#92400e',
          }}
        >
          <TriangleAlert size={16} style={{ flexShrink: 0 }} />
          <span>Essa marca não existe ou você não tem acesso a ela. Escolha uma marca abaixo.</span>
          <button
            type="button"
            onClick={() => setErroMarcaInvalida(false)}
            aria-label="Fechar aviso"
            style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', display: 'flex' }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Busca e escopo */}
      <div className={styles.toolbar}>
        <div className={styles.searchWrapper}>
          <Input
            placeholder="Buscar marcas..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            icon={<Search size={16} />}
          />
        </div>
        <div className={styles.seg} role="group" aria-label="Escopo">
          <button type="button" className={`${styles.segBtn} ${filterMode === 'my' ? styles.segBtnOn : ''}`} aria-pressed={filterMode === 'my'} onClick={() => setFilterMode('my')}>
            Meus projetos
          </button>
          <button type="button" className={`${styles.segBtn} ${filterMode === 'discover' ? styles.segBtnOn : ''}`} aria-pressed={filterMode === 'discover'} onClick={() => setFilterMode('discover')}>
            Descobrir
          </button>
        </div>
      </div>

      {loading ? (
        <div className={styles.loadingState}>
          <Loader2 className={styles.spinner} />
          <p>Carregando projetos...</p>
        </div>
      ) : (
        <>
          {Object.entries(groups).map(([ownerName, ownerBrands]) => (
            <section key={ownerName} className={styles.group}>
              {Object.keys(groups).length > 1 && (
                <div className={styles.groupHead}>
                  <h2 className={styles.groupName}>{ownerName}</h2>
                  <span className={styles.groupCount}>
                    {ownerBrands.length} {ownerBrands.length === 1 ? 'projeto' : 'projetos'}
                  </span>
                </div>
              )}

              <div className={styles.grid}>
                {ownerBrands.map((brand) => {
                  const posts = brand._count?.posts ?? 0;
                  const podeDesdobrar = !brand.parentBrandId && (brand.myRole === 'OWNER' || brand.myRole === 'ADMIN' || brand.myRole === 'EDITOR');
                  const filhos = collabsOf[brand.id] ?? [];
                  return (
                    <div key={brand.slug} className={styles.cardWrapper}>
                      {filterMode === 'my' ? (
                        <Link href={`/${brand.slug}`} className={styles.card}>
                          <BrandCover brand={brand} />
                          <div className={styles.cardBody}>
                            <h3 className={styles.cardTitle}>{brand.name}</h3>
                            <p className={styles.cardMeta}>
                              {posts === 0 ? 'Nenhuma peça ainda' : `${posts} ${posts === 1 ? 'peça' : 'peças'}`}
                            </p>
                          </div>
                        </Link>
                      ) : (
                        <div className={`${styles.card} ${styles.cardStatic}`}>
                          <BrandCover brand={brand} locked />
                          <div className={styles.cardBody}>
                            <h3 className={styles.cardTitle}>{brand.name}</h3>
                            {brand.pendingRequest ? (
                              <button type="button" disabled className={`${styles.requestBtn} ${styles.requestBtnDone}`}>
                                <Check size={14} /> Solicitação enviada
                              </button>
                            ) : (
                              <button
                                type="button"
                                className={styles.requestBtn}
                                onClick={() => handleRequestAccess(brand.slug)}
                                disabled={requestingAccessSlug === brand.slug}
                              >
                                {requestingAccessSlug === brand.slug ? 'Enviando...' : 'Solicitar acesso'}
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {filterMode === 'my' && (filhos.length > 0 || podeDesdobrar) && (
                        <div className={styles.collabs}>
                          {filhos.map((c) => (
                            <Link
                              key={c.slug}
                              href={`/${c.slug}/galeria`}
                              className={styles.collabLink}
                              title={c.kind === 'PARTNERSHIP' ? `Parceria${c.collab?.partner?.name ? ` com ${c.collab.partner.name}` : ''}` : 'Desdobramento interno'}
                            >
                              {c.name}
                            </Link>
                          ))}
                          {podeDesdobrar && (
                            <button type="button" className={styles.collabAdd} onClick={() => openCollabModal(brand)}>
                              <Plus size={12} /> Desdobramento
                            </button>
                          )}
                        </div>
                      )}

                      {filterMode === 'my' && (brand.myRole === 'OWNER' || brand.myRole === 'ADMIN') && (
                        <button
                          type="button"
                          className={styles.cardEditBtn}
                          onClick={(e) => { e.preventDefault(); openEditModal(brand); }}
                          title="Editar marca"
                          aria-label={`Editar ${brand.name}`}
                        >
                          <Edit3 size={13} />
                        </button>
                      )}
                      {filterMode === 'my' && brand.myRole === 'OWNER' && (
                        <button
                          type="button"
                          className={styles.cardDeleteBtn}
                          onClick={(e) => { e.preventDefault(); setDeleteTarget(brand); }}
                          title="Apagar marca"
                          aria-label={`Apagar ${brand.name}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          {filtered.length === 0 && (
            <div className={styles.empty}>
              <p>
                {search 
                  ? `Nenhum projeto encontrado para "${search}"` 
                  : filterMode === 'my' 
                    ? 'Nenhum projeto criado ainda.' 
                    : 'Todos os projetos do sistema já pertencem ao seu perfil.'
                }
              </p>
            </div>
          )}
        </>
      )}

      {/* Novo desdobramento */}
      {collabParent && (
        <NewCollabModal
          parent={collabParent}
          onClose={() => setCollabParent(null)}
          onCreated={() => {
            setCollabParent(null);
            loadBrands();
          }}
        />
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

      {/* Editar Marca Modal */}
      {editTarget && (
        <div className={styles.modalOverlay} onClick={closeEditModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Editar Marca</h2>
              <button className={styles.modalClose} onClick={closeEditModal}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleEditBrand} className={styles.modalForm}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Nome da marca</label>
                <input
                  className={styles.formInput}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Ex: Minha Marca"
                  required
                  autoFocus
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Cor de destaque</label>
                <div className={styles.colorPickerRow}>
                  <input
                    type="color"
                    value={editColor}
                    onChange={(e) => setEditColor(e.target.value)}
                    className={styles.colorPicker}
                  />
                  <span className={styles.colorValue}>{editColor}</span>
                </div>
              </div>

              <div className={styles.modalActions}>
                <Button type="button" variant="secondary" size="sm" onClick={closeEditModal} disabled={savingEdit}>
                  Cancelar
                </Button>
                <Button type="submit" size="sm" disabled={savingEdit || !editName.trim()}>
                  {savingEdit ? 'Salvando...' : 'Salvar Alterações'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
