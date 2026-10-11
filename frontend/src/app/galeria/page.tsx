'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, Plus, Filter, Loader2, X, Trash2, Edit3, Lock, Check, TriangleAlert } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import styles from './galeria.module.css';
import { api, ApiError } from '@/lib/api';

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
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
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

  // Novo desdobramento (interno ou parceria) a partir de um projeto-base
  const [collabParent, setCollabParent] = useState<Brand | null>(null);
  const [collabName, setCollabName] = useState('');
  const [collabKind, setCollabKind] = useState<'INTERNAL' | 'PARTNERSHIP'>('INTERNAL');
  const [collabContext, setCollabContext] = useState('');
  const [collabPartner, setCollabPartner] = useState('');
  const [collabProtagonism, setCollabProtagonism] = useState(70);
  const [savingCollab, setSavingCollab] = useState(false);
  const [collabError, setCollabError] = useState('');

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
      await api.post(`/brands/${brandSlug}/access-requests`, {});
      alert('Solicitação de acesso enviada com sucesso!');
      loadBrands();
    } catch (err) {
      console.error(err);
      alert('Não foi possível enviar a solicitação.');
    } finally {
      setRequestingAccessSlug(null);
    }
  };

  const openCollabModal = (brand: Brand) => {
    setCollabParent(brand);
    setCollabName('');
    setCollabKind('INTERNAL');
    setCollabContext('');
    setCollabPartner('');
    setCollabProtagonism(70);
    setCollabError('');
  };

  const closeCollabModal = () => {
    if (savingCollab) return;
    setCollabParent(null);
  };

  const handleCreateCollab = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!collabParent || !collabName.trim()) return;
    setSavingCollab(true);
    setCollabError('');
    try {
      const context = collabContext.trim() ? { context: collabContext.trim() } : {};
      const details =
        collabKind === 'PARTNERSHIP'
          ? { ...context, partner: { name: collabPartner.trim() }, baseProtagonism: collabProtagonism }
          : context;
      await api.post(`/brands/${collabParent.slug}/collabs`, { name: collabName.trim(), kind: collabKind, details });
      setCollabParent(null);
      loadBrands();
    } catch (err) {
      setCollabError(err instanceof ApiError ? err.message : 'Não foi possível criar o desdobramento.');
    } finally {
      setSavingCollab(false);
    }
  };

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
        title="Galeria de Projetos"
        description="Cada projeto tem sua identidade; os desdobramentos herdam a do projeto-base."
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

      {/* Search & Filters */}
      <div className={styles.toolbar}>
        <div className={styles.searchWrapper}>
          <Input
            placeholder="Buscar projetos..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            icon={<Search size={16} />}
          />
        </div>
        <div style={{ position: 'relative' }}>
          <Button variant="secondary" size="sm" onClick={() => setShowFilterDropdown(!showFilterDropdown)}>
            <Filter size={14} />
            <span>Exibindo: {filterMode === 'my' ? 'Meus Projetos' : 'Descobrir Novos Projetos'}</span>
          </Button>
          {showFilterDropdown && (
            <div className={styles.dropdownList} style={{ position: 'absolute', right: 0, top: '42px', zIndex: 50, minWidth: '200px', boxShadow: 'var(--shadow-lg)' }} onMouseDown={(e) => e.preventDefault()}>
              <div 
                className={styles.dropdownItem} 
                onClick={() => { setFilterMode('my'); setShowFilterDropdown(false); }}
                style={{ fontWeight: filterMode === 'my' ? 600 : 400 }}
              >
                Meus Projetos
              </div>
              <div 
                className={styles.dropdownItem} 
                onClick={() => { setFilterMode('discover'); setShowFilterDropdown(false); }}
                style={{ fontWeight: filterMode === 'discover' ? 600 : 400 }}
              >
                Descobrir Projetos (Solicitar)
              </div>
            </div>
          )}
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
            <div key={ownerName} style={{ marginBottom: '32px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border, rgba(0,0,0,0.1))', paddingBottom: '8px', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-secondary, #666)' }}>
                  Proprietário: <span style={{ color: 'var(--color-text, #111)' }}>{ownerName}</span>
                </h3>
                <span style={{ fontSize: '12px', background: 'var(--color-surface, #f5f5f5)', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>
                  {ownerBrands.length} {ownerBrands.length === 1 ? 'projeto' : 'projetos'}
                </span>
              </div>
              
              <div className={styles.grid}>
                {ownerBrands.map((brand) => (
                  <div key={brand.slug} className={styles.cardWrapper}>
                    {filterMode === 'my' ? (
                      <Link href={`/${brand.slug}/galeria`} className={styles.cardLink}>
                        <Card hover padding="none">
                          <div className={styles.cardBanner} style={{ backgroundColor: brand.color || '#171717', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
                            {brand.logoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={brand.logoUrl} alt={brand.name} style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '16px' }} />
                            ) : (
                              <span className={styles.cardInitial}>{brand.name[0]}</span>
                            )}
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
                    ) : (
                      <div className={styles.cardLink} style={{ cursor: 'default' }}>
                        <Card padding="none">
                          <div className={styles.cardBanner} style={{ backgroundColor: brand.color || '#171717', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative', opacity: 0.85 }}>
                            {brand.logoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={brand.logoUrl} alt={brand.name} style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '16px' }} />
                            ) : (
                              <span className={styles.cardInitial}>{brand.name[0]}</span>
                            )}
                            <div style={{ position: 'absolute', right: '12px', top: '12px', backgroundColor: 'rgba(0,0,0,0.6)', padding: '6px', borderRadius: '50%', color: '#fff' }}>
                              <Lock size={14} />
                            </div>
                          </div>
                          <div className={styles.cardBody}>
                            <h3 className={styles.cardTitle}>{brand.name}</h3>
                            <div style={{ marginTop: '12px' }}>
                              {brand.pendingRequest ? (
                                <button disabled style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', width: '100%', padding: '8px', fontSize: '13px', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', backgroundColor: '#f5f5f4', fontWeight: 600 }}>
                                  <Check size={14} /> Solicitação Enviada
                                </button>
                              ) : (
                                <button 
                                  onClick={() => handleRequestAccess(brand.slug)}
                                  disabled={requestingAccessSlug === brand.slug}
                                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', width: '100%', padding: '8px', fontSize: '13px', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--color-accent)', cursor: 'pointer', fontWeight: 600 }}
                                >
                                  {requestingAccessSlug === brand.slug ? 'Enviando...' : 'Solicitar Acesso'}
                                </button>
                              )}
                            </div>
                          </div>
                        </Card>
                      </div>
                    )}

                    {filterMode === 'my' && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px 4px 0' }}>
                        {(collabsOf[brand.id] ?? []).map((c) => (
                          <Link
                            key={c.slug}
                            href={`/${c.slug}/galeria`}
                            title={c.kind === 'PARTNERSHIP' ? `Parceria${c.collab?.partner?.name ? ` com ${c.collab.partner.name}` : ''}` : 'Desdobramento interno'}
                            style={{ fontSize: '12px', padding: '3px 9px', borderRadius: '12px', border: '1px solid var(--color-border, rgba(0,0,0,0.12))', color: 'var(--color-text, #111)', textDecoration: 'none', background: 'var(--color-surface, #f5f5f5)' }}
                          >
                            {c.name}
                          </Link>
                        ))}
                        {!brand.parentBrandId && (brand.myRole === 'OWNER' || brand.myRole === 'ADMIN' || brand.myRole === 'EDITOR') && (
                          <button
                            type="button"
                            onClick={() => openCollabModal(brand)}
                            style={{ fontSize: '12px', padding: '3px 9px', borderRadius: '12px', border: '1px dashed var(--color-border, rgba(0,0,0,0.25))', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-secondary, #666)' }}
                          >
                            + Desdobramento
                          </button>
                        )}
                      </div>
                    )}

                    {filterMode === 'my' && (brand.myRole === 'OWNER' || brand.myRole === 'ADMIN') && (
                      <button
                        className={styles.cardEditBtn}
                        onClick={(e) => { e.preventDefault(); openEditModal(brand); }}
                        title="Editar marca"
                      >
                        <Edit3 size={13} />
                      </button>
                    )}
                    {filterMode === 'my' && brand.myRole === 'OWNER' && (
                      <button
                        className={styles.cardDeleteBtn}
                        onClick={(e) => { e.preventDefault(); setDeleteTarget(brand); }}
                        title="Apagar marca"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
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

      {/* Novo desdobramento Modal */}
      {collabParent && (
        <div className={styles.modalOverlay} onClick={closeCollabModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Novo desdobramento de {collabParent.name}</h2>
              <button className={styles.modalClose} onClick={closeCollabModal}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateCollab} className={styles.modalForm}>
              <p style={{ fontSize: '13px', color: 'var(--color-text-secondary, #666)', margin: '0 0 12px' }}>
                O desdobramento herda a identidade do projeto-base. Aqui você informa só o que muda.
              </p>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Nome</label>
                <input
                  className={styles.formInput}
                  value={collabName}
                  onChange={(e) => setCollabName(e.target.value)}
                  placeholder="Ex: Mentoria, Amanda + Estadão"
                  required
                  autoFocus
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Tipo</label>
                <div style={{ display: 'flex', gap: '16px', fontSize: '14px' }}>
                  <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input type="radio" name="collab-kind" checked={collabKind === 'INTERNAL'} onChange={() => setCollabKind('INTERNAL')} />
                    Interno
                  </label>
                  <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input type="radio" name="collab-kind" checked={collabKind === 'PARTNERSHIP'} onChange={() => setCollabKind('PARTNERSHIP')} />
                    Parceria com outra marca
                  </label>
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Contexto e objetivo</label>
                <textarea
                  className={styles.formInput}
                  value={collabContext}
                  onChange={(e) => setCollabContext(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="Para que serve este desdobramento"
                />
              </div>

              {collabKind === 'PARTNERSHIP' && (
                <>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Marca parceira</label>
                    <input
                      className={styles.formInput}
                      value={collabPartner}
                      onChange={(e) => setCollabPartner(e.target.value)}
                      placeholder="Nome do parceiro"
                      required
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>
                      Protagonismo de {collabParent.name}: {collabProtagonism}%
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={collabProtagonism}
                      onChange={(e) => setCollabProtagonism(Number(e.target.value))}
                    />
                    <span style={{ fontSize: '12px', color: 'var(--color-text-secondary, #666)' }}>
                      É a força da narrativa e da identidade, não uma divisão exata de área. Logo e guia visual do parceiro entram depois, pela biblioteca do projeto.
                    </span>
                  </div>
                </>
              )}

              {collabError && (
                <p role="alert" style={{ color: '#b91c1c', fontSize: '13px', margin: '0 0 8px' }}>{collabError}</p>
              )}

              <div className={styles.modalActions}>
                <Button type="button" variant="secondary" size="sm" onClick={closeCollabModal} disabled={savingCollab}>
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={savingCollab || !collabName.trim() || (collabKind === 'PARTNERSHIP' && !collabPartner.trim())}
                >
                  {savingCollab ? 'Criando...' : 'Criar desdobramento'}
                </Button>
              </div>
            </form>
          </div>
        </div>
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
