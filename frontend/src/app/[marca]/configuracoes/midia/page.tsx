'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  ArrowLeft, Upload, Image as ImageIcon, FileText, Trash2, Loader2,
  HardDrive, FileImage, Sparkles, Images, Layers, Camera, Tag,
  Folder, FolderPlus, ChevronRight, ChevronDown, Edit3, X, Plus
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import configStyles from '../configuracoes.module.css';
import styles from './midia.module.css';
import { api, getApiErrorMessage } from '@/lib/api';
import { useBrandPermissions } from '@/hooks/useBrandPermissions';
import type { CanvaDesign } from '@/components/Fabrica/CanvaPopup';

const DrivePopup = dynamic(() => import('@/components/Fabrica/DrivePopup').then((m) => ({ default: m.DrivePopup })), { ssr: false });
const CanvaPopup = dynamic(() => import('@/components/Fabrica/CanvaPopup').then((m) => ({ default: m.CanvaPopup })), { ssr: false });
const BrandbookUploaderModal = dynamic(() => import('@/components/Brandbook/BrandbookUploaderModal'), { ssr: false });

type AssetSource = 'upload' | 'drive' | 'canva' | 'asana' | 'ai-generated' | 'brandbook' | 'branding' | 'unsplash';


interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  type?: 'POST' | 'MEDIA';
}

function groupByParent(folders: FolderNode[]) {
  const map = new Map<string | null, FolderNode[]>();
  for (const f of folders) {
    const arr = map.get(f.parentId) ?? [];
    arr.push(f);
    map.set(f.parentId, arr);
  }
  return map;
}

function collectSubtree(rootId: string, byParent: Map<string | null, FolderNode[]>, set = new Set<string>()): Set<string> {
  set.add(rootId);
  const children = byParent.get(rootId) ?? [];
  for (const c of children) {
    collectSubtree(c.id, byParent, set);
  }
  return set;
}

interface Asset {
  id: string;
  name: string;
  url: string;
  fileType: string;
  sizeBytes: number;
  source?: string;
  tags?: string[];
  folderId?: string | null;
}

const SOURCE_LABEL: Record<string, string> = {
  upload: 'Upload',
  drive: 'Drive',
  canva: 'Canva',
  asana: 'Asana',
  'ai-generated': 'Gerado por IA',
  brandbook: 'Brandbook',
  branding: 'Branding',
  unsplash: 'Unsplash',
};

const SOURCE_ICON: Record<string, typeof HardDrive> = {
  upload: Upload,
  drive: HardDrive,
  canva: FileImage,
  asana: FileText,
  'ai-generated': Sparkles,
  brandbook: Layers,
  branding: Tag,
  unsplash: Camera,
};

export default function MidiaPage() {
  const params = useParams();
  const slug = params.marca as string;
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);

  const [uploading, setUploading] = useState(false);
  const [erro, setErro] = useState('');
  const [importando, setImportando] = useState(false);
  const [exportandoCanva, setExportandoCanva] = useState<string | null>(null);
  const [popupAberto, setPopupAberto] = useState<'drive' | 'canva' | null>(null);

  const [filterSource, setFilterSource] = useState<AssetSource | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);

  const { can, hint } = useBrandPermissions();
  const canManageAssets = can('manage-assets');

  const fileInputRef = useRef<HTMLInputElement>(null);


  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [newFolderParentId, setNewFolderParentId] = useState<string | null>(null);
  const [showFolderModal, setShowFolderModal] = useState(false);
  
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renamingFolderName, setRenamingFolderName] = useState('');

  const [draggedAssetId, setDraggedAssetId] = useState<string | null>(null);
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

  const foldersByParent = useMemo(() => groupByParent(folders), [folders]);

  const fetchFolders = async () => {
    try {
      const res = await api.get<{ data: FolderNode[] }>(`/folders/${slug}?type=MEDIA`);
      setFolders(res?.data || []);
    } catch (e) {
      console.error('Falha ao carregar pastas de media:', e);
    }
  };

  useEffect(() => {
    fetchFolders();
  }, [slug]);

  const openFolderModal = (parentId: string | null, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setNewFolderParentId(parentId);
    setShowFolderModal(true);
  };

  const toggleFolder = (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim() || creatingFolder) return;
    setCreatingFolder(true);
    try {
      const { data } = await api.post<{ data: FolderNode }>(`/folders/${slug}`, { name: newFolderName, parentId: newFolderParentId, type: 'MEDIA' });
      if (data) {
        setFolders(prev => [...prev, data]);
        if (newFolderParentId) setExpandedFolders(prev => new Set(prev).add(newFolderParentId));
        setShowFolderModal(false);
        setNewFolderName('');
      }
    } catch (err) {
      alert(getApiErrorMessage(err, 'Falha ao criar pasta.'));
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleRenameFolder = async (e: React.FormEvent, folderId: string) => {
    e.preventDefault();
    if (!renamingFolderName.trim()) return;
    try {
      const updated = await api.patch<{ data: FolderNode }>(`/folders/${folderId}`, { name: renamingFolderName.trim() });
      if (updated?.data) {
        setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, name: updated.data.name } : f)));
      }
      setRenamingFolderId(null);
      setRenamingFolderName('');
    } catch (err) {
      alert(getApiErrorMessage(err, 'Não consegui renomear a pasta.'));
    }
  };

  const handleDeleteFolder = async (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const removed = collectSubtree(folderId, foldersByParent);
    const message = removed.size - 1 > 0
      ? `Deseja excluir esta pasta e suas ${removed.size - 1} subpasta(s)? Os arquivos não serão deletados, apenas movidos para a biblioteca geral.`
      : 'Deseja excluir esta pasta? Os arquivos não serão deletados.';
    if (!confirm(message)) return;

    try {
      await api.delete(`/folders/${folderId}`);
      setFolders(prev => prev.filter(f => !removed.has(f.id)));
      if (activeFolder && removed.has(activeFolder)) setActiveFolder(null);
      fetchAssets();
    } catch (err) {
      alert('Failed to delete folder');
    }
  };

  const handleMoveFolder = async (folderId: string, newParentId: string | null) => {
    if (folderId === newParentId) return;
    try {
      const updated = await api.patch<{ data: FolderNode }>(`/folders/${folderId}`, { parentId: newParentId });
      if (updated?.data) {
        setFolders(prev => prev.map(f => f.id === folderId ? { ...f, parentId: updated.data.parentId } : f));
        if (newParentId) setExpandedFolders(prev => new Set(prev).add(newParentId));
      }
    } catch (err) {
      alert(getApiErrorMessage(err, 'Não foi possível mover a pasta.'));
    }
  };

  const handleMoveToFolder = async (assetId: string, newFolderId: string | null) => {
    try {
      await api.patch(`/brands/${slug}/assets/${assetId}`, { folderId: newFolderId });
      setAssets(prev => prev.map(a => a.id === assetId ? { ...a, folderId: newFolderId } : a));
    } catch (err) {
      alert('Não foi possível mover o arquivo.');
    }
  };

  const handleFolderDragStart = (folderId: string, e: React.DragEvent) => {
    e.stopPropagation();
    setDraggedFolderId(folderId);
  };

  const handleDragOver = (e: React.DragEvent, targetFolderId: string | null) => {
    if (draggedFolderId) {
      const dragged = folders.find(f => f.id === draggedFolderId);
      if (!dragged) return;
      if (targetFolderId === 'unassigned') return;
      if (targetFolderId === 'root') {
        if (!dragged.parentId) return;
      } else if (targetFolderId) {
        if (collectSubtree(dragged.id, foldersByParent).has(targetFolderId)) return;
        if (dragged.parentId === targetFolderId) return;
      }
      e.preventDefault();
      setDragOverFolderId(targetFolderId);
      return;
    }

    if (!draggedAssetId) return;
    const asset = assets.find(a => a.id === draggedAssetId);
    if (!asset) return;
    if (targetFolderId === 'root') return;
    if (targetFolderId === 'unassigned' && !asset.folderId) return;
    if (targetFolderId === asset.folderId) return;

    e.preventDefault();
    setDragOverFolderId(targetFolderId);
  };

  const handleDrop = async (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    if (draggedFolderId) {
      await handleMoveFolder(draggedFolderId, folderId === 'root' ? null : folderId);
    } else if (draggedAssetId) {
      await handleMoveToFolder(draggedAssetId, folderId === 'unassigned' ? null : folderId);
    }
    setDraggedAssetId(null);
    setDraggedFolderId(null);
    setDragOverFolderId(null);
  };

  const renderFolderTree = (parentId: string | null, depth: number): React.ReactNode => {
    const children = foldersByParent.get(parentId) ?? [];
    return children.map(folder => {
      const subfolders = foldersByParent.get(folder.id) ?? [];
      const hasChildren = subfolders.length > 0;
      const isExpanded = expandedFolders.has(folder.id);
      return (
        <div key={folder.id}>
          <div
            className={`${styles.folderRow} ${activeFolder === folder.id ? styles.folderCardActive : ''} ${dragOverFolderId === folder.id ? styles.folderCardDragOver : ''}`}
            style={{ marginLeft: `calc(${depth} * var(--space-6))` }}
            onClick={() => setActiveFolder(folder.id)}
            draggable={canManageAssets}
            onDragStart={(e) => handleFolderDragStart(folder.id, e)}
            onDragEnd={() => { setDraggedFolderId(null); setDragOverFolderId(null); }}
            onDragOver={(e) => handleDragOver(e, folder.id)}
            onDragLeave={() => setDragOverFolderId(null)}
            onDrop={(e) => handleDrop(e, folder.id)}
          >
            <button
              type="button"
              className={styles.folderChevron}
              onClick={(e) => toggleFolder(folder.id, e)}
              disabled={!hasChildren}
            >
              {hasChildren
                ? (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)
                : <span className={styles.chevronPlaceholder} />}
            </button>
            <Folder size={16} />
            {renamingFolderId === folder.id ? (
              <form onSubmit={(e) => handleRenameFolder(e, folder.id)} style={{ flex: 1, display: 'flex', gap: '4px' }}>
                <input
                  type="text"
                  value={renamingFolderName}
                  onChange={(e) => setRenamingFolderName(e.target.value)}
                  autoFocus
                  style={{ flex: 1, padding: '2px 6px', fontSize: '13px', borderRadius: '4px', border: '1px solid var(--color-border)' }}
                  onBlur={() => setRenamingFolderId(null)}
                />
              </form>
            ) : (
              <span className={styles.folderName}>{folder.name}</span>
            )}
            {canManageAssets && renamingFolderId !== folder.id && (
              <>
                <button className={styles.closeBtn} onClick={(e) => { e.stopPropagation(); setRenamingFolderId(folder.id); setRenamingFolderName(folder.name); }} title="Renomear">
                  <Edit3 size={12} />
                </button>
                <button className={styles.closeBtn} onClick={(e) => openFolderModal(folder.id, e)} title="Criar subpasta">
                  <FolderPlus size={12} />
                </button>
                <button className={styles.closeBtn} onClick={(e) => handleDeleteFolder(folder.id, e)} title="Excluir Pasta">
                  <Trash2 size={12} />
                </button>
              </>
            )}
          </div>
          {hasChildren && isExpanded && renderFolderTree(folder.id, depth + 1)}
        </div>
      );
    });
  };

  const fetchAssets = async () => {
    try {
      const res = await api.get<{ data: Asset[] }>(`/brands/${slug}/assets`);
      setAssets(Array.isArray(res?.data) ? res.data : []);
    } catch (e) {
      console.error(e);
      setAssets([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssets();
  }, [slug]);

  // Contagem por fonte — vira tanto o resumo estratégico do topo quanto os
  // filtros (clicar num chip filtra a grade abaixo).
  const sourceCounts = useMemo(() => {
    const list = Array.isArray(assets) ? assets : [];
    const counts: Partial<Record<AssetSource, number>> = {};
    for (const a of list) {
      const s = (a.source ?? 'upload') as AssetSource;
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }, [assets]);

  // Tags mais usadas (fora as que só repetem o nome da fonte) — o essencial
  // pra filtrar sem virar uma nuvem infinita de tags de baixo valor.
  const topTags = useMemo(() => {
    const list = Array.isArray(assets) ? assets : [];
    const counts = new Map<string, number>();
    for (const a of list) {
      for (const t of a.tags ?? []) {
        if (Object.keys(SOURCE_LABEL).includes(t)) continue; // já é chip de fonte
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [assets]);

  const filteredAssets = useMemo(() => {
    const list = Array.isArray(assets) ? assets : [];
    return list.filter((a) => {
      const source = (a.source ?? 'upload') as AssetSource;
      if (filterSource && source !== filterSource) return false;
      if (filterTag && !(a.tags ?? []).includes(filterTag)) return false;
      
      if (activeFolder === null) return true;
      if (activeFolder === 'unassigned') return !a.folderId;
      return a.folderId === activeFolder;
    });
  }, [assets, filterSource, filterTag]);

  const handleImportAttachments = async (
    _text: string,
    attachments?: Array<{ name: string; mimeType: string; dataBase64: string }>,
  ) => {
    const source = popupAberto;
    setPopupAberto(null);
    if (!attachments || attachments.length === 0 || !source) return;

    setImportando(true);
    setErro('');
    try {
      await api.post(`/brands/${slug}/assets/import-base64`, { attachments, source });
      fetchAssets();
    } catch (error) {
      setErro(getApiErrorMessage(error, 'Não consegui importar os arquivos selecionados.'));
    } finally {
      setImportando(false);
    }
  };

  // Não fecha o popup nem engole o erro aqui: o CanvaPopup espera esta Promise
  // pra mostrar o spinner NO card clicado, e só fecha sozinho se der certo —
  // em erro, o card mostra o aviso e o usuário tenta de novo sem reabrir tudo.
  const handleSelectCanvaDesign = async (design: CanvaDesign) => {
    setErro('');
    try {
      await api.post(`/brands/${slug}/assets/import-canva/${design.id}`, { title: design.title });
      fetchAssets();
    } catch (error) {
      setErro(getApiErrorMessage(error, 'Não consegui importar o design do Canva.'));
      throw error;
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setErro('');
    try {
      await api.uploadFile(`/brands/${slug}/assets`, file);
      fetchAssets();
    } catch (error) {
      setErro(getApiErrorMessage(error, 'Falha ao enviar arquivo.'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemove = async (assetId: string) => {
    if (!confirm('Excluir este arquivo permanentemente? Ele não carregará mais nos designs onde foi usado.')) return;
    setErro('');
    try {
      await api.delete(`/brands/${slug}/assets/${assetId}`);
      fetchAssets();
    } catch (e) {
      setErro(getApiErrorMessage(e, 'Não foi possível excluir o arquivo.'));
    }
  };

  const handleExportCanva = async (assetId: string) => {
    setExportandoCanva(assetId);
    setErro('');
    try {
      const res = await api.post<{ url: string }>(`/brands/${slug}/assets/${assetId}/export-canva`, {});
      if (res.url) {
        window.open(res.url, '_blank');
      }
    } catch (error) {
      setErro(getApiErrorMessage(error, 'Falha ao exportar imagem para o Canva. Verifique se o Canva está conectado em Configurações > Integrações Canva.'));
    } finally {
      setExportandoCanva(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const [isBrandbookModalOpen, setIsBrandbookModalOpen] = useState(false);
  const busy = uploading || importando;

  return (
    <div>
      <Link href={`/${params.marca}/configuracoes`} className={configStyles.backLink}>
        <ArrowLeft size={16} />
        Voltar para configurações
      </Link>

      <div className={styles.headerRow}>
        <PageHeader
          title="Biblioteca de Mídia"
          description="Imagens e vetores disponíveis para todos os usuários desta marca — enviados à mão, importados do Drive/Canva, ou gerados automaticamente pela Fábrica."
        />
        <div className={styles.actions}>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleFileUpload}
            accept="image/*,font/*,.svg"
          />
          <Button
            onClick={() => setIsBrandbookModalOpen(true)}
            disabled={busy || !canManageAssets}
          >
            <Sparkles size={16} />
            Adicionar Brandbook
          </Button>
          <Button
            variant="secondary"
            onClick={() => setPopupAberto('canva')}
            disabled={busy || !canManageAssets}
            title={canManageAssets ? undefined : hint}
          >
            <FileImage size={16} />
            Importar do Canva
          </Button>
          <Button
            variant="secondary"
            onClick={() => setPopupAberto('drive')}
            disabled={busy || !canManageAssets}
            title={canManageAssets ? undefined : hint}
          >
            <HardDrive size={16} />
            Importar do Drive
          </Button>
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || !canManageAssets}
            title={canManageAssets ? undefined : hint}
          >
            {uploading ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
            {uploading ? 'Enviando...' : 'Fazer Upload'}
          </Button>
        </div>
      </div>

      {assets.length > 0 && (
        <div className={styles.statBar}>
          <button
            className={`${styles.statChip} ${filterSource === null ? styles.statChipActive : ''}`}
            onClick={() => setFilterSource(null)}
          >
            <Images size={13} />
            Todos <span className={styles.statChipCount}>{assets.length}</span>
          </button>
          {(Object.keys(SOURCE_LABEL) as AssetSource[])
            .filter((s) => sourceCounts[s])
            .map((s) => {
              const Icon = SOURCE_ICON[s];
              return (
                <button
                  key={s}
                  className={`${styles.statChip} ${filterSource === s ? styles.statChipActive : ''}`}
                  onClick={() => setFilterSource((prev) => (prev === s ? null : s))}
                >
                  <Icon size={13} />
                  {SOURCE_LABEL[s]} <span className={styles.statChipCount}>{sourceCounts[s]}</span>
                </button>
              );
            })}
        </div>
      )}

      {topTags.length > 0 && (
        <div className={styles.tagRow}>
          {topTags.map(([tag, count]) => (
            <button
              key={tag}
              className={`${styles.tagChip} ${filterTag === tag ? styles.tagChipActive : ''}`}
              onClick={() => setFilterTag((prev) => (prev === tag ? null : tag))}
              title={`${count} arquivo${count > 1 ? 's' : ''}`}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {importando && (
        <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginTop: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Loader2 className="animate-spin" size={14} /> Importando...
        </p>
      )}

      {popupAberto === 'drive' && (
        <DrivePopup onClose={() => setPopupAberto(null)} onInject={handleImportAttachments} />
      )}
      {popupAberto === 'canva' && (
        <CanvaPopup onClose={() => setPopupAberto(null)} onInject={() => {}} onSelectDesign={handleSelectCanvaDesign} />
      )}

      {erro && (
        <p style={{ fontSize: '13px', color: 'var(--color-error)', marginTop: '12px' }} role="alert">
          {erro}
        </p>
      )}

      
      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <h3>Pastas</h3>
            {canManageAssets && (
              <button onClick={(e) => openFolderModal(null, e)} className={styles.addFolderBtn} title="Criar Pasta raiz">
                <FolderPlus size={16} />
              </button>
            )}
          </div>
          
          <div className={styles.folderList}>
            <div
              className={`${styles.folderRow} ${activeFolder === null ? styles.folderCardActive : ''} ${dragOverFolderId === 'root' ? styles.folderCardDragOver : ''}`}
              onClick={() => setActiveFolder(null)}
              onDragOver={(e) => handleDragOver(e, 'root')}
              onDragLeave={() => setDragOverFolderId(null)}
              onDrop={(e) => handleDrop(e, 'root')}
            >
              <span className={styles.chevronPlaceholder} />
              <Layers size={16} />
              <span className={styles.folderName}>Todas as Mídias</span>
            </div>

            {renderFolderTree(null, 0)}

            <div
              className={`${styles.folderRow} ${activeFolder === 'unassigned' ? styles.folderCardActive : ''} ${dragOverFolderId === 'unassigned' ? styles.folderCardDragOver : ''}`}
              style={{ marginTop: '8px' }}
              onClick={() => setActiveFolder('unassigned')}
              onDragOver={(e) => handleDragOver(e, 'unassigned')}
              onDragLeave={() => setDragOverFolderId(null)}
              onDrop={(e) => handleDrop(e, 'unassigned')}
            >
              <span className={styles.chevronPlaceholder} />
              <FileText size={16} />
              <span className={styles.folderName}>Sem Pasta</span>
            </div>
          </div>
        </aside>

        <main className={styles.main}>
<div className={styles.grid}>
        {loading ? (
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Loader2 className="animate-spin" size={16} /> Carregando mídias...
          </div>
        ) : filteredAssets.length === 0 ? (
          <div className={styles.emptyState}>
            <ImageIcon size={48} style={{ opacity: 0.2, margin: '0 auto 16px' }} />
            <p>{assets.length === 0 ? 'Nenhuma mídia encontrada na biblioteca da marca.' : 'Nenhum arquivo corresponde a este filtro.'}</p>
          </div>
        ) : (
          filteredAssets.map((asset) => {
            const source = (asset.source ?? 'upload') as AssetSource;
            // Fonte nova vinda do backend não pode derrubar a página inteira —
            // sem entrada no mapa, cai no genérico em vez de estourar React Error 130.
            const SourceIcon = SOURCE_ICON[source] ?? FileText;
            const extraTags = (asset.tags ?? []).filter((t) => t !== source).slice(0, 2);
            return (
              <div
                key={asset.id}
                draggable={canManageAssets}
                onDragStart={(e: React.DragEvent) => {
                  setDraggedAssetId(asset.id);
                }}
                onDragEnd={() => {
                  setDraggedAssetId(null);
                  setDragOverFolderId(null);
                }}
                style={{ cursor: canManageAssets ? 'grab' : 'default' }}
              >
                <Card 
                  padding="none" 
                  className={styles.card}
                >
                  <div className={styles.thumb}>
                  <span className={styles.sourceBadge}>
                    <SourceIcon size={11} />
                    {SOURCE_LABEL[source] ?? source}
                  </span>
                  {asset.fileType.startsWith('image/') ? (
                    <img src={asset.url} alt={asset.name} className={styles.thumbImg} />
                  ) : (
                    <FileText size={32} style={{ color: 'var(--color-text-tertiary)' }} />
                  )}
                </div>
                <div className={styles.cardBody}>
                  <div className={styles.cardName} title={asset.name}>
                    {asset.name}
                  </div>
                  <div className={styles.cardMeta}>
                    <span>{formatSize(asset.sizeBytes)}</span>
                    <span>{asset.fileType.split('/')[1]?.toUpperCase()}</span>
                  </div>
                  {extraTags.length > 0 && (
                    <div className={styles.cardTags}>
                      {extraTags.map((t) => (
                        <span key={t} className={styles.cardTagPill}>#{t}</span>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  {source === 'ai-generated' && (
                    <button
                      onClick={() => handleExportCanva(asset.id)}
                      disabled={exportandoCanva === asset.id || !canManageAssets}
                      title={canManageAssets ? 'Criar um design no Canva com essa imagem' : hint}
                      className={styles.removeBtn}
                      style={{ color: '#00c4cc' }}
                    >
                      {exportandoCanva === asset.id ? <Loader2 className="animate-spin" size={14} /> : <FileImage size={14} />}
                    </button>
                  )}
                  <button
                    onClick={() => handleRemove(asset.id)}
                    disabled={!canManageAssets}
                    title={canManageAssets ? 'Excluir arquivo' : hint}
                    className={styles.removeBtn}
                    style={{ display: canManageAssets ? 'flex' : 'none' }}
                  >
                    <Trash2 size={14} />
                  </button>
                  </div>
                </Card>
              </div>
            );
          })
        )}
      </div>
        </main>
      </div>

      {showFolderModal && (
        <div className={styles.modalOverlay} onClick={() => setShowFolderModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>
                {newFolderParentId
                  ? `Nova subpasta em "${folders.find(f => f.id === newFolderParentId)?.name ?? ''}"`
                  : 'Criar Pasta'}
              </h3>
              <button className={styles.closeBtn} onClick={() => setShowFolderModal(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateFolder} className={styles.folderForm} style={{ marginBottom: 0 }}>
              <input
                type="text"
                placeholder="Ex: Arquivos Brutos"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                className={styles.folderInput}
                autoFocus
              />
              <Button type="submit" size="sm" disabled={!newFolderName.trim() || creatingFolder}>
                <Plus size={14} />
                {creatingFolder ? 'Criando...' : 'Criar'}
              </Button>
            </form>
          </div>
        </div>
      )}


      <BrandbookUploaderModal
        slug={slug}
        isOpen={isBrandbookModalOpen}
        onClose={() => setIsBrandbookModalOpen(false)}
        onSuccess={() => {
          setLoading(true);
          api.get<Asset[]>(`/brands/${slug}/assets`)
            .then((data) => setAssets(Array.isArray(data) ? data : []))
            .catch(() => setAssets([]))
            .finally(() => setLoading(false));
        }}
      />
    </div>
  );
}
