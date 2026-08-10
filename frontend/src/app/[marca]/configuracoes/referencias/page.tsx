'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import Image from 'next/image';
import { ArrowLeft, ExternalLink, RefreshCw, X, Loader2, ImageIcon, Wrench } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import styles from './referencias.module.css';
import { useState, useEffect, useRef, useCallback } from 'react';
import { api, ApiError } from '@/lib/api';

interface ReferenceMarker {
  id: string;
  x: number; // Porcentagem (0-100)
  y: number; // Porcentagem (0-100)
  label: string;
}

interface Reference {
  id: string;
  name: string;
  status: 'PENDING' | 'ANALYZED' | 'FAILED';
  insights: number;
  insightsText?: string;
  analysisUrl?: string;
  sourceType: 'WEBSITE' | 'INSTAGRAM';
  imageUrl?: string;
  galleryImageUrls?: string[];
  markers?: ReferenceMarker[];
  archetype?: string;
  toneOfVoice?: string;
  density?: string;
  palette?: string[];
  createdAt: string;
  updatedAt: string;
}


export default function ReferenciasPage() {
  const params = useParams();
  const slug = params.marca as string;

  const [refs, setRefs] = useState<Reference[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRefId, setActiveRefId] = useState<string | null>(null);
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const activeRef = refs.find((r) => r.id === activeRefId) ?? null;

  // Ferramentas globais
  const [autoResearchEnabled, setAutoResearchEnabled] = useState(false);
  const [autoResearchInterval, setAutoResearchInterval] = useState(14);
  const [savingTools, setSavingTools] = useState(false);

  // "+ referência avulsa" (secundário, sem descoberta)
  const [avulsoOpen, setAvulsoOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [avulsoSourceType, setAvulsoSourceType] = useState<'WEBSITE' | 'INSTAGRAM'>('WEBSITE');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const avulsoNameRef = useRef<HTMLInputElement>(null);


  const fetchRefs = useCallback(() => {
    api.get<Reference[]>(`/settings/${slug}/referencias`)
      .then((data) => {
        setRefs(data ?? []);
      })
      .catch(() => setRefs([]))
      .finally(() => setLoading(false));
  }, [slug]);

  const fetchToolsConfig = useCallback(() => {
    api.get<{ autoResearchEnabled?: boolean; autoResearchInterval?: number }>(`/settings/${slug}/config`)
      .then((data) => {
        setAutoResearchEnabled(!!data?.autoResearchEnabled);
        setAutoResearchInterval(data?.autoResearchInterval ?? 14);
      })
      .catch(() => {});
  }, [slug]);

  useEffect(() => {
    fetchRefs();
    fetchToolsConfig();
  }, [fetchRefs, fetchToolsConfig]);

  useEffect(() => {
    if (avulsoOpen) setTimeout(() => avulsoNameRef.current?.focus(), 50);
  }, [avulsoOpen]);

  // Poll de referências PENDENTES até resolverem
  useEffect(() => {
    const hasPending = refs.some((r) => r.status === 'PENDING');
    if (!hasPending) return;
    const timer = setTimeout(fetchRefs, 5000);
    return () => clearTimeout(timer);
  }, [refs, fetchRefs]);

  const handleSaveTools = async (enabled: boolean, interval: number) => {
    setSavingTools(true);
    try {
      await api.put(`/settings/${slug}/config`, { autoResearchEnabled: enabled, autoResearchInterval: interval });
      setAutoResearchEnabled(enabled);
      setAutoResearchInterval(interval);
    } catch (error) {
      console.error('Failed to update auto-research settings', error);
      alert('Não foi possível atualizar a pesquisa automática.');
    } finally {
      setSavingTools(false);
    }
  };

  const handleCreateAvulso = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const ref = await api.post<Reference>(`/settings/${slug}/referencias`, {
        name: newName.trim(),
        analysisUrl: newUrl.trim() || undefined,
        sourceType: avulsoSourceType,
      });
      setRefs((prev) => [ref, ...prev]);
      setActiveRefId(ref.id);
      setAvulsoOpen(false);
      setNewName('');
      setNewUrl('');
      setAvulsoSourceType('WEBSITE');
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Erro ao criar referência.');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    const ref = refs.find((r) => r.id === id);
    if (!window.confirm(`Tem certeza que deseja remover "${ref?.name ?? 'esta referência'}"?`)) return;
    await api.delete(`/settings/${slug}/referencias/${id}`).catch(() => {});
    setRefs((prev) => prev.filter((r) => r.id !== id));
    if (activeRefId === id) setActiveRefId(null);
  };

  const handleForceSync = async (refId: string) => {
    try {
      setRefs((prev) => prev.map((r) => r.id === refId ? { ...r, status: 'PENDING' } : r));
      await api.post(`/settings/${slug}/referencias/${refId}/sync`, {});
    } catch (error) {
      console.error('Failed to force sync', error);
      alert('Não foi possível iniciar a atualização.');
    }
  };

  // Upload manual de print: o Instagram bloqueia captura automática de tela, então
  // isto é o jeito confiável de dar visão REAL pra uma referência do Instagram —
  // funciona sempre, sem depender de nenhum scraper de terceiro.
  const handleUploadImage = async (refId: string, file: File) => {
    setCapturingScreenshot(true);
    try {
      setRefs((prev) => prev.map((r) => r.id === refId ? { ...r, status: 'PENDING' } : r));
      await api.uploadFile(`/settings/${slug}/referencias/${refId}/upload-imagem`, file);
    } catch (error) {
      console.error('Failed to upload reference image', error);
      alert('Não foi possível enviar a imagem.');
    } finally {
      setCapturingScreenshot(false);
    }
  };


  const statusLabel = (status: Reference['status']) => {
    if (status === 'ANALYZED') return 'Analisado';
    if (status === 'FAILED') return 'Falhou';
    return 'Pendente';
  };

  const statusClass = (status: Reference['status']) => {
    if (status === 'ANALYZED') return styles.badgeDone;
    if (status === 'FAILED') return styles.badgeFailed;
    return styles.badgePending;
  };

  const galleryImages = activeRef
    ? (activeRef.galleryImageUrls && activeRef.galleryImageUrls.length > 0
      ? activeRef.galleryImageUrls
      : activeRef.imageUrl ? [activeRef.imageUrl] : [])
    : [];

  return (
    <div>
      <Link href={`/${params.marca}/configuracoes`} className={styles.backLink}>
        <ArrowLeft size={16} />
        Voltar para configurações
      </Link>

      <PageHeader
        title="Referências"
        description="Marcas de referência analisadas pelo agente — site e Instagram."
      />

      <div className={styles.toolsPanel}>
        <div className={styles.toolsRow}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ padding: '6px', backgroundColor: 'var(--color-bg-secondary)', borderRadius: '6px' }}>
              <Wrench size={16} color="var(--color-accent)" />
            </div>
            <div>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)', display: 'block' }}>Pesquisa automática</span>
              <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>Reanalisa as referências da marca periodicamente</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {autoResearchEnabled && (
              <select
                className={styles.formInput}
                value={autoResearchInterval}
                onChange={(e) => handleSaveTools(true, Number(e.target.value))}
                disabled={savingTools}
                style={{ padding: '4px 8px', fontSize: 12 }}
              >
                <option value={7}>A cada 1 semana</option>
                <option value={14}>A cada 2 semanas</option>
              </select>
            )}
            <label className={styles.switch}>
              <input
                type="checkbox"
                checked={autoResearchEnabled}
                disabled={savingTools}
                onChange={(e) => handleSaveTools(e.target.checked, autoResearchInterval)}
              />
              <span className={styles.slider}></span>
            </label>
          </div>
        </div>
        <button type="button" className={styles.toolsLink} onClick={() => setAvulsoOpen(true)}>
          + referência avulsa (adicionar 1 concorrente manualmente, sem descoberta)
        </button>
      </div>

      {loading ? (
        <div className={styles.loadingState}>
          <Loader2 className={styles.spinner} />
          <p>Carregando referências...</p>
        </div>
      ) : refs.length === 0 ? (
        <p className={styles.empty}>Nenhuma referência ainda. Use &quot;+ referência avulsa&quot; para adicionar uma marca.</p>
      ) : (
        <>
          <div className={styles.refTabs}>
            {refs.map((ref) => (
              <button
                key={ref.id}
                type="button"
                className={`${styles.refTab} ${activeRefId === ref.id ? styles.refTabActive : ''}`}
                onClick={() => setActiveRefId(ref.id)}
              >
                {ref.status === 'PENDING' && <Loader2 size={12} className={styles.spinnerSmall} />}
                {ref.name}
              </button>
            ))}
          </div>

          {!activeRef && (
            <p className={styles.empty}>Selecione uma aba acima para ver os insights.</p>
          )}

          {activeRef && (
            <Card padding="lg">
              <div className={styles.modalHeader}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <h2 className={styles.modalTitle}>{activeRef.name}</h2>
                    <span className={[styles.badge, statusClass(activeRef.status)].join(' ')}>{statusLabel(activeRef.status)}</span>
                  </div>
                  {activeRef.analysisUrl && (
                    <a href={activeRef.analysisUrl} target="_blank" rel="noreferrer" className={styles.urlLink}>
                      {activeRef.analysisUrl} <ExternalLink size={12} />
                    </a>
                  )}
                </div>
                <button className={styles.deleteBtn} onClick={() => handleDelete(activeRef.id)} title="Remover">
                  <X size={16} />
                </button>
              </div>

              <div className={styles.insightsBody}>
                <div className={styles.propertiesGrid}>
                  <div className={styles.propertyCard}>
                    <span className={styles.propertyLabel}>Arquetipo</span>
                    <span className={styles.propertyValue}>{activeRef.archetype || 'Não definido'}</span>
                  </div>
                  <div className={styles.propertyCard}>
                    <span className={styles.propertyLabel}>Tom de Voz</span>
                    <span className={styles.propertyValue}>{activeRef.toneOfVoice || 'Não definido'}</span>
                  </div>
                  <div className={styles.propertyCard}>
                    <span className={styles.propertyLabel}>Densidade</span>
                    <span className={styles.propertyValue}>{activeRef.density || 'Não definida'}</span>
                  </div>
                  <div className={styles.propertyCard}>
                    <span className={styles.propertyLabel}>Paleta</span>
                    <div className={styles.colorPalette}>
                      {activeRef.palette && activeRef.palette.length > 0 ? (
                        activeRef.palette.map((color, idx) => (
                          <div key={idx} className={styles.colorDot} style={{ backgroundColor: color }} title={color} />
                        ))
                      ) : (
                        <span className={styles.propertyValue} style={{ color: 'var(--color-text-tertiary)' }}>Sem paleta</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className={styles.imagePreviewSection}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                    <h3 className={styles.sectionTitle} style={{ margin: 0 }}>Imagens coletadas</h3>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        ref={uploadInputRef}
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleUploadImage(activeRef.id, file);
                          e.target.value = '';
                        }}
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={capturingScreenshot || activeRef.status === 'PENDING'}
                        onClick={() => uploadInputRef.current?.click()}
                        title={activeRef.sourceType === 'INSTAGRAM'
                          ? 'O Instagram bloqueia captura automática — envie um print de verdade do perfil/post'
                          : 'Enviar um print manualmente em vez de esperar a captura automática'}
                      >
                        {capturingScreenshot ? <Loader2 size={14} className={styles.spin} /> : <ImageIcon size={14} />}
                        Enviar print
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={activeRef.status === 'PENDING'}
                        onClick={() => handleForceSync(activeRef.id)}
                        title="Forçar atualização da imagem e dos insights agora"
                      >
                        <RefreshCw size={14} className={activeRef.status === 'PENDING' ? styles.spin : ''} />
                        Refazer Análise
                      </Button>
                    </div>
                  </div>
                  {activeRef.sourceType === 'INSTAGRAM' && (
                    <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: '0 0 10px' }}>
                      O Instagram bloqueia captura automática de tela — &quot;Refazer Análise&quot; tenta buscar posts recentes automaticamente, mas &quot;Enviar print&quot; garante uma análise visual real a qualquer momento.
                    </p>
                  )}
                  {galleryImages.length > 0 ? (
                    <div className={styles.galleryGrid}>
                      {galleryImages.map((url, i) => (
                        <div key={i} className={styles.galleryThumb}>
                          <Image src={url} alt={`${activeRef.name} — imagem ${i + 1}`} fill style={{ objectFit: 'cover' }} unoptimized />
                          {i === 0 && activeRef.markers?.map((marker, index) => (
                            <div key={marker.id} className={styles.marker} style={{ top: `${marker.y}%`, left: `${marker.x}%` }}>
                              <span className={styles.markerDot}>{index + 1}</span>
                              <div className={styles.markerTooltip}>{marker.label}</div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', margin: 0 }}>
                      Nenhuma imagem disponível. A imagem será capturada automaticamente, ou envie um print manualmente.
                    </p>
                  )}
                </div>

                <div className={styles.markdownWrapper}>
                  <h3 className={styles.sectionTitle}>Insights Estratégicos</h3>
                  <ReactMarkdown>{activeRef.insightsText || 'Nenhum insight disponível.'}</ReactMarkdown>
                </div>
              </div>
            </Card>
          )}
        </>
      )}

      {/* "+ referência avulsa" Modal */}
      {avulsoOpen && (
        <div className={styles.modalOverlay} onClick={() => setAvulsoOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Referência avulsa</h2>
              <button className={styles.modalClose} onClick={() => setAvulsoOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateAvulso} className={styles.modalForm}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Tipo de Referência</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Button
                    type="button"
                    variant={avulsoSourceType === 'WEBSITE' ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => setAvulsoSourceType('WEBSITE')}
                    style={{ flex: 1 }}
                  >
                    Website
                  </Button>
                  <Button
                    type="button"
                    variant={avulsoSourceType === 'INSTAGRAM' ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => setAvulsoSourceType('INSTAGRAM')}
                    style={{ flex: 1 }}
                  >
                    Instagram
                  </Button>
                </div>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Nome da referência</label>
                <input
                  ref={avulsoNameRef}
                  className={styles.formInput}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={avulsoSourceType === 'WEBSITE' ? 'Ex: Concorrente Alpha' : 'Ex: @perfil.concorrente'}
                  required
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>URL (obrigatório para análise)</label>
                <input
                  className={styles.formInput}
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder={avulsoSourceType === 'WEBSITE' ? 'https://concorrente.com' : 'https://instagram.com/perfil'}
                  type="url"
                />
              </div>
              {createError && <p className={styles.formError}>{createError}</p>}
              <div className={styles.modalActions}>
                <Button type="button" variant="secondary" size="sm" onClick={() => setAvulsoOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" size="sm" disabled={creating || !newName.trim()}>
                  {creating ? 'Criando...' : 'Iniciar Análise'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
