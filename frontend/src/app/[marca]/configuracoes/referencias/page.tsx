'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import Image from 'next/image';
import { ArrowLeft, ExternalLink, RefreshCw, X, Loader2, ImageIcon, Search, Wrench, Plus, FileText, ChevronDown, ChevronUp } from 'lucide-react';
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

interface BenchmarkInstagramPost {
  imageUrl: string;
  caption?: string;
  likesCount?: number;
  commentsCount?: number;
}

interface BenchmarkCollected {
  website?: Array<{ url: string; title?: string; screenshotUrl?: string }> | null;
  instagram?: {
    username?: string;
    fullName?: string;
    biography?: string;
    followersCount?: number;
    verified?: boolean;
    posts: BenchmarkInstagramPost[];
  } | null;
}

interface BenchmarkCandidate {
  id: string;
  name: string;
  websiteUrl?: string;
  instagramUrl?: string;
  reason?: string;
  confirmed: boolean;
  collected?: BenchmarkCollected;
}

interface BenchmarkSession {
  status: 'DISCOVERING' | 'AWAITING_QUESTION' | 'AWAITING_CONFIRMATION' | 'ANALYZING' | 'DONE' | 'FAILED';
  recommended: string[];
  candidates: BenchmarkCandidate[];
  pendingQuestion?: { text: string; options?: string[] };
  round: number;
  error?: string;
}

const RECOMMENDED_SLOTS = 5;
const PROCESSING_STATUSES: BenchmarkSession['status'][] = ['DISCOVERING', 'ANALYZING', 'AWAITING_QUESTION'];

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
  const [benchmarkSummary, setBenchmarkSummary] = useState<string | null>(null);
  const [benchmarkSummaryUpdatedAt, setBenchmarkSummaryUpdatedAt] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  // "+ referência avulsa" (secundário, sem descoberta)
  const [avulsoOpen, setAvulsoOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [avulsoSourceType, setAvulsoSourceType] = useState<'WEBSITE' | 'INSTAGRAM'>('WEBSITE');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const avulsoNameRef = useRef<HTMLInputElement>(null);

  // "Configurar Benchmark"
  const [benchmarkOpen, setBenchmarkOpen] = useState(false);
  const [recommendedInputs, setRecommendedInputs] = useState<string[]>(Array(RECOMMENDED_SLOTS).fill(''));
  const [session, setSession] = useState<BenchmarkSession | null>(null);
  const [startingBenchmark, setStartingBenchmark] = useState(false);
  const [answerText, setAnswerText] = useState('');
  const [answering, setAnswering] = useState(false);
  const [selections, setSelections] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState(false);
  const [benchmarkError, setBenchmarkError] = useState('');

  const fetchRefs = useCallback(() => {
    api.get<Reference[]>(`/settings/${slug}/referencias`)
      .then((data) => {
        setRefs(data ?? []);
      })
      .catch(() => setRefs([]))
      .finally(() => setLoading(false));
  }, [slug]);

  const fetchToolsConfig = useCallback(() => {
    api.get<{ autoResearchEnabled?: boolean; autoResearchInterval?: number; benchmarkSummary?: string | null; benchmarkSummaryUpdatedAt?: string | null }>(`/settings/${slug}/config`)
      .then((data) => {
        setAutoResearchEnabled(!!data?.autoResearchEnabled);
        setAutoResearchInterval(data?.autoResearchInterval ?? 14);
        setBenchmarkSummary(data?.benchmarkSummary ?? null);
        setBenchmarkSummaryUpdatedAt(data?.benchmarkSummaryUpdatedAt ?? null);
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

  // Ao abrir o modal, busca a sessão que já existir no backend — sem isso, um
  // reload durante uma descoberta em andamento reaparecia sempre no
  // formulário em branco, perdendo o progresso já feito.
  useEffect(() => {
    if (!benchmarkOpen) return;
    api.get<BenchmarkSession | null>(`/settings/${slug}/referencias/benchmark`)
      .then((data) => { if (data) setSession(data); })
      .catch(() => {});
  }, [benchmarkOpen, slug]);

  // Poll da sessão de benchmark enquanto ainda estiver processando. Usa uma
  // ref pro status (não `session` no dependency array): a descoberta real
  // pode levar dezenas de segundos (Google Search grounding), então o GET
  // costuma voltar `null` (ainda sem sessão persistida) nos primeiros polls —
  // se o reagendamento dependesse de `session` mudar de referência, uma
  // resposta `null` (que não atualiza o state) travava o polling pra sempre.
  const sessionStatusRef = useRef<BenchmarkSession['status'] | null>(null);
  useEffect(() => { sessionStatusRef.current = session?.status ?? null; }, [session]);

  useEffect(() => {
    if (!benchmarkOpen) return;
    let cancelled = false;
    const poll = () => {
      if (cancelled) return;
      if (sessionStatusRef.current && !PROCESSING_STATUSES.includes(sessionStatusRef.current)) return;
      api.get<BenchmarkSession | null>(`/settings/${slug}/referencias/benchmark`)
        .then((data) => { if (data && !cancelled) setSession(data); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setTimeout(poll, 3000); });
    };
    const timer = setTimeout(poll, 3000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [benchmarkOpen, slug]);

  // Ao chegar em AWAITING_CONFIRMATION, marca todos os candidatos como selecionados por padrão
  useEffect(() => {
    if (session?.status === 'AWAITING_CONFIRMATION') {
      setSelections((prev) => {
        const next = { ...prev };
        for (const c of session.candidates) {
          if (!(c.id in next)) next[c.id] = c.confirmed;
        }
        return next;
      });
    }
  }, [session]);

  // Sessão concluída: recarrega as referências (os novos concorrentes já
  // aparecem como abas em PENDENTE/analisando) e fecha o modal.
  useEffect(() => {
    if (session?.status === 'DONE') {
      fetchRefs();
      fetchToolsConfig(); // o resumo consolidado de branding pode ter sido atualizado
      const timer = setTimeout(() => {
        setBenchmarkOpen(false);
        setSession(null);
        setRecommendedInputs(Array(RECOMMENDED_SLOTS).fill(''));
        setSelections({});
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [session?.status, fetchRefs, fetchToolsConfig]);

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

  const handleStartBenchmark = async () => {
    setStartingBenchmark(true);
    setBenchmarkError('');
    try {
      const recommended = recommendedInputs.map((n) => n.trim()).filter(Boolean);
      const initial = await api.post<BenchmarkSession>(`/settings/${slug}/referencias/benchmark`, { recommended });
      setSession(initial);
    } catch (err) {
      setBenchmarkError(err instanceof ApiError ? err.message : 'Erro ao iniciar o benchmark.');
    } finally {
      setStartingBenchmark(false);
    }
  };

  const handleAnswerQuestion = async (answer: string) => {
    if (!answer.trim()) return;
    setAnswering(true);
    try {
      await api.post(`/settings/${slug}/referencias/benchmark/responder`, { answer: answer.trim() });
      setSession((prev) => prev ? { ...prev, status: 'DISCOVERING' } : prev);
      setAnswerText('');
    } catch (err) {
      setBenchmarkError(err instanceof ApiError ? err.message : 'Erro ao responder.');
    } finally {
      setAnswering(false);
    }
  };

  const handleConfirmCandidates = async () => {
    if (!session) return;
    setConfirming(true);
    try {
      const candidates = session.candidates.map((c) => ({ id: c.id, confirmed: selections[c.id] ?? c.confirmed }));
      await api.post(`/settings/${slug}/referencias/benchmark/confirmar`, { candidates });
      setSession((prev) => prev ? { ...prev, status: 'ANALYZING' } : prev);
    } catch (err) {
      setBenchmarkError(err instanceof ApiError ? err.message : 'Erro ao confirmar candidatos.');
    } finally {
      setConfirming(false);
    }
  };

  const closeBenchmarkModal = () => {
    setBenchmarkOpen(false);
    setSession(null);
    setBenchmarkError('');
    setRecommendedInputs(Array(RECOMMENDED_SLOTS).fill(''));
    setSelections({});
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
        title="Referências & Benchmarks"
        description="O bot descobre os concorrentes da marca sozinho e monta o benchmark completo — até 5 marcas, site + Instagram."
        actions={
          <Button size="sm" onClick={() => setBenchmarkOpen(true)}>
            <Search size={14} />
            Configurar Benchmark
          </Button>
        }
      />

      <div className={styles.toolsPanel}>
        <div className={styles.toolsRow}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ padding: '6px', backgroundColor: 'var(--color-bg-secondary)', borderRadius: '6px' }}>
              <Wrench size={16} color="var(--color-accent)" />
            </div>
            <div>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)', display: 'block' }}>Pesquisa automática</span>
              <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>Refaz a descoberta e a análise do benchmark inteiro periodicamente</span>
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

      {benchmarkSummary && (
        <div className={styles.toolsPanel}>
          <button
            type="button"
            onClick={() => setSummaryOpen((v) => !v)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ padding: '6px', backgroundColor: 'var(--color-bg-secondary)', borderRadius: '6px' }}>
                <FileText size={16} color="var(--color-brand)" />
              </div>
              <div style={{ textAlign: 'left' }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)', display: 'block' }}>Resumo do Branding</span>
                <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                  Sintetizado a partir das referências analisadas do benchmark
                  {benchmarkSummaryUpdatedAt ? ` · atualizado em ${new Date(benchmarkSummaryUpdatedAt).toLocaleDateString('pt-BR')}` : ''}
                </span>
              </div>
            </div>
            {summaryOpen ? <ChevronUp size={16} color="var(--color-text-tertiary)" /> : <ChevronDown size={16} color="var(--color-text-tertiary)" />}
          </button>
          {summaryOpen && (
            <div className={styles.markdownWrapper} style={{ marginTop: 'var(--space-3)' }}>
              <ReactMarkdown>{benchmarkSummary}</ReactMarkdown>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className={styles.loadingState}>
          <Loader2 className={styles.spinner} />
          <p>Carregando referências...</p>
        </div>
      ) : refs.length === 0 ? (
        <p className={styles.empty}>Nenhuma referência ainda. Clique em &quot;Configurar Benchmark&quot; para o bot descobrir os concorrentes.</p>
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

      {/* "Configurar Benchmark" Modal */}
      {benchmarkOpen && (
        <div className={styles.modalOverlay} onClick={session?.status === 'ANALYZING' ? undefined : closeBenchmarkModal}>
          <div className={styles.modal} style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Configurar Benchmark</h2>
              <button className={styles.modalClose} onClick={closeBenchmarkModal}>
                <X size={18} />
              </button>
            </div>

            {!session && (
              <div className={styles.modalForm}>
                <p className={styles.formHint}>
                  Recomende até {RECOMMENDED_SLOTS} concorrentes conhecidos (opcional) — os slots que deixar em branco, o bot pesquisa e preenche sozinho.
                </p>
                <div className={styles.recommendedInputsGrid}>
                  {recommendedInputs.map((value, i) => (
                    <input
                      key={i}
                      className={styles.formInput}
                      value={value}
                      onChange={(e) => setRecommendedInputs((prev) => prev.map((v, idx) => idx === i ? e.target.value : v))}
                      placeholder={`Concorrente ${i + 1}`}
                    />
                  ))}
                </div>
                {benchmarkError && <p className={styles.formError}>{benchmarkError}</p>}
                <div className={styles.modalActions}>
                  <Button type="button" variant="secondary" size="sm" onClick={closeBenchmarkModal}>
                    Cancelar
                  </Button>
                  <Button type="button" size="sm" disabled={startingBenchmark} onClick={handleStartBenchmark}>
                    {startingBenchmark ? 'Buscando...' : 'Buscar concorrentes'}
                  </Button>
                </div>
              </div>
            )}

            {session && (session.status === 'DISCOVERING' || session.status === 'ANALYZING') && (
              <div className={styles.loadingState}>
                <Loader2 className={styles.spinner} />
                <p>{session.status === 'DISCOVERING' ? 'Pesquisando concorrentes e coletando material...' : 'Analisando os concorrentes confirmados...'}</p>
              </div>
            )}

            {session?.status === 'AWAITING_QUESTION' && session.pendingQuestion && (
              <div className={styles.modalForm}>
                <div className={styles.questionCard}>
                  <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text)' }}>{session.pendingQuestion.text}</p>
                  {session.pendingQuestion.options && session.pendingQuestion.options.length > 0 ? (
                    session.pendingQuestion.options.map((opt) => (
                      <button key={opt} type="button" className={styles.questionOption} disabled={answering} onClick={() => handleAnswerQuestion(opt)}>
                        {opt}
                      </button>
                    ))
                  ) : (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        className={styles.formInput}
                        style={{ flex: 1 }}
                        value={answerText}
                        onChange={(e) => setAnswerText(e.target.value)}
                        placeholder="Sua resposta..."
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAnswerQuestion(answerText); }}
                      />
                      <Button type="button" size="sm" disabled={answering || !answerText.trim()} onClick={() => handleAnswerQuestion(answerText)}>
                        Responder
                      </Button>
                    </div>
                  )}
                </div>
                {benchmarkError && <p className={styles.formError}>{benchmarkError}</p>}
              </div>
            )}

            {session?.status === 'AWAITING_CONFIRMATION' && (
              <div className={styles.modalForm}>
                <p className={styles.formHint}>Confira o material coletado e desmarque quem não quiser analisar.</p>
                <div className={styles.candidateList}>
                  {session.candidates.map((c) => {
                    const thumbs = [
                      ...(c.collected?.instagram?.posts.map((p) => p.imageUrl) ?? []),
                      ...(c.collected?.website?.map((p) => p.screenshotUrl).filter((u): u is string => !!u) ?? []),
                    ];
                    return (
                      <div key={c.id} className={styles.candidateCard}>
                        <div className={styles.candidateHeader}>
                          <input
                            type="checkbox"
                            className={styles.candidateCheckbox}
                            checked={selections[c.id] ?? c.confirmed}
                            onChange={(e) => setSelections((prev) => ({ ...prev, [c.id]: e.target.checked }))}
                          />
                          <div style={{ flex: 1 }}>
                            <strong style={{ fontSize: 14, color: 'var(--color-text)' }}>{c.name}</strong>
                            {c.reason && <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-text-secondary)' }}>{c.reason}</p>}
                            {c.collected?.instagram && (
                              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                                {c.collected.instagram.biography}
                                {c.collected.instagram.followersCount ? ` · ${c.collected.instagram.followersCount.toLocaleString('pt-BR')} seguidores` : ''}
                              </p>
                            )}
                          </div>
                        </div>
                        {thumbs.length > 0 && (
                          <div className={styles.galleryGrid}>
                            {thumbs.slice(0, 6).map((url, i) => (
                              <div key={i} className={styles.galleryThumb}>
                                <Image src={url} alt={`${c.name} — ${i + 1}`} fill style={{ objectFit: 'cover' }} unoptimized />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {benchmarkError && <p className={styles.formError}>{benchmarkError}</p>}
                <div className={styles.modalActions}>
                  <Button type="button" variant="secondary" size="sm" onClick={closeBenchmarkModal}>
                    Cancelar
                  </Button>
                  <Button type="button" size="sm" disabled={confirming} onClick={handleConfirmCandidates}>
                    {confirming ? 'Confirmando...' : 'Confirmar e Analisar'}
                  </Button>
                </div>
              </div>
            )}

            {session?.status === 'DONE' && (
              <div className={styles.loadingState}>
                <p>Benchmark configurado! As referências já aparecem como abas na página.</p>
              </div>
            )}

            {session?.status === 'FAILED' && (
              <div className={styles.modalForm}>
                <p className={styles.formError}>{session.error || 'Algo deu errado ao configurar o benchmark.'}</p>
                <div className={styles.modalActions}>
                  <Button type="button" variant="secondary" size="sm" onClick={closeBenchmarkModal}>
                    Fechar
                  </Button>
                  <Button type="button" size="sm" onClick={handleStartBenchmark}>
                    Tentar de novo
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
