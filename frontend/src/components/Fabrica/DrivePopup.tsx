'use client';

import { useState, useEffect, useCallback } from 'react';
import { ExternalLink, Loader2, X, HardDrive, Check, Square, Search, ChevronLeft, FolderOpen } from 'lucide-react';
import { API_BASE } from '@/lib/api';

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string | null;
  webViewLink?: string | null;
  webContentLink?: string | null;
  size?: number | null;
  modifiedTime?: string | null;
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

function formatSize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export function DrivePopup({ onClose, onInject }: Props) {
  const [status, setStatus] = useState<'loading' | 'connected' | 'disconnected' | 'error'>('loading');
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [folderStack, setFolderStack] = useState<Array<{ id: string; name: string }>>([]);

  const currentFolderId = folderStack.length > 0 ? folderStack[folderStack.length - 1].id : undefined;

  const loadFiles = useCallback(async (folderId?: string, q?: string) => {
    setLoadingFiles(true);
    try {
      const params = new URLSearchParams();
      if (folderId) params.set('folderId', folderId);
      if (q) params.set('q', q);
      const qs = params.toString();
      const url = `${API_BASE}/google/files${qs ? `?${qs}` : ''}`;
      const r = await fetch(url, { headers: authHeaders() });
      const d = await r.json() as { data?: DriveFile[] };
      setFiles(d.data ?? []);
    } catch {
      setFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/google/status`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d: { connected?: boolean }) => {
        if (!d.connected) {
          setStatus('disconnected');
          return;
        }
        setStatus('connected');
        loadFiles();
      })
      .catch(() => setStatus('error'));
  }, [loadFiles]);

  // Reload on folder or search changes
  useEffect(() => {
    if (status !== 'connected') return;
    const timeout = setTimeout(() => {
      loadFiles(currentFolderId, searchQuery || undefined);
    }, searchQuery ? 400 : 0);
    return () => clearTimeout(timeout);
  }, [currentFolderId, searchQuery, status, loadFiles]);

  const handleConnectDrive = async () => {
    try {
      const res = await fetch(`${API_BASE}/google/auth-url`, { headers: authHeaders() });
      const data = await res.json();
      if (data.data?.url) {
        window.location.href = data.data.url;
      } else {
        alert('Não foi possível obter a URL de autenticação do Google Drive.');
      }
    } catch (err) {
      console.error(err);
      alert('Falha ao iniciar conexão com Google Drive.');
    }
  };

  const openFolder = (file: DriveFile) => {
    setFolderStack((prev) => [...prev, { id: file.id, name: file.name }]);
    setSelectedFiles(new Set());
    setSearchQuery('');
  };

  const goBack = () => {
    setFolderStack((prev) => prev.slice(0, -1));
    setSelectedFiles(new Set());
    setSearchQuery('');
  };

  const toggleFile = (id: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const injectSelected = async () => {
    const selected = files.filter((f) => selectedFiles.has(f.id));
    if (selected.length === 0) return;

    setDownloading(true);
    const textParts = ['[Arquivos importados do Google Drive]'];
    const attachments: Array<{ name: string; mimeType: string; dataBase64: string }> = [];

    try {
      for (const file of selected) {
        textParts.push(`- ${file.name} (${file.mimeType})`);

        const isMedia = file.mimeType.startsWith('image/') || file.mimeType.startsWith('video/');
        if (isMedia) {
          try {
            const res = await fetch(`${API_BASE}/google/files/${file.id}/download`, { headers: authHeaders() });
            if (res.ok) {
              const resData = (await res.json()) as { data?: { name: string; mimeType: string; dataBase64: string } };
              if (resData.data) {
                attachments.push(resData.data);
              }
            }
          } catch (err) {
            console.warn(`[DrivePopup] Falha ao baixar ${file.name}:`, err);
          }
        }
      }

      onInject(textParts.join('\n'), attachments);
      onClose();
    } catch (err) {
      console.error(err);
      alert('Erro ao processar arquivos do Drive.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={POPUP} onClick={(e) => e.stopPropagation()}>
        <div style={HEADER}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <HardDrive size={15} style={{ color: '#3b82f6' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#1d1c1a' }}>Google Drive</span>
          </div>
          <button style={CLOSE_BTN} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {status === 'loading' && (
          <div style={CENTER}>
            <Loader2 size={24} style={{ color: '#3b82f6' }} className="animate-spin" />
          </div>
        )}

        {status === 'error' && (
          <div style={CENTER}>
            <p style={{ fontSize: 12, color: '#ef4444', textAlign: 'center', margin: 0 }}>
              Falha ao conectar com a API do Google Drive. Verifique se o backend está ativo.
            </p>
          </div>
        )}

        {status === 'disconnected' && (
          <div style={DISCONNECTED_STATE}>
            <p style={{ fontSize: 12, color: '#4b5563', marginBottom: '16px', textAlign: 'center' }}>
              Para trazer mídias e contextos de marcas diretamente do Google Drive, conecte sua conta do Google abaixo.
            </p>
            <button style={CONNECT_BTN} onClick={handleConnectDrive}>
              Conectar Google Drive
            </button>
          </div>
        )}

        {status === 'connected' && (
          <div style={CONTENT}>
            {/* Search + breadcrumb */}
            <div style={TOOLBAR}>
              {folderStack.length > 0 && (
                <button style={BACK_BTN} onClick={goBack} title="Voltar">
                  <ChevronLeft size={14} />
                </button>
              )}
              <div style={SEARCH_WRAP}>
                <Search size={12} style={{ color: '#9ca3af', flexShrink: 0 }} />
                <input
                  style={SEARCH_INPUT}
                  placeholder={folderStack.length > 0 ? `Buscar em "${folderStack[folderStack.length - 1].name}"` : 'Buscar no Drive...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* Breadcrumb */}
            {folderStack.length > 0 && (
              <div style={BREADCRUMB}>
                <span style={{ color: '#9ca3af', cursor: 'pointer' }} onClick={() => { setFolderStack([]); setSearchQuery(''); }}>
                  Meu Drive
                </span>
                {folderStack.map((f, i) => (
                  <span key={f.id}>
                    <span style={{ color: '#d1d5db', margin: '0 4px' }}>/</span>
                    <span
                      style={{ color: i === folderStack.length - 1 ? '#1f2937' : '#9ca3af', cursor: 'pointer', fontWeight: i === folderStack.length - 1 ? 500 : 400 }}
                      onClick={() => { setFolderStack((prev) => prev.slice(0, i + 1)); setSearchQuery(''); }}
                    >
                      {f.name}
                    </span>
                  </span>
                ))}
              </div>
            )}

            <div style={LIST}>
              {loadingFiles ? (
                <div style={CENTER}>
                  <Loader2 size={20} style={{ color: '#3b82f6' }} className="animate-spin" />
                </div>
              ) : files.length === 0 ? (
                <p style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', padding: '24px 0' }}>
                  {searchQuery ? 'Nenhum resultado encontrado.' : 'Nenhum arquivo encontrado nesta pasta.'}
                </p>
              ) : (
                files.map((file) => {
                  const isSelected = selectedFiles.has(file.id);
                  const isFolder = file.mimeType === 'application/vnd.google-apps.folder';

                  return (
                    <div
                      key={file.id}
                      style={{
                        ...FILE_ROW,
                        backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.05)' : 'transparent',
                        borderColor: isSelected ? '#3b82f6' : 'rgba(0, 0, 0, 0.06)',
                      }}
                      onClick={() => isFolder ? openFolder(file) : toggleFile(file.id)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                        {/* Thumbnail or icon */}
                        {file.thumbnailLink && !isFolder ? (
                          <img
                            src={file.thumbnailLink}
                            alt=""
                            style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <span style={{ fontSize: '18px', flexShrink: 0 }}>{isFolder ? '📁' : '📄'}</span>
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                          <span style={{ fontSize: '12px', fontWeight: 500, color: '#1f2937', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {file.name}
                          </span>
                          <span style={{ fontSize: '10px', color: '#9ca3af' }}>
                            {isFolder ? 'Pasta' : [formatSize(file.size), formatDate(file.modifiedTime)].filter(Boolean).join(' · ')}
                          </span>
                        </div>
                      </div>
                      {isFolder ? (
                        <FolderOpen size={14} style={{ color: '#d1d5db', flexShrink: 0 }} />
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {file.webViewLink && (
                            <a
                              href={file.webViewLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              style={{ color: '#d1d5db' }}
                              title="Abrir no Drive"
                            >
                              <ExternalLink size={12} />
                            </a>
                          )}
                          <div style={{ color: isSelected ? '#3b82f6' : '#d1d5db' }}>
                            {isSelected ? <Check size={16} /> : <Square size={16} style={{ opacity: 0.3 }} />}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div style={FOOTER}>
              <span style={{ fontSize: 10, color: '#9ca3af' }}>
                {selectedFiles.size > 0 ? `${selectedFiles.size} selecionado(s)` : 'Selecione arquivos para injetar'}
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button style={CANCEL_BTN} onClick={onClose} disabled={downloading}>
                  Cancelar
                </button>
                <button
                  style={{
                    ...INJECT_BTN,
                    opacity: selectedFiles.size === 0 || downloading ? 0.6 : 1,
                    cursor: selectedFiles.size === 0 || downloading ? 'not-allowed' : 'pointer',
                  }}
                  disabled={selectedFiles.size === 0 || downloading}
                  onClick={injectSelected}
                >
                  {downloading ? 'Baixando...' : 'Injetar no Chat'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const OVERLAY: React.CSSProperties = {
  position: 'fixed',
  top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  backdropFilter: 'blur(2px)',
};

const POPUP: React.CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: '12px',
  width: 'min(460px, 90vw)',
  maxHeight: '80vh',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
  overflow: 'hidden',
};

const HEADER: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  borderBottom: '1px solid rgba(0, 0, 0, 0.08)',
};

const CLOSE_BTN: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: '#6b7280',
  padding: '4px',
  borderRadius: '4px',
};

const CENTER: React.CSSProperties = {
  padding: '48px 16px',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
};

const DISCONNECTED_STATE: React.CSSProperties = {
  padding: '32px 24px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};

const CONNECT_BTN: React.CSSProperties = {
  backgroundColor: '#3b82f6',
  color: '#ffffff',
  border: 'none',
  padding: '8px 16px',
  borderRadius: '6px',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
  boxShadow: '0 2px 4px rgba(59, 130, 246, 0.15)',
};

const CONTENT: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  overflow: 'hidden',
};

const TOOLBAR: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '8px 12px',
  borderBottom: '1px solid rgba(0, 0, 0, 0.06)',
};

const BACK_BTN: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  background: '#ffffff',
  borderRadius: '6px',
  padding: '4px',
  cursor: 'pointer',
  color: '#6b7280',
  display: 'flex',
  alignItems: 'center',
};

const SEARCH_WRAP: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  flex: 1,
  background: '#f9fafb',
  borderRadius: '6px',
  padding: '5px 8px',
  border: '1px solid rgba(0, 0, 0, 0.06)',
};

const SEARCH_INPUT: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  outline: 'none',
  fontSize: '12px',
  color: '#1f2937',
  flex: 1,
};

const BREADCRUMB: React.CSSProperties = {
  padding: '4px 16px 6px',
  fontSize: '10px',
  color: '#9ca3af',
  borderBottom: '1px solid rgba(0, 0, 0, 0.04)',
};

const LIST: React.CSSProperties = {
  padding: '8px 12px',
  overflowY: 'auto',
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const FILE_ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 10px',
  borderRadius: '8px',
  border: '1px solid',
  cursor: 'pointer',
  transition: 'all 0.15s ease',
};

const FOOTER: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  padding: '10px 16px',
  borderTop: '1px solid rgba(0, 0, 0, 0.08)',
  backgroundColor: '#f9fafb',
};

const CANCEL_BTN: React.CSSProperties = {
  border: '1px solid #d1d5db',
  background: '#ffffff',
  color: '#374151',
  padding: '6px 12px',
  borderRadius: '6px',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
};

const INJECT_BTN: React.CSSProperties = {
  border: 'none',
  background: '#3b82f6',
  color: '#ffffff',
  padding: '6px 12px',
  borderRadius: '6px',
  fontSize: '12px',
  fontWeight: 500,
};
