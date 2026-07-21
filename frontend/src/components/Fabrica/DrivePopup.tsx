'use client';

import { useState, useEffect, useCallback } from 'react';
import { ExternalLink, Loader2, X, HardDrive, Check, Square, Search, ChevronLeft, Folder, File } from 'lucide-react';
import { API_BASE } from '@/lib/api';
import styles from './connectorPopup.module.css';

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

  const currentFolderId = folderStack.length > 0 ? folderStack[folderStack.length - 1]!.id : undefined;

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
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.popup + ' ' + styles.popupWide} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerTitleGroup}>
            <div className={styles.headerIconBadge} style={{ background: '#e8f0fe' }}>
              <HardDrive size={14} style={{ color: '#1a73e8' }} />
            </div>
            <span className={styles.headerTitle}>Google Drive</span>
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

        {status === 'error' && (
          <div className={styles.center}>
            <p className={`${styles.centerText} ${styles.centerTextError}`}>
              Falha ao conectar com a API do Google Drive. Verifique se o backend está ativo.
            </p>
          </div>
        )}

        {status === 'disconnected' && (
          <div className={styles.center}>
            <HardDrive size={32} style={{ color: 'var(--color-text-tertiary)', opacity: 0.5 }} />
            <p className={styles.centerText}>
              Para trazer mídias e contextos de marcas diretamente do Google Drive, conecte sua conta do Google.
            </p>
            <button className={styles.connectBtn} onClick={handleConnectDrive}>
              Conectar Google Drive
            </button>
          </div>
        )}

        {status === 'connected' && (
          <div className={styles.content}>
            <div className={styles.toolbar}>
              {folderStack.length > 0 && (
                <button className={styles.backBtn} onClick={goBack} title="Voltar">
                  <ChevronLeft size={14} />
                </button>
              )}
              <div className={styles.searchWrap}>
                <Search size={13} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
                <input
                  className={styles.searchInput}
                  placeholder={folderStack.length > 0 ? `Buscar em "${folderStack[folderStack.length - 1]!.name}"` : 'Buscar no Drive...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {folderStack.length > 0 && (
              <div className={styles.breadcrumb}>
                <span className={styles.breadcrumbItem} onClick={() => { setFolderStack([]); setSearchQuery(''); }}>
                  Meu Drive
                </span>
                {folderStack.map((f, i) => (
                  <span key={f.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <span className={styles.breadcrumbSep}>/</span>
                    <span
                      className={i === folderStack.length - 1 ? styles.breadcrumbActive : styles.breadcrumbItem}
                      onClick={() => { setFolderStack((prev) => prev.slice(0, i + 1)); setSearchQuery(''); }}
                    >
                      {f.name}
                    </span>
                  </span>
                ))}
              </div>
            )}

            <div className={styles.list}>
              {loadingFiles ? (
                <div className={styles.center}>
                  <Loader2 size={18} className={styles.spin} style={{ color: 'var(--color-text-tertiary)' }} />
                </div>
              ) : files.length === 0 ? (
                <p className={styles.emptyState}>
                  {searchQuery ? 'Nenhum resultado encontrado.' : 'Nenhum arquivo encontrado nesta pasta.'}
                </p>
              ) : (
                files.map((file) => {
                  const isSelected = selectedFiles.has(file.id);
                  const isFolder = file.mimeType === 'application/vnd.google-apps.folder';

                  return (
                    <button
                      key={file.id}
                      className={`${styles.listItem} ${isSelected ? styles.listItemSelected : ''}`}
                      onClick={() => isFolder ? openFolder(file) : toggleFile(file.id)}
                    >
                      <div className={styles.listItemMain}>
                        {file.thumbnailLink && !isFolder ? (
                          <img
                            src={file.thumbnailLink}
                            alt=""
                            className={styles.listItemThumb}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <span className={styles.listItemIcon}>
                            {isFolder
                              ? <Folder size={17} style={{ color: '#f6b93b' }} fill="#fce8b8" />
                              : <File size={17} style={{ color: 'var(--color-text-tertiary)' }} />}
                          </span>
                        )}
                        <div className={styles.listItemText}>
                          <span className={styles.listItemName}>{file.name}</span>
                          <span className={styles.listItemMeta}>
                            {isFolder ? 'Pasta' : [formatSize(file.size), formatDate(file.modifiedTime)].filter(Boolean).join(' · ')}
                          </span>
                        </div>
                      </div>
                      {isFolder ? (
                        <ChevronLeft size={14} style={{ color: 'var(--color-text-tertiary)', transform: 'rotate(180deg)', flexShrink: 0 }} />
                      ) : (
                        <div className={styles.listItemActions}>
                          {file.webViewLink && (
                            <a
                              href={file.webViewLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className={styles.externalLink}
                              title="Abrir no Drive"
                            >
                              <ExternalLink size={13} />
                            </a>
                          )}
                          <div className={`${styles.checkIcon} ${isSelected ? styles.checkIconSelected : ''}`}>
                            {isSelected ? <Check size={16} /> : <Square size={16} style={{ opacity: 0.35 }} />}
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            <div className={styles.footer}>
              <span className={styles.footerHint}>
                {selectedFiles.size > 0 ? `${selectedFiles.size} selecionado(s)` : 'Selecione arquivos para importar'}
              </span>
              <div className={styles.btnRow}>
                <button className={styles.btnSecondary} onClick={onClose} disabled={downloading}>
                  Cancelar
                </button>
                <button
                  className={styles.btnPrimary}
                  disabled={selectedFiles.size === 0 || downloading}
                  onClick={injectSelected}
                >
                  {downloading && <Loader2 size={13} className={styles.spin} />}
                  {downloading ? 'Baixando...' : 'Importar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
