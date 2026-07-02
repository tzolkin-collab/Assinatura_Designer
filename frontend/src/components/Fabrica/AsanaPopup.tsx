'use client';

import { useState, useEffect, useRef } from 'react';
import { CheckSquare, ExternalLink, Loader2, Square, X, Image as ImageIcon } from 'lucide-react';
import { toBlob } from 'html-to-image';
import { API_BASE } from '@/lib/api';

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
  onInject: (text: string) => void;
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
    try {
      const r = await fetch(`${API_BASE}/asana/projects/${projectId}/tasks`, { headers: authHeaders() });
      const d = await r.json() as { data?: AsanaTask[] };
      setTasks(d.data ?? []);
    } catch {}
    finally { setLoadingTasks(false); }
  };

  const toggleTask = (gid: string) => {
    setSelectedTasks(prev => {
      const next = new Set(prev);
      if (next.has(gid)) {
        next.delete(gid);
        return next;
      }
      
      next.add(gid);
      return next;
    });
  };

  const injectSelected = () => {
    const selected = tasks.filter(t => selectedTasks.has(t.gid));
    if (selected.length === 0) return;
    const text = selected.map(t => {
      const parts = [`• ${t.name}`];
      if (t.due_on) parts.push(`  Prazo: ${t.due_on}`);
      if (t.assignee?.name) parts.push(`  Responsável: ${t.assignee.name}`);
      if (t.notes?.trim()) parts.push(`  Notas: ${t.notes.slice(0, 200)}`);
      return parts.join('\n');
    }).join('\n\n');
    onInject(`[Contexto Asana]\n${text}`);
    onClose();
  };

  const exportAsImage = async () => {
    if (!imageExportRef.current || selectedTasks.size === 0) return;
    try {
      setExportingImage(true);
      const blob = await toBlob(imageExportRef.current, {
        backgroundColor: '#ffffff',
        pixelRatio: 2, // High resolution
        style: {
          transform: 'scale(1)',
          opacity: '1'
        }
      });
      if (blob) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
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
    <div style={OVERLAY} onMouseDown={onClose}>
      <div style={POPUP} onMouseDown={e => e.stopPropagation()}>

        {/* Header */}
        <div style={HEADER}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <img src="/asana-logo.svg" width={16} height={16} alt="" />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#1d1c1a' }}>Asana</span>
          </div>
          <button onClick={onClose} style={CLOSE_BTN}><X size={14} /></button>
        </div>

        {/* Loading */}
        {status === 'loading' && (
          <div style={CENTER}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: '#96948f' }} />
          </div>
        )}

        {/* Not connected */}
        {status === 'disconnected' && (
          <div style={CENTER}>
            <p style={{ fontSize: 12, color: '#96948f', textAlign: 'center', lineHeight: 1.6 }}>
              Asana não conectado.<br />Configure o token em<br />Configurações → Integrações.
            </p>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div style={CENTER}>
            <p style={{ fontSize: 12, color: '#b91c1c', textAlign: 'center' }}>
              Erro ao carregar projetos.
            </p>
          </div>
        )}

        {/* Projects list */}
        {status === 'connected' && !selectedProject && (
          <div style={SCROLL_AREA}>
            <p style={SECTION_LABEL}>Projetos</p>
            {projects.map(p => (
              <button
                key={p.gid}
                style={LIST_ITEM}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f3f2ef'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                onClick={() => loadTasks(p.gid)}
              >
                {p.name}
              </button>
            ))}
            {projects.length === 0 && (
              <p style={{ fontSize: 12, color: '#96948f', padding: '8px 14px' }}>
                Nenhum projeto encontrado.
              </p>
            )}
          </div>
        )}

        {/* Tasks list */}
        {status === 'connected' && selectedProject && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            <div style={{ padding: '6px 14px 6px', borderBottom: '1px solid rgba(0,0,0,0.06)', background: '#f3f2ef' }}>
              <button
                style={{ background: 'none', border: 'none', color: '#63615c', cursor: 'pointer', fontSize: 11, padding: 0 }}
                onClick={() => { setSelectedProject(null); setTasks([]); setSelectedTasks(new Set()); }}
              >
                ← Projetos
              </button>
            </div>

            {loadingTasks ? (
              <div style={CENTER}>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: '#96948f' }} />
              </div>
            ) : (
              <div style={SCROLL_AREA}>
                {tasks.map(t => (
                  <div
                    key={t.gid}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 14px',
                      cursor: 'pointer', borderRadius: 6, margin: '0 4px',
                      background: selectedTasks.has(t.gid) ? '#fdf2ef' : 'transparent',
                      transition: 'background 0.1s',
                    }}
                    onClick={() => toggleTask(t.gid)}
                  >
                    <div style={{ marginTop: 2, flexShrink: 0, color: selectedTasks.has(t.gid) ? '#d97757' : '#c4c2bc' }}>
                      {selectedTasks.has(t.gid) ? <CheckSquare size={13} /> : <Square size={13} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        fontSize: 12, margin: 0, lineHeight: 1.4,
                        color: t.completed ? '#c4c2bc' : '#1d1c1a',
                        textDecoration: t.completed ? 'line-through' : 'none',
                      }}>
                        {t.name}
                      </p>
                      {(t.due_on || t.assignee?.name) && (
                        <p style={{ fontSize: 11, margin: '2px 0 0', color: '#96948f' }}>
                          {[t.due_on, t.assignee?.name].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                    {t.permalink_url && (
                      <a
                        href={t.permalink_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#c4c2bc', flexShrink: 0, marginTop: 2 }}
                        onClick={e => e.stopPropagation()}
                      >
                        <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                ))}
                {tasks.length === 0 && (
                  <p style={{ fontSize: 12, color: '#96948f', padding: '8px 14px' }}>
                    Nenhuma tarefa neste projeto.
                  </p>
                )}
              </div>
            )}

            {selectedTasks.size > 0 && (
              <div style={{ padding: '8px 12px 10px', borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', gap: 8, flexDirection: 'column' }}>
                <button style={INJECT_BTN} onClick={injectSelected}>
                  Injetar {selectedTasks.size} tarefa{selectedTasks.size > 1 ? 's' : ''} no contexto
                </button>
                <button 
                  style={{...INJECT_BTN, background: '#4b5563', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6}} 
                  onClick={exportAsImage}
                  disabled={exportingImage}
                >
                  {exportingImage ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
                  Exportar como Imagem Numerada
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
                  <th style={{...EXPORT_TH, width: 40, textAlign: 'center'}}>#</th>
                  <th style={EXPORT_TH}>Tarefa</th>
                  <th style={{...EXPORT_TH, width: 100}}>Prazo</th>
                  <th style={{...EXPORT_TH, width: 140}}>Responsável</th>
                </tr>
              </thead>
              <tbody>
                {tasks.filter(t => selectedTasks.has(t.gid)).map((t, index) => (
                  <tr key={t.gid} style={EXPORT_TR}>
                    <td style={{...EXPORT_TD, textAlign: 'center', fontWeight: 'bold', color: '#4b5563'}}>
                      {index + 1}
                    </td>
                    <td style={{...EXPORT_TD, fontWeight: 500, color: '#111827'}}>
                      <div style={{ textDecoration: t.completed ? 'line-through' : 'none' }}>
                        {t.name}
                      </div>
                      {t.notes && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4, fontWeight: 400 }}>{t.notes.slice(0, 80)}{t.notes.length > 80 ? '...' : ''}</div>}
                    </td>
                    <td style={{...EXPORT_TD, color: '#ef4444', fontWeight: 500}}>
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

// ── Styles ───────────────────────────────────────────────────────────────────

const OVERLAY: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 200,
  display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-start',
  padding: '0 0 72px 12px',
};
const POPUP: React.CSSProperties = {
  width: 300, maxHeight: 440, background: '#ffffff',
  border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12,
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
  boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
};
const HEADER: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '10px 14px', borderBottom: '1px solid rgba(0,0,0,0.06)',
  background: '#f3f2ef',
};
const CLOSE_BTN: React.CSSProperties = {
  background: 'none', border: 'none', color: '#96948f', cursor: 'pointer', padding: 2,
};
const CENTER: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, padding: 28,
};
const SCROLL_AREA: React.CSSProperties = { flex: 1, overflowY: 'auto', padding: '4px 0' };
const SECTION_LABEL: React.CSSProperties = {
  fontSize: 10, color: '#96948f', padding: '4px 14px 2px',
  letterSpacing: '0.07em', textTransform: 'uppercase', margin: 0,
};
const LIST_ITEM: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', background: 'transparent',
  border: 'none', color: '#1d1c1a', fontSize: 12, padding: '7px 14px',
  cursor: 'pointer', transition: 'background 0.1s',
};
const INJECT_BTN: React.CSSProperties = {
  width: '100%', background: '#d97757', border: 'none', borderRadius: 7,
  color: '#fff', fontSize: 12, fontWeight: 500, padding: '7px 12px', cursor: 'pointer',
};

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
