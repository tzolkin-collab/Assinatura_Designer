'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { CheckSquare, ExternalLink, Loader2, Square, X, Image as ImageIcon, Search, ListChecks } from 'lucide-react';
import { toBlob } from 'html-to-image';
import { API_BASE } from '@/lib/api';
import styles from './connectorPopup.module.css';

interface AsanaProject { gid: string; name: string }
interface AsanaTask {
  gid: string;
  name: string;
  completed: boolean;
  due_on: string | null;
  assignee?: { name: string } | null;
  notes?: string;
  permalink_url?: string;
}

interface Props {
  onClose: () => void;
  onInject: (text: string, attachments?: Array<{ name: string; mimeType: string; dataBase64: string }>) => void;
}

const getToken = () =>
  typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;

const authHeaders = (): Record<string, string> => {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

export function AsanaPopup({ onClose, onInject }: Props) {
  const [status, setStatus] = useState<'loading' | 'connected' | 'disconnected' | 'error'>('loading');
  const [projects, setProjects] = useState<AsanaProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [tasks, setTasks] = useState<AsanaTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [exportingImage, setExportingImage] = useState(false);
  const [search, setSearch] = useState('');

  const imageExportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${API_BASE}/asana/status`, { headers: authHeaders() })
      .then(r => r.json())
      .then((d: { connected?: boolean }) => {
        if (!d.connected) { setStatus('disconnected'); return; }
        return fetch(`${API_BASE}/asana/projects`, { headers: authHeaders() })
          .then(r => r.json())
          .then((pd: { data?: AsanaProject[] }) => {
            setProjects(pd.data ?? []);
            setStatus('connected');
          });
      })
      .catch(() => setStatus('error'));
  }, []);

  const loadTasks = async (projectId: string) => {
    setSelectedProject(projectId);
    setLoadingTasks(true);
    setTasks([]);
    setSearch('');
    try {
      const r = await fetch(`${API_BASE}/asana/projects/${projectId}/tasks`, { headers: authHeaders() });
      const d = await r.json() as { data?: AsanaTask[] };
      setTasks(d.data ?? []);
    } catch {
      // segue com a lista vazia
    } finally {
      setLoadingTasks(false);
    }
  };

  const toggleTask = (gid: string) => {
    setSelectedTasks(prev => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  };

  const filteredProjects = useMemo(
    () => (search.trim() ? projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())) : projects),
    [projects, search],
  );

  const filteredTasks = useMemo(
    () => (search.trim() ? tasks.filter((t) => t.name.toLowerCase().includes(search.toLowerCase())) : tasks),
    [tasks, search],
  );

  const injectSelected = async () => {
    const selected = tasks.filter(t => selectedTasks.has(t.gid));
    if (selected.length === 0) return;

    const text = selected.map(t => {
      const parts = [`• ${t.name}`];
      if (t.due_on) parts.push(`  Prazo: ${t.due_on}`);
      if (t.assignee?.name) parts.push(`  Responsável: ${t.assignee.name}`);
      if (t.notes?.trim()) parts.push(`  Notas: ${t.notes.slice(0, 200)}`);
      return parts.join('\n');
    }).join('\n\n');

    setLoadingTasks(true);
    const allAttachments: Array<{ name: string; mimeType: string; dataBase64: string }> = [];
    try {
      for (const t of selected) {
        const res = await fetch(`${API_BASE}/asana/tasks/${t.gid}/attachments`, { headers: authHeaders() });
        if (res.ok) {
          const body = await res.json() as { data?: Array<{ name: string; mimeType: string; dataBase64: string }> };
          if (body.data) allAttachments.push(...body.data);
        }
      }
    } catch (err) {
      console.warn('[AsanaPopup] Falha ao buscar anexos:', err);
    } finally {
      setLoadingTasks(false);
    }

    onInject(`[Contexto Asana]\n${text}`, allAttachments);
    onClose();
  };

  const exportAsImage = async () => {
    if (!imageExportRef.current || selectedTasks.size === 0) return;
    try {
      setExportingImage(true);
      const blob = await toBlob(imageExportRef.current, {
        backgroundColor: '#ffffff',
        pixelRatio: 2,
        style: { transform: 'scale(1)', opacity: '1' },
      });
      if (blob) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        alert('Imagem copiada para a área de transferência!');
        onClose();
      }
    } catch (err) {
      console.error('Erro ao exportar imagem', err);
      alert('Erro ao gerar imagem.');
    } finally {
      setExportingImage(false);
    }
  };

  return (
    <div className={styles.overlay} onMouseDown={onClose}>
      <div className={styles.popup} onMouseDown={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerTitleGroup}>
            <div className={styles.headerIconBadge} style={{ background: '#fbeee8' }}>
              <img src="/asana-logo.svg" width={14} height={14} alt="" />
            </div>
            <span className={styles.headerTitle}>Asana</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {status === 'loading' && (
          <div className={styles.center}>
            <Loader2 size={22} className={styles.spin} style={{ color: 'var(--color-text-tertiary)' }} />
          </div>
        )}

        {status === 'disconnected' && (
          <div className={styles.center}>
            <ListChecks size={32} style={{ color: 'var(--color-text-tertiary)', opacity: 0.5 }} />
            <p className={styles.centerText}>
              Asana não conectado. Configure em Configurações → Integrações.
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className={styles.center}>
            <p className={`${styles.centerText} ${styles.centerTextError}`}>
              Erro ao carregar projetos.
            </p>
          </div>
        )}

        {status === 'connected' && !selectedProject && (
          <div className={styles.content}>
            <div className={styles.toolbar}>
              <div className={styles.searchWrap}>
                <Search size={13} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
                <input
                  className={styles.searchInput}
                  placeholder="Buscar projeto..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <p className={styles.sectionLabel}>Projetos</p>
            <div className={styles.list}>
              {filteredProjects.map(p => (
                <button key={p.gid} className={styles.listItem} onClick={() => loadTasks(p.gid)}>
                  <div className={styles.listItemMain}>
                    <span className={styles.listItemIcon}><ListChecks size={16} style={{ color: 'var(--color-text-tertiary)' }} /></span>
                    <span className={styles.listItemName}>{p.name}</span>
                  </div>
                </button>
              ))}
              {filteredProjects.length === 0 && (
                <p className={styles.emptyState}>
                  {search ? 'Nenhum projeto encontrado.' : 'Nenhum projeto encontrado.'}
                </p>
              )}
            </div>
          </div>
        )}

        {status === 'connected' && selectedProject && (
          <div className={styles.content}>
            <div className={styles.toolbar}>
              <button
                className={styles.textBackBtn}
                onClick={() => { setSelectedProject(null); setTasks([]); setSelectedTasks(new Set()); setSearch(''); }}
              >
                ← Projetos
              </button>
              <div className={styles.searchWrap}>
                <Search size={13} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
                <input
                  className={styles.searchInput}
                  placeholder="Buscar tarefa..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            {loadingTasks ? (
              <div className={styles.center}>
                <Loader2 size={18} className={styles.spin} style={{ color: 'var(--color-text-tertiary)' }} />
              </div>
            ) : (
              <div className={styles.list}>
                {filteredTasks.map(t => {
                  const isSelected = selectedTasks.has(t.gid);
                  return (
                    <button key={t.gid} className={`${styles.listItem} ${isSelected ? styles.listItemSelected : ''}`} onClick={() => toggleTask(t.gid)}>
                      <div className={styles.listItemMain}>
                        <div className={`${styles.checkIcon} ${isSelected ? styles.checkIconSelected : ''}`}>
                          {isSelected ? <CheckSquare size={16} /> : <Square size={16} style={{ opacity: 0.35 }} />}
                        </div>
                        <div className={styles.listItemText}>
                          <span className={`${styles.listItemName} ${t.completed ? styles.listItemNameDone : ''}`}>
                            {t.name}
                          </span>
                          {(t.due_on || t.assignee?.name) && (
                            <span className={styles.listItemMeta}>
                              {[t.due_on, t.assignee?.name].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </div>
                      </div>
                      {t.permalink_url && (
                        <a
                          href={t.permalink_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.externalLink}
                          onClick={e => e.stopPropagation()}
                        >
                          <ExternalLink size={13} />
                        </a>
                      )}
                    </button>
                  );
                })}
                {filteredTasks.length === 0 && (
                  <p className={styles.emptyState}>
                    {search ? 'Nenhuma tarefa encontrada.' : 'Nenhuma tarefa neste projeto.'}
                  </p>
                )}
              </div>
            )}

            {selectedTasks.size > 0 && (
              <div className={styles.footer} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <button className={styles.btnPrimary} style={{ width: '100%', justifyContent: 'center' }} onClick={injectSelected}>
                  Injetar {selectedTasks.size} tarefa{selectedTasks.size > 1 ? 's' : ''} no contexto
                </button>
                <button className={styles.btnGhostFull} onClick={exportAsImage} disabled={exportingImage}>
                  {exportingImage ? <Loader2 size={14} className={styles.spin} /> : <ImageIcon size={14} />}
                  Exportar como imagem numerada
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Off-screen element for image generation */}
      {selectedProject && tasks.length > 0 && (
        <div style={{ position: 'absolute', top: -9999, left: -9999, opacity: 0, pointerEvents: 'none' }}>
          <div ref={imageExportRef} style={EXPORT_WRAPPER}>
            <div style={EXPORT_HEADER}>
              <h2 style={{ margin: 0, fontSize: 24, color: '#111827', display: 'flex', alignItems: 'center', gap: 10 }}>
                <img src="/asana-logo.svg" width={24} height={24} alt="Asana" />
                Tarefas Selecionadas
              </h2>
              <span style={{ fontSize: 14, color: '#6b7280' }}>
                {new Date().toLocaleDateString('pt-BR')}
              </span>
            </div>

            <table style={EXPORT_TABLE}>
              <thead>
                <tr>
                  <th style={{ ...EXPORT_TH, width: 40, textAlign: 'center' }}>#</th>
                  <th style={EXPORT_TH}>Tarefa</th>
                  <th style={{ ...EXPORT_TH, width: 100 }}>Prazo</th>
                  <th style={{ ...EXPORT_TH, width: 140 }}>Responsável</th>
                </tr>
              </thead>
              <tbody>
                {tasks.filter(t => selectedTasks.has(t.gid)).map((t, index) => (
                  <tr key={t.gid} style={EXPORT_TR}>
                    <td style={{ ...EXPORT_TD, textAlign: 'center', fontWeight: 'bold', color: '#4b5563' }}>
                      {index + 1}
                    </td>
                    <td style={{ ...EXPORT_TD, fontWeight: 500, color: '#111827' }}>
                      <div style={{ textDecoration: t.completed ? 'line-through' : 'none' }}>
                        {t.name}
                      </div>
                      {t.notes && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4, fontWeight: 400 }}>{t.notes.slice(0, 80)}{t.notes.length > 80 ? '...' : ''}</div>}
                    </td>
                    <td style={{ ...EXPORT_TD, color: '#ef4444', fontWeight: 500 }}>
                      {t.due_on ? new Date(t.due_on).toLocaleDateString('pt-BR') : '-'}
                    </td>
                    <td style={EXPORT_TD}>
                      {t.assignee?.name || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: 24, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
              Gerado via Assinatura Designer App
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Estilos do card de export (rasterizado via html-to-image, fora do fluxo
//    normal de estilo — precisa ser um documento autocontido em px fixos). ──

const EXPORT_WRAPPER: React.CSSProperties = {
  width: 800,
  padding: '40px 40px',
  background: '#ffffff',
  fontFamily: 'Inter, system-ui, sans-serif',
};

const EXPORT_HEADER: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 24,
  paddingBottom: 16,
  borderBottom: '2px solid #f3f4f6',
};

const EXPORT_TABLE: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  textAlign: 'left',
};

const EXPORT_TH: React.CSSProperties = {
  padding: '12px 16px',
  background: '#f9fafb',
  color: '#374151',
  fontWeight: 600,
  fontSize: 14,
  borderBottom: '1px solid #e5e7eb',
};

const EXPORT_TD: React.CSSProperties = {
  padding: '16px',
  fontSize: 14,
  color: '#4b5563',
  borderBottom: '1px solid #e5e7eb',
  verticalAlign: 'top',
};

const EXPORT_TR: React.CSSProperties = {
  backgroundColor: '#ffffff',
};
