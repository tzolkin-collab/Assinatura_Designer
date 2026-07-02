'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import Image from 'next/image';
import { ArrowLeft, Camera, ExternalLink, RefreshCw, X, Loader2 } from 'lucide-react';
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
  const [selectedRef, setSelectedRef] = useState<Reference | null>(null);
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);

  // Nova Análise modal
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [sourceType, setSourceType] = useState<'WEBSITE' | 'INSTAGRAM'>('WEBSITE');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  const fetchRefs = useCallback(() => {
    api.get<Reference[]>(`/settings/${slug}/referencias`)
      .then((data) => {
        setRefs(data ?? []);
      })
      .catch(() => setRefs([]))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    fetchRefs();
  }, [fetchRefs]);

  useEffect(() => {
    if (showModal) setTimeout(() => nameRef.current?.focus(), 50);
  }, [showModal]);

  // Poll for PENDING refs every 5s until all are resolved
  useEffect(() => {
    const hasPending = refs.some((r) => r.status === 'PENDING');
    if (!hasPending) return;
    const timer = setTimeout(fetchRefs, 5000);
    return () => clearTimeout(timer);
  }, [refs, fetchRefs]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const ref = await api.post<Reference>(`/settings/${slug}/referencias`, {
        name: newName.trim(),
        analysisUrl: newUrl.trim() || undefined,
        sourceType,
      });
      setRefs((prev) => [ref, ...prev]);
      setShowModal(false);
      setNewName('');
      setNewUrl('');
      setSourceType('WEBSITE');
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Erro ao criar referência.');
    } finally {
      setCreating(false);
    }
  };

  const handleCaptureScreenshot = async (ref: Reference) => {
    if (capturingScreenshot) return;
    setCapturingScreenshot(true);
    try {
      await api.post(`/settings/${slug}/referencias/${ref.id}/screenshot`, {});
      // Poll until imageUrl appears (max 30s)
      let attempts = 0;
      const poll = async () => {
        if (attempts++ > 6) { setCapturingScreenshot(false); return; }
        const updated = await api.get<Reference[]>(`/settings/${slug}/referencias`);
        const found = (updated ?? []).find((r) => r.id === ref.id);
        if (found?.imageUrl) {
          setRefs(updated ?? []);
          setSelectedRef(found);
          setCapturingScreenshot(false);
          return;
        }
        
        setTimeout(poll, 5000);
      };
      setTimeout(poll, 5000);
    } catch {
      setCapturingScreenshot(false);
    }
  };

  const handleDelete = async (id: string) => {
    const ref = refs.find(r => r.id === id);
    if (!window.confirm(`Tem certeza que deseja remover "${ref?.name ?? 'esta referência'}"?`)) return;
    await api.delete(`/settings/${slug}/referencias/${id}`).catch(() => {});
    setRefs((prev) => prev.filter((r) => r.id !== id));
    if (selectedRef?.id === id) setSelectedRef(null);
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

  return (
    <div>
      <Link href={`/${params.marca}/configuracoes`} className={styles.backLink}>
        <ArrowLeft size={16} />
        Voltar para configurações
      </Link>

      <PageHeader
        title="Referências & Benchmarks"
        description="Análises de marcas concorrentes geradas automaticamente pelo Gemini."
        actions={
          <Button size="sm" onClick={() => setShowModal(true)}>
            <RefreshCw size={14} />
            Nova Análise
          </Button>
        }
      />

      {loading ? (
        <div className={styles.loadingState}>
          <Loader2 className={styles.spinner} />
          <p>Carregando referências...</p>
        </div>
      ) : (
        <div className={styles.list}>
          {refs.length === 0 && (
            <p className={styles.empty}>Nenhuma referência adicionada. Clique em &quot;Nova Análise&quot; para começar.</p>
          )}
          {refs.map((ref) => (
            <Card key={ref.id} hover padding="md">
              <div className={styles.refRow}>
                <div className={styles.refInfo}>
                  <h3 className={styles.refName}>{ref.name}</h3>
                  <span className={styles.refDate}>
                    {ref.status === 'PENDING'
                      ? 'Analisando...'
                      : new Date(ref.updatedAt).toLocaleDateString('pt-BR')}
                  </span>
                </div>
                <div className={styles.refMeta}>
                  {ref.status === 'PENDING' && <Loader2 size={14} className={styles.spinnerSmall} />}
                  <span className={[styles.badge, statusClass(ref.status)].join(' ')}>
                    {statusLabel(ref.status)}
                  </span>
                  {ref.insights > 0 && (
                    <span className={styles.insights}>{ref.insights} seções</span>
                  )}
                  {ref.insightsText && (
                    <button className={styles.viewBtn} onClick={() => setSelectedRef(ref)} title="Ver insights">
                      <ExternalLink size={14} />
                    </button>
                  )}
                  <button className={styles.deleteBtn} onClick={() => handleDelete(ref.id)} title="Remover">
                    <X size={14} />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Nova Análise Modal */}
      {showModal && (
        <div className={styles.modalOverlay} onClick={() => setShowModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Nova Análise</h2>
              <button className={styles.modalClose} onClick={() => setShowModal(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreate} className={styles.modalForm}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Tipo de Referência</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Button 
                    type="button" 
                    variant={sourceType === 'WEBSITE' ? 'primary' : 'secondary'} 
                    size="sm" 
                    onClick={() => setSourceType('WEBSITE')}
                    style={{ flex: 1 }}
                  >
                    Website
                  </Button>
                  <Button 
                    type="button" 
                    variant={sourceType === 'INSTAGRAM' ? 'primary' : 'secondary'} 
                    size="sm" 
                    onClick={() => setSourceType('INSTAGRAM')}
                    style={{ flex: 1 }}
                  >
                    Instagram
                  </Button>
                </div>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Nome da referência</label>
                <input
                  ref={nameRef}
                  className={styles.formInput}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={sourceType === 'WEBSITE' ? "Ex: Concorrente Alpha" : "Ex: @perfil.concorrente"}
                  required
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>URL (obrigatório para análise)</label>
                <input
                  className={styles.formInput}
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder={sourceType === 'WEBSITE' ? "https://concorrente.com" : "https://instagram.com/perfil"}
                  type="url"
                />
              </div>
              {createError && <p className={styles.formError}>{createError}</p>}
              <p className={styles.formHint}>
                O Gemini irá analisar a referência em background e gerar insights automáticos.
              </p>
              <div className={styles.modalActions}>
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowModal(false)}>
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

      {/* Insights Drawer */}
      {selectedRef && (
        <div className={styles.modalOverlay} onClick={() => setSelectedRef(null)}>
          <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h2 className={styles.modalTitle}>{selectedRef.name}</h2>
                  <span className={styles.refSlugBadge}>/{selectedRef.name.toLowerCase().replace(/\s+/g, '-')}</span>
                </div>
                {selectedRef.analysisUrl && (
                  <a href={selectedRef.analysisUrl} target="_blank" rel="noreferrer" className={styles.urlLink}>
                    {selectedRef.analysisUrl} <ExternalLink size={12} />
                  </a>
                )}
              </div>
              <button className={styles.modalClose} onClick={() => setSelectedRef(null)}>
                <X size={18} />
              </button>
            </div>
            
            <div className={styles.insightsBody}>
              <div className={styles.propertiesGrid}>
                <div className={styles.propertyCard}>
                  <span className={styles.propertyLabel}>Arquetipo</span>
                  <span className={styles.propertyValue}>{selectedRef.archetype || 'Não definido'}</span>
                </div>
                <div className={styles.propertyCard}>
                  <span className={styles.propertyLabel}>Tom de Voz</span>
                  <span className={styles.propertyValue}>{selectedRef.toneOfVoice || 'Não definido'}</span>
                </div>
                <div className={styles.propertyCard}>
                  <span className={styles.propertyLabel}>Densidade</span>
                  <span className={styles.propertyValue}>{selectedRef.density || 'Não definida'}</span>
                </div>
                <div className={styles.propertyCard}>
                  <span className={styles.propertyLabel}>Paleta</span>
                  <div className={styles.colorPalette}>
                    {selectedRef.palette && selectedRef.palette.length > 0 ? (
                      selectedRef.palette.map((color, idx) => (
                        <div key={idx} className={styles.colorDot} style={{ backgroundColor: color }} title={color} />
                      ))
                    ) : (
                      <span className={styles.propertyValue} style={{ color: 'var(--color-text-tertiary)' }}>Sem paleta</span>
                    )}
                  </div>
                </div>
              </div>

              <div className={styles.imagePreviewSection}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <h3 className={styles.sectionTitle} style={{ margin: 0 }}>Screenshot</h3>
                  {selectedRef.sourceType === 'WEBSITE' && (
                    <button
                      className={styles.viewBtn}
                      onClick={() => handleCaptureScreenshot(selectedRef)}
                      disabled={capturingScreenshot}
                      title={selectedRef.imageUrl ? 'Recapturar screenshot' : 'Capturar screenshot'}
                      style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', fontSize: 12 }}
                    >
                      {capturingScreenshot ? <Loader2 size={13} className={styles.spinnerSmall} /> : <Camera size={13} />}
                      {capturingScreenshot ? 'Capturando...' : selectedRef.imageUrl ? 'Recapturar' : 'Capturar'}
                    </button>
                  )}
                </div>
                {selectedRef.imageUrl ? (
                  <div className={styles.imageWithMarkers}>
                    <div className={styles.placeholderImage}>
                      <Image
                        src={selectedRef.imageUrl}
                        alt={`Screenshot da referência ${selectedRef.name}`}
                        fill
                        style={{ objectFit: 'cover' }}
                        unoptimized
                      />
                      {selectedRef.markers?.map((marker, index) => (
                        <div key={marker.id} className={styles.marker} style={{ top: `${marker.y}%`, left: `${marker.x}%` }}>
                          <span className={styles.markerDot}>{index + 1}</span>
                          <div className={styles.markerTooltip}>{marker.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', margin: 0 }}>
                    {selectedRef.sourceType === 'WEBSITE'
                      ? 'Nenhum screenshot capturado. Clique em "Capturar" para gerar.'
                      : 'Screenshots não disponíveis para referências do Instagram.'}
                  </p>
                )}
              </div>

              <div className={styles.markdownWrapper}>
                <h3 className={styles.sectionTitle}>Insights Estratégicos</h3>
                <ReactMarkdown>{selectedRef.insightsText || 'Nenhum insight disponível.'}</ReactMarkdown>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
