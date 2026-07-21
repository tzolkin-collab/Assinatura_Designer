'use client';

import { useParams } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { ArrowLeft, Download, FileDown, Loader2, Maximize2, X, Folder, FolderPlus, ChevronRight, ChevronDown, Plus, Trash2, LayoutGrid, List, Sparkles, MessageSquareText, ExternalLink, Edit3, FolderInput, PenLine, Send, Presentation, Image as LucideImage } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import styles from './brand-galeria.module.css';
import { useBrandPosts, useBrand, type Post } from '@/lib/hooks';
import { useState, useEffect, useMemo } from 'react';
import { api, getApiErrorMessage } from '@/lib/api';
import { exportarDeck, type DeckFileFormat } from '@/lib/deckFile';
import { useBrandPermissions } from '@/hooks/useBrandPermissions';
import { extractChatHistory, extractDimensions, extractPreviewSource, extractSessionId, getAspectRatioTag, type FabricaChatHistoryMessage, type HtmlDesignPostContent } from '@/lib/designContent';
import DesignRenderer, { type DesignPage } from '@/components/Fabrica/DesignRenderer';
import dynamic from 'next/dynamic';
const HtmlSlideRenderer = dynamic(() => import('@/components/DesignDocument/HtmlSlideRenderer'), { ssr: false });
const AiSpendBadge = dynamic(() => import('@/components/AiUsage/AiSpendBadge'), { ssr: false });

function formatPostType(type: string) {
  switch (type) {
    case 'CAROUSEL': return 'Apresentação';
    case 'PRESENTATION': return 'Apresentação';
    case 'ANIMATION': return 'Animação';
    case 'SINGLE_IMAGE': return 'Post Único';
    default: return type;
  }
}

function postMatchesPreviewImage(post: Post, previewImage: string): boolean {
  return post.previewUrl === previewImage || !!(post.content && typeof post.content === 'object' && ((post.content as Record<string, unknown>).dataUrl === previewImage || (post.content as Record<string, unknown>).url === previewImage));
}

function formatChatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function formatAttachmentLabel(name: string, mimeType: string) {
  if (mimeType.startsWith('image/')) return `${name} · imagem`;
  return name;
}

type FolderNode = { id: string; name: string; parentId: string | null };

/** Agrupa as pastas por pai. O backend devolve lista plana; a árvore é montada aqui. */
function groupByParent(folders: FolderNode[]): Map<string | null, FolderNode[]> {
  const byParent = new Map<string | null, FolderNode[]>();
  // Um pai que não está na lista (não deveria acontecer) viraria uma pasta órfã e
  // invisível; tratamos como raiz para nunca sumir com a pasta do usuário.
  const ids = new Set(folders.map(f => f.id));
  for (const folder of folders) {
    const parent = folder.parentId && ids.has(folder.parentId) ? folder.parentId : null;
    const siblings = byParent.get(parent) ?? [];
    siblings.push(folder);
    byParent.set(parent, siblings);
  }
  return byParent;
}

/** Ids da subárvore de `folderId`, incluindo ela mesma: destinos proibidos ao mover. */
function collectSubtree(folderId: string, byParent: Map<string | null, FolderNode[]>): Set<string> {
  const blocked = new Set<string>([folderId]);
  const queue = [folderId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of byParent.get(current) ?? []) {
      blocked.add(child.id);
      queue.push(child.id);
    }
  }
  return blocked;
}

export default function BrandGaleriaPage() {
  const params = useParams();
  const slug = params.marca as string;
  const marca = decodeURIComponent(slug);
  const { posts, loading, error, mutate } = useBrandPosts(slug);
  const { brand } = useBrand(slug);
  const [activePreviewPost, setActivePreviewPost] = useState<Post | null>(null);
  const [activeCanvaExportPost, setActiveCanvaExportPost] = useState<Post | null>(null);
  const [canvaFormat, setCanvaFormat] = useState<'png' | 'pptx' | 'html'>('png');
  const [mostrarCanvaInstrucoes, setMostrarCanvaInstrucoes] = useState(false);
  const [chatHistoryPreview, setChatHistoryPreview] = useState<{ sessionId: string | null; messages: FabricaChatHistoryMessage[]; postLabel: string } | null>(null);

  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  // Pasta que vai receber a nova subpasta (null = criar na raiz).
  const [newFolderParentId, setNewFolderParentId] = useState<string | null>(null);

  const { can, hint } = useBrandPermissions();
  const canEdit = can('edit-design');
  
  // Renomear post
  const [renamingPostId, setRenamingPostId] = useState<string | null>(null);
  const [newPostName, setNewPostName] = useState('');

  const handleRenamePost = async (e: React.FormEvent, postId: string) => {
    e.preventDefault();
    if (!newPostName.trim()) return;
    try {
      await api.put(`/posts/${postId}`, { name: newPostName });
      setRenamingPostId(null);
      setNewPostName('');
      if (mutate) mutate();
    } catch (err) {
      console.error('Failed to rename post', err);
    }
  };

  const [showFolderModal, setShowFolderModal] = useState(false);
  const [showAiReportModal, setShowAiReportModal] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  
  const [draggedPostId, setDraggedPostId] = useState<string | null>(null);
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [activeBundle, setActiveBundle] = useState<'PRESENTATION' | 'DESIGNS' | 'ANIMATION'>('PRESENTATION');
  const [activeFormat, setActiveFormat] = useState<'all' | '1:1' | '3:4' | '4:5' | '16:9' | '9:16'>('all');

  // Um export por vez: cada slide é um render de chromium no servidor: deixar o
  // usuário disparar cinco decks juntos só derrubaria os cinco.
  const [exportando, setExportando] = useState<
    { postId: string; formato: DeckFileFormat; done: number; total: number } | null
  >(null);

  // Export Canva também é um job na fila — mesmo padrão do deck, um por vez.
  const [exportandoCanva, setExportandoCanva] = useState<
    { postId: string; done: number; total: number } | null
  >(null);

  // Renomear pasta
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renamingFolderName, setRenamingFolderName] = useState('');

  // Mover post para pasta (dropdown explícito no card)
  const [movingPostId, setMovingPostId] = useState<string | null>(null);

  const foldersByParent = useMemo(() => groupByParent(folders), [folders]);

  useEffect(() => {
    if (!slug) return;
    // Fetch folders
    api.get<FolderNode[]>(`/folders/${slug}`).then(data => {
      if (data) setFolders(data);
    }).catch(err => console.warn('Falha ao carregar pastas:', err.message));
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
      const parentId = newFolderParentId;
      const data = await api.post<FolderNode>(`/folders/${slug}`, { name: newFolderName, parentId });
      if (data) {
        setFolders(prev => [data, ...prev]);
        // Sem isto a subpasta nasce escondida dentro de um pai colapsado.
        if (parentId) setExpandedFolders(prev => new Set(prev).add(parentId));
        setNewFolderName('');
        setNewFolderParentId(null);
        setShowFolderModal(false);
      }
    } catch (err) {
      console.error('Failed to create folder:', err);
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleMoveFolder = async (folderId: string, parentId: string | null) => {
    const previous = folders;
    setFolders(prev => prev.map(f => (f.id === folderId ? { ...f, parentId } : f)));
    if (parentId) setExpandedFolders(prev => new Set(prev).add(parentId));
    try {
      await api.patch<FolderNode>(`/folders/${folderId}`, { parentId });
    } catch (err) {
      console.error('Failed to move folder:', err);
      setFolders(previous); // o servidor recusou (ciclo, outra marca): desfaz o otimismo
    }
  };

  const handleMoveToFolder = async (postId: string, folderId: string | null) => {
    try {
      await api.put(`/posts/${postId}`, { folderId });
      // Optimistic update
      if (mutate) mutate();
    } catch (err) {
      console.error('Failed to move post:', err);
    }
  };

  const handleDeletePost = async (postId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Deseja excluir esta arte permanentemente?')) return;
    try {
      await api.delete(`/posts/${postId}`);
      if (mutate) mutate();
      if (activePreviewPost?.id === postId) setActivePreviewPost(null);
    } catch (err) {
      console.error('Failed to delete post:', err);
    }
  };

  const handleDragStart = (postId: string) => {
    setDraggedPostId(postId);
  };

  const handleFolderDragStart = (folderId: string, e: React.DragEvent) => {
    e.stopPropagation();
    setDraggedFolderId(folderId);
  };

  const handleDragOver = (e: React.DragEvent, targetFolderId: string | null) => {
    // Arrastando uma PASTA: o alvo vira o novo pai ('root' = tirar do aninhamento).
    if (draggedFolderId) {
      const dragged = folders.find(f => f.id === draggedFolderId);
      if (!dragged) return;

      if (targetFolderId === 'unassigned') return; // "Sem Pasta" só vale para posts

      if (targetFolderId === 'root') {
        if (!dragged.parentId) return; // já está na raiz
      } else if (targetFolderId) {
        // Soltar uma pasta dentro dela mesma ou de uma descendente destrói a árvore:
        // o ramo perde a raiz e some da tela. O backend também recusa.
        if (collectSubtree(dragged.id, foldersByParent).has(targetFolderId)) return;
        if (dragged.parentId === targetFolderId) return; // já é o pai
      }

      e.preventDefault();
      setDragOverFolderId(targetFolderId);
      return;
    }

    if (!draggedPostId) return;

    const post = posts.find(p => p.id === draggedPostId);
    if (!post) return;

    // Todas as Artes (root) não deve aceitar drop de post, pois é apenas um filtro de visualização
    if (targetFolderId === 'root') return;

    // Não permitir drop em "Sem Pasta" se o post já estiver sem pasta
    if (targetFolderId === 'unassigned' && !post.folderId) return;

    // Não permitir drop na mesma pasta que o post já está
    if (targetFolderId === post.folderId) return;

    e.preventDefault(); // Permite o drop apenas se as condições acima forem atendidas
    setDragOverFolderId(targetFolderId);
  };

  const handleDrop = async (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    if (draggedFolderId) {
      await handleMoveFolder(draggedFolderId, folderId === 'root' ? null : folderId);
    } else if (draggedPostId) {
      await handleMoveToFolder(draggedPostId, folderId === 'unassigned' ? null : folderId);
    }
    setDraggedPostId(null);
    setDraggedFolderId(null);
    setDragOverFolderId(null);
  };

  const handleDeleteFolder = async (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    const removed = collectSubtree(folderId, foldersByParent);
    const subfolderCount = removed.size - 1;
    const message = subfolderCount > 0
      ? `Deseja excluir esta pasta e suas ${subfolderCount} subpasta(s)? As artes não serão deletadas, apenas movidas para a galeria geral.`
      : 'Deseja excluir esta pasta? Os itens não serão deletados, apenas movidos para a galeria geral.';
    if (!confirm(message)) return;

    try {
      await api.delete(`/folders/${folderId}`);
      // O banco apaga a subárvore em cascata; a tela precisa refletir o mesmo.
      setFolders(prev => prev.filter(f => !removed.has(f.id)));
      if (activeFolder && removed.has(activeFolder)) setActiveFolder(null);
      if (mutate) mutate(); // os posts das pastas removidas voltaram para "Sem Pasta"
    } catch (err) {
      console.error('Failed to delete folder:', err);
    }
  };

  /** Desenha a subárvore de `parentId`. A indentação é a única pista de profundidade. */
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
            draggable={canEdit}
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
              aria-label={isExpanded ? 'Recolher subpastas' : 'Expandir subpastas'}
              aria-expanded={hasChildren ? isExpanded : undefined}
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

            {canEdit && renamingFolderId !== folder.id && (
              <>
                <button
                  className={styles.closeBtn}
                  onClick={(e) => { e.stopPropagation(); setRenamingFolderId(folder.id); setRenamingFolderName(folder.name); }}
                  title="Renomear pasta"
                >
                  <Edit3 size={12} />
                </button>
                <button
                  className={styles.closeBtn}
                  onClick={(e) => openFolderModal(folder.id, e)}
                  title="Criar subpasta"
                >
                  <FolderPlus size={12} />
                </button>
                <button
                  className={styles.closeBtn}
                  onClick={(e) => handleDeleteFolder(folder.id, e)}
                  title="Excluir Pasta"
                >
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

  const filteredPosts = posts.filter(post => {
    const matchesFolder = activeFolder === null ? true :
      activeFolder === 'unassigned' ? !post.folderId :
      post.folderId === activeFolder;

    const matchesBundle =
      activeBundle === 'PRESENTATION' ? post.type === 'PRESENTATION' :
      activeBundle === 'DESIGNS' ? (post.type === 'CAROUSEL' || post.type === 'SINGLE_IMAGE') :
      post.type === 'ANIMATION';

    const dimensions = extractDimensions(post.content);
    const ratioTag = getAspectRatioTag(dimensions.width, dimensions.height);
    const matchesFormat = activeFormat === 'all' || ratioTag === activeFormat || ratioTag === 'unknown';

    return matchesFolder && matchesBundle && matchesFormat;
  });


  const handleDownload = (e: React.MouseEvent, url: string, filename: string) => {
    e.preventDefault();
    e.stopPropagation();
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export do deck como arquivo. Antes isto era um laço no navegador: uma requisição
  // por slide (cada uma segurando um render de chromium) e — pior — CAPADO EM 12.
  // Um deck de 30 baixava 12 imagens soltas e não avisava ninguém. Agora é um job na
  // fila que devolve UM arquivo com o deck inteiro.
  const handleDownloadDeck = async (
    e: React.MouseEvent,
    postId: string,
    formato: DeckFileFormat,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (exportando) return;

    setExportando({ postId, formato, done: 0, total: 0 });
    try {
      await exportarDeck(postId, formato, (done, total) =>
        setExportando({ postId, formato, done, total }),
      );
    } catch (err) {
      console.error('[export deck]', err);
      alert(getApiErrorMessage(err, 'Não consegui gerar o arquivo do deck.'));
    } finally {
      setExportando(null);
    }
  };

  const handleGenerateAiReport = () => {
    setIsGeneratingReport(true);
    setShowAiReportModal(true);
    // Simulating AI generation delay
    setTimeout(() => {
      setIsGeneratingReport(false);
    }, 2500);
  };

  const handleExportCanva = async (e: React.MouseEvent, postId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (exportandoCanva) return;

    setExportandoCanva({ postId, done: 0, total: 0 });
    try {
      const { jobId } = await api.post<{ jobId: string; total: number }>(
        `/posts/${postId}/export-canva`,
        {},
      );
      const { acompanharExport } = await import('@/lib/canvaExport');
      await acompanharExport(postId, jobId, (done, total) =>
        setExportandoCanva({ postId, done, total }),
      );
      alert('Exportado para o Canva com sucesso!');
    } catch (err) {
      console.error('[export canva]', err);
      alert(getApiErrorMessage(err, 'Não consegui exportar para o Canva.'));
    } finally {
      setExportandoCanva(null);
    }
  };

  const handleRenameFolder = async (e: React.FormEvent, folderId: string) => {
    e.preventDefault();
    if (!renamingFolderName.trim()) return;
    try {
      const updated = await api.patch<FolderNode>(`/folders/${folderId}`, { name: renamingFolderName.trim() });
      setFolders((prev) => prev.map((f) => (f.id === folderId ? updated : f)));
      setRenamingFolderId(null);
      setRenamingFolderName('');
    } catch (err) {
      console.error('Failed to rename folder:', err);
      alert(getApiErrorMessage(err, 'Não consegui renomear a pasta.'));
    }
  };

  const formatStatus = (status?: string) => {
    switch (status) {
      case 'READY': return 'Pronto';
      case 'GENERATING': return 'Gerando';
      case 'FAILED': return 'Falhou';
      case 'DRAFT': return 'Rascunho';
      default: return status || 'Pronto';
    }
  };

  const itemStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    textAlign: 'left',
    padding: '6px 10px',
    background: active ? 'rgba(79,70,229,0.08)' : 'transparent',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px',
    color: 'inherit',
  });

  return (
    <div>
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
                placeholder="Ex: Conteúdo orgânico"
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

      {activePreviewPost && (() => {
        const preview = extractPreviewSource(activePreviewPost.content, null);
        const imageUrl = activePreviewPost.previewUrl || (preview?.kind === 'image' ? preview.url : null);
        const designPages = preview?.kind === 'design' ? preview.pages : null;
        const htmlContent = preview?.kind === 'html-design' ? preview.content : null;
        const firstPage = designPages?.[0];
        const chatHistory = extractChatHistory(activePreviewPost.content);
        const sessionId = extractSessionId(activePreviewPost.content);

        // Calcular proporção real das páginas
        const contentWidth = htmlContent?.width
          || (preview?.kind === 'design' ? preview.width : null)
          || 1080;
        const contentHeight = htmlContent?.height
          || (preview?.kind === 'design' ? preview.height : null)
          || 1080;
        const aspectRatio = `${contentWidth} / ${contentHeight}`;

        return (
          <div className={styles.adobeModalOverlay} onClick={() => setActivePreviewPost(null)}>
            <div className={styles.adobeModalContainer} onClick={(e) => e.stopPropagation()}>
              
              {/* Lado Esquerdo: Área de Preview (Fundo Escuro) */}
              <div className={styles.adobePreviewArea}>
                <button className={styles.adobeCloseBtn} onClick={() => setActivePreviewPost(null)}>
                  <X size={20} />
                </button>
                
                <div className={styles.adobePreviewWrapper}>
                  {imageUrl ? (
                    <div className={styles.adobePreviewSlideContainer}>
                      <div className={styles.adobePreviewSlideHeader}>Imagem Final</div>
                      <div className={styles.adobePreviewSlideContent} style={{ aspectRatio }}>
                        <img
                          src={imageUrl}
                          alt="Preview"
                          className={styles.adobePreviewImage}
                        />
                      </div>
                    </div>
                  ) : htmlContent ? (
                    htmlContent.slides.map((slide: any, idx: number) => (
                      <div key={idx} className={styles.adobePreviewSlideContainer}>
                        <div className={styles.adobePreviewSlideHeader}>
                          Slide {idx + 1}
                        </div>
                        <div className={styles.adobePreviewSlideContent} style={{ aspectRatio }}>
                          <HtmlSlideRenderer
                            content={{ ...htmlContent, slides: [slide] }}
                            mode="contain"
                            hideNav
                          />
                        </div>
                      </div>
                    ))
                  ) : designPages ? (
                    designPages.map((page: any, idx: number) => (
                      <div key={page.id || idx} className={styles.adobePreviewSlideContainer}>
                        <div className={styles.adobePreviewSlideHeader}>
                          Slide {idx + 1} {page.name ? `— ${page.name}` : ''}
                        </div>
                        <div className={styles.adobePreviewSlideContent} style={{ aspectRatio }}>
                          <DesignRenderer
                            pages={[page]}
                            canvasWidth={(preview?.kind === 'design' ? preview.width : null) ?? 1080}
                            canvasHeight={(preview?.kind === 'design' ? preview.height : null) ?? 1080}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: 'var(--color-text-tertiary)' }}>Sem preview disponível</div>
                  )}
                </div>
              </div>

              {/* Lado Direito: Barra de Configurações e Propriedades (Adobe-like) */}
              <div className={styles.adobePanelArea}>
                <div className={styles.adobePanelHeader}>
                  <div className={styles.adobeMetaBadge}>
                    {formatPostType(activePreviewPost.type)}
                  </div>
                  <h3 className={styles.adobePostTitle}>
                    {activePreviewPost.name || `Arte ${activePreviewPost.id.split('-')[0]}`}
                  </h3>
                  <div className={styles.adobePanelMeta}>
                    <span>Criado em: {new Date(activePreviewPost.createdAt).toLocaleDateString()}</span>
                    <span>ID: {activePreviewPost.id.split('-')[0]}</span>
                    {activePreviewPost.createdBy && (
                      <span title={activePreviewPost.createdBy.email}>
                        Por: {activePreviewPost.createdBy.name}
                      </span>
                    )}
                  </div>
                </div>

                <div className={styles.adobePanelBody}>
                  {/* Seção: Ações Rápidas */}
                  {(htmlContent || (designPages && designPages.length > 0)) && canEdit && (
                    <div className={styles.adobePanelSection}>
                      <h4 className={styles.adobeSectionTitle}>Editar</h4>
                      <Link
                        href={`/${slug}/editor/${activePreviewPost.id}`}
                        className={styles.adobeMainActionBtn}
                        onClick={() => setActivePreviewPost(null)}
                      >
                        <PenLine size={16} />
                        Abrir no Editor
                      </Link>
                    </div>
                  )}

                  {/* Seção: Exportar / Downloads */}
                  <div className={styles.adobePanelSection}>
                    <h4 className={styles.adobeSectionTitle}>Exportar e Downloads</h4>
                    <div className={styles.adobeBtnGrid}>
                      {imageUrl && (
                        <button
                          className={styles.adobeSecondaryBtn}
                          onClick={(e) => handleDownload(e, imageUrl, `post-${activePreviewPost.id}.png`)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <LucideImage size={14} style={{ opacity: 0.7 }} />
                            <span>Baixar Imagem (PNG)</span>
                          </div>
                          <Download size={14} style={{ opacity: 0.5 }} />
                        </button>
                      )}
                      
                      {(htmlContent || (designPages && designPages.length > 0)) && (
                        <>
                          <button
                            className={styles.adobeSecondaryBtn}
                            onClick={(e) => handleDownloadDeck(e, activePreviewPost.id, 'pptx')}
                            disabled={exportando !== null}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <Presentation size={14} style={{ opacity: 0.7 }} />
                              <span>Apresentação (PPTX)</span>
                            </div>
                            {exportando?.postId === activePreviewPost.id && exportando.formato === 'pptx' ? (
                              <Loader2 size={14} className={styles.spin} />
                            ) : (
                              <Download size={14} style={{ opacity: 0.5 }} />
                            )}
                          </button>
                          <button
                            className={styles.adobeSecondaryBtn}
                            onClick={(e) => handleDownloadDeck(e, activePreviewPost.id, 'pdf')}
                            disabled={exportando !== null}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <FileDown size={14} style={{ opacity: 0.7 }} />
                              <span>Documento (PDF)</span>
                            </div>
                            {exportando?.postId === activePreviewPost.id && exportando.formato === 'pdf' ? (
                              <Loader2 size={14} className={styles.spin} />
                            ) : (
                              <Download size={14} style={{ opacity: 0.5 }} />
                            )}
                          </button>
                          <button
                            className={styles.adobeSecondaryBtn}
                            onClick={(e) => handleDownloadDeck(e, activePreviewPost.id, 'zip')}
                            disabled={exportando !== null}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <Folder size={14} style={{ opacity: 0.7 }} />
                              <span>Imagens Separadas (ZIP)</span>
                            </div>
                            {exportando?.postId === activePreviewPost.id && exportando.formato === 'zip' ? (
                              <Loader2 size={14} className={styles.spin} />
                            ) : (
                              <Download size={14} style={{ opacity: 0.5 }} />
                            )}
                          </button>
                          {htmlContent && (
                            <button
                              className={styles.adobeSecondaryBtn}
                              onClick={(e) => handleDownloadDeck(e, activePreviewPost.id, 'html')}
                              disabled={exportando !== null}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <FileDown size={14} style={{ opacity: 0.7 }} />
                                <span>Código Fonte (HTML)</span>
                              </div>
                              {exportando?.postId === activePreviewPost.id && exportando.formato === 'html' ? (
                                <Loader2 size={14} className={styles.spin} />
                              ) : (
                                <Download size={14} style={{ opacity: 0.5 }} />
                              )}
                            </button>
                          )}
                          <button
                            className={styles.adobeSecondaryBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveCanvaExportPost(activePreviewPost);
                              setCanvaFormat('png');
                              setMostrarCanvaInstrucoes(false);
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <Send size={14} style={{ opacity: 0.7 }} />
                              <span>Exportar para o Canva</span>
                            </div>
                            <ExternalLink size={14} style={{ opacity: 0.5 }} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Seção: Organização e Pastas */}
                  {canEdit && (
                    <div className={styles.adobePanelSection}>
                      <h4 className={styles.adobeSectionTitle}>Organizar</h4>
                      <div className={styles.adobeFolderRow}>
                        <span className={styles.adobeLabel}>Pasta destino:</span>
                        <select 
                          className={styles.folderSelect}
                          value={activePreviewPost.folderId || ''}
                          onChange={(e) => handleMoveToFolder(activePreviewPost.id, e.target.value || null)}
                        >
                          <option value="">Sem Pasta</option>
                          {folders.map(f => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Seção: Histórico de Conversa com IA */}
                  {chatHistory.length > 0 && (
                    <div className={styles.adobePanelSection}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <h4 className={styles.adobeSectionTitle} style={{ margin: 0 }}>Histórico</h4>
                        {sessionId && (
                          <Link
                            href={`/${slug}/fabrica?sessionId=${encodeURIComponent(sessionId)}`}
                            className={styles.adobeInlineLink}
                            onClick={() => setActivePreviewPost(null)}
                          >
                            <ExternalLink size={12} />
                            Continuar chat
                          </Link>
                        )}
                      </div>
                      <div className={styles.adobeChatHistoryList}>
                        {chatHistory.map((message, index) => (
                          <div key={index} className={styles.adobeChatItem}>
                            <span className={styles.adobeChatItemRole} data-role={message.role}>{message.role}</span>
                            <p className={styles.adobeChatItemText}>{message.content}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Seção: Perigo */}
                  {canEdit && (
                    <div className={styles.adobePanelSection} style={{ marginTop: 'auto', borderTop: '1px solid rgba(0, 0, 0, 0.08)', paddingTop: '16px' }}>
                      <button
                        className={styles.adobeDangerBtn}
                        onClick={(e) => {
                          handleDeletePost(activePreviewPost.id, e);
                        }}
                      >
                        <Trash2 size={14} />
                        Excluir Arte
                      </button>
                    </div>
                  )}

                </div>
              </div>

            </div>
          </div>
        );
      })()}

      {activeCanvaExportPost && (() => {
        const preview = extractPreviewSource(activeCanvaExportPost.content, null);
        const imageUrl = activeCanvaExportPost.previewUrl || (preview?.kind === 'image' ? preview.url : null);
        const designPages = preview?.kind === 'design' ? preview.pages : null;
        const htmlContent = preview?.kind === 'html-design' ? preview.content : null;

        // Calcular proporção real das páginas
        const contentWidth = htmlContent?.width
          || (preview?.kind === 'design' ? preview.width : null)
          || 1080;
        const contentHeight = htmlContent?.height
          || (preview?.kind === 'design' ? preview.height : null)
          || 1080;
        const aspectRatio = `${contentWidth} / ${contentHeight}`;

        const isRunningExport = exportandoCanva?.postId === activeCanvaExportPost.id
          || (exportando?.postId === activeCanvaExportPost.id && (exportando.formato === 'pptx' || exportando.formato === 'html'));

        const handleExecutarCanvaExport = async (e: React.MouseEvent) => {
          e.preventDefault();
          if (canvaFormat === 'png') {
            await handleExportCanva(e, activeCanvaExportPost.id);
          } else {
            setMostrarCanvaInstrucoes(false);
            try {
              await exportarDeck(
                activeCanvaExportPost.id, 
                canvaFormat, 
                (done, total) => setExportando({ postId: activeCanvaExportPost.id, formato: canvaFormat, done, total }),
                {}
              );
              setMostrarCanvaInstrucoes(true);
            } catch (err) {
              console.error(err);
              alert('Não consegui exportar o arquivo.');
            } finally {
              setExportando(null);
            }
          }
        };

        return (
          <div className={styles.canvaModalOverlay} onClick={() => { if (!isRunningExport) setActiveCanvaExportPost(null); }}>
            <div className={styles.canvaModalContainer} onClick={(e) => e.stopPropagation()}>
              
              {/* Lado Esquerdo: Área de Preview (Fundo Escuro com Scroll) */}
              <div className={styles.adobePreviewArea}>
                <button className={styles.adobeCloseBtn} onClick={() => { if (!isRunningExport) setActiveCanvaExportPost(null); }}>
                  <X size={20} />
                </button>
                
                <div className={styles.adobePreviewWrapper}>
                  {imageUrl ? (
                    <div className={styles.adobePreviewSlideContainer}>
                      <div className={styles.adobePreviewSlideHeader}>Imagem Final</div>
                      <div className={styles.adobePreviewSlideContent} style={{ aspectRatio }}>
                        <img src={imageUrl} alt="Preview" className={styles.adobePreviewImage} />
                      </div>
                    </div>
                  ) : htmlContent ? (
                    htmlContent.slides.map((slide: any, idx: number) => (
                      <div key={idx} className={styles.adobePreviewSlideContainer}>
                        <div className={styles.adobePreviewSlideHeader}>Slide {idx + 1}</div>
                        <div className={styles.adobePreviewSlideContent} style={{ aspectRatio }}>
                          <HtmlSlideRenderer content={{ ...htmlContent, slides: [slide] }} mode="contain" hideNav />
                        </div>
                      </div>
                    ))
                  ) : designPages ? (
                    designPages.map((page: any, idx: number) => (
                      <div key={page.id || idx} className={styles.adobePreviewSlideContainer}>
                        <div className={styles.adobePreviewSlideHeader}>Slide {idx + 1} {page.name ? `— ${page.name}` : ''}</div>
                        <div className={styles.adobePreviewSlideContent} style={{ aspectRatio }}>
                          <DesignRenderer
                            pages={[page]}
                            canvasWidth={(preview?.kind === 'design' ? preview.width : null) ?? 1080}
                            canvasHeight={(preview?.kind === 'design' ? preview.height : null) ?? 1080}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: 'var(--color-text-tertiary)' }}>Sem preview disponível</div>
                  )}
                </div>
              </div>

              {/* Lado Direito: Opções de Exportação Canva */}
              <div className={styles.adobePanelArea} style={{ width: '420px' }}>
                <div className={styles.adobePanelHeader}>
                  <div className={styles.adobeMetaBadge}>Canva Connect</div>
                  <h3 className={styles.adobePostTitle}>Exportar / Baixar Design</h3>
                  <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: '4px 0 0 0' }}>
                    Envie a arte para o Canva ou baixe o arquivo para editar localmente.
                  </p>
                </div>

                <div className={styles.adobePanelBody}>
                  <div className={styles.adobePanelSection}>
                    <h4 className={styles.adobeSectionTitle}>Enviar para o Canva</h4>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {/* PNG Card */}
                      <div 
                        className={styles.canvaFormatCard}
                        data-selected={canvaFormat === 'png'}
                        onClick={() => { if (!isRunningExport) { setCanvaFormat('png'); setMostrarCanvaInstrucoes(false); } }}
                      >
                        <input 
                          type="radio" 
                          className={styles.canvaFormatCardRadio} 
                          checked={canvaFormat === 'png'}
                          onChange={() => {}}
                          disabled={isRunningExport}
                        />
                        <div>
                          <div className={styles.canvaFormatCardTitle}>Imagem PNG (Automático)</div>
                          <div className={styles.canvaFormatCardDesc}>
                            Envia os slides renderizados como imagens de alta resolução direto para a sua conta do Canva, unidos num design multipágina.
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {(htmlContent || (designPages && designPages.length > 0)) && (
                    <div className={styles.adobePanelSection} style={{ marginTop: '16px' }}>
                      <h4 className={styles.adobeSectionTitle}>Baixar arquivo</h4>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {/* PPTX Card */}
                        {(htmlContent || (designPages && designPages.length > 0)) && (
                          <div 
                            className={styles.canvaFormatCard}
                            data-selected={canvaFormat === 'pptx'}
                            onClick={() => { if (!isRunningExport) { setCanvaFormat('pptx'); setMostrarCanvaInstrucoes(false); } }}
                          >
                            <input 
                              type="radio" 
                              className={styles.canvaFormatCardRadio} 
                              checked={canvaFormat === 'pptx'}
                              onChange={() => {}}
                              disabled={isRunningExport}
                            />
                            <div>
                              <div className={styles.canvaFormatCardTitle}>Apresentação PPTX (Editável)</div>
                              <div className={styles.canvaFormatCardDesc}>
                                Baixa um arquivo PowerPoint com texto e formas editáveis. Você pode importá-lo manualmente no Canva depois.
                              </div>
                            </div>
                          </div>
                        )}

                        {/* HTML Card */}
                        {htmlContent && (
                          <div 
                            className={styles.canvaFormatCard}
                            data-selected={canvaFormat === 'html'}
                            onClick={() => { if (!isRunningExport) { setCanvaFormat('html'); setMostrarCanvaInstrucoes(false); } }}
                          >
                            <input 
                              type="radio" 
                              className={styles.canvaFormatCardRadio} 
                              checked={canvaFormat === 'html'}
                              onChange={() => {}}
                              disabled={isRunningExport}
                            />
                            <div>
                              <div className={styles.canvaFormatCardTitle}>Código Fonte HTML (Editável)</div>
                              <div className={styles.canvaFormatCardDesc}>
                                Baixa um ZIP com os arquivos HTML/CSS dos slides. Útil para desenvolvedores ou importação manual em outras ferramentas.
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Progresso ou Instruções */}
                  {isRunningExport && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', backgroundColor: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600 }}>
                        <Loader2 size={16} className={styles.spin} />
                        <span>Gerando arquivos e exportando...</span>
                      </div>
                      {exportando && (
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                          Processado: {exportando.done} de {exportando.total} slides
                        </div>
                      )}
                      {exportandoCanva && (
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                          Enviado: {exportandoCanva.done} de {exportandoCanva.total} slides para o Canva
                        </div>
                      )}
                    </div>
                  )}

                  {mostrarCanvaInstrucoes && (canvaFormat === 'pptx' || canvaFormat === 'html') && (
                    <div className={styles.canvaInstructionBox}>
                      <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>✓</span> O arquivo foi gerado com sucesso!
                      </div>
                      <div>
                        Para importá-lo no Canva de forma 100% editável:
                        <ol style={{ margin: '8px 0 0 16px', padding: 0 }}>
                          <li>Abra a tela inicial do seu Canva.</li>
                          <li>Clique em <strong>Criar um design</strong> e depois em <strong>Importar arquivo</strong>.</li>
                          <li>Selecione o arquivo ZIP/PPTX que você acabou de baixar e pronto!</li>
                        </ol>
                      </div>
                    </div>
                  )}

                  <div style={{ marginTop: 'auto', display: 'flex', gap: '12px' }}>
                    <button
                      className={styles.adobeDangerBtn}
                      style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                      onClick={() => setActiveCanvaExportPost(null)}
                      disabled={isRunningExport}
                    >
                      Cancelar
                    </button>
                    <button
                      className={styles.adobeMainActionBtn}
                      onClick={handleExecutarCanvaExport}
                      disabled={isRunningExport}
                    >
                      {isRunningExport
                        ? 'Processando...'
                        : canvaFormat === 'png'
                          ? 'Exportar para o Canva'
                          : 'Baixar arquivo'}
                    </button>
                  </div>
                </div>

              </div>

            </div>
          </div>
        );
      })()}

      {chatHistoryPreview && (
        <div className={styles.modalOverlay} onClick={() => setChatHistoryPreview(null)}>
          <div className={styles.chatHistoryModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h3 className={styles.modalTitle}>Histórico da conversa</h3>
                <p className={styles.chatHistorySubtitle}>{chatHistoryPreview.postLabel}</p>
              </div>
              <button className={styles.closeBtn} onClick={() => setChatHistoryPreview(null)}>
                <X size={20} />
              </button>
            </div>
            <div className={styles.chatHistoryMetaRow}>
              <span className={styles.chatSessionBadge}>Sessão: {chatHistoryPreview.sessionId ?? 'não registrada'}</span>
              {chatHistoryPreview.sessionId && (
                <Link href={`/${slug}/fabrica?sessionId=${encodeURIComponent(chatHistoryPreview.sessionId)}`} className={styles.chatSessionLink}>
                  <ExternalLink size={14} />
                  Abrir sessão
                </Link>
              )}
            </div>
            <div className={styles.chatHistoryBody}>
              {chatHistoryPreview.messages.length === 0 ? (
                <div className={styles.empty}>Nenhuma mensagem foi salva neste design.</div>
              ) : (
                chatHistoryPreview.messages.map((message, index) => (
                  <div key={`${message.timestamp}-${index}`} className={`${styles.chatBubble} ${styles[`chatBubble${message.role.charAt(0).toUpperCase()}${message.role.slice(1)}` as keyof typeof styles]}`}>
                    <div className={styles.chatBubbleMeta}>
                      <span className={styles.chatBubbleRole}>{message.role}</span>
                      <span className={styles.chatBubbleTime}>{formatChatTimestamp(message.timestamp)}</span>
                    </div>
                    <p className={styles.chatBubbleContent}>{message.content}</p>
                    {message.attachments && message.attachments.length > 0 && (
                      <div className={styles.chatAttachmentsList}>
                        {message.attachments.map((attachment, attachmentIndex) => (
                          <span key={`${attachment.name}-${attachmentIndex}`} className={styles.chatAttachmentPill}>
                            {formatAttachmentLabel(attachment.name, attachment.mimeType)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {showAiReportModal && (
        <div className={styles.modalOverlay} onClick={() => setShowAiReportModal(false)}>
          <div className={styles.aiReportModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.aiReportHeader}>
                <h3 className={styles.aiReportTitle}>
                  <Sparkles size={24} style={{ color: 'var(--color-brand)' }} />
                  Relatório de Direção de Arte
                </h3>
                <span className={styles.aiReportSubtitle}>
                  Análise da pasta <strong>{activeFolder ? folders.find(f => f.id === activeFolder)?.name : 'Todas as Artes'}</strong> gerada por Inteligência Artificial
                </span>
              </div>
              <button className={styles.closeBtn} onClick={() => setShowAiReportModal(false)} style={{ alignSelf: 'flex-start' }}>
                <X size={20} />
              </button>
            </div>

            <div className={styles.aiReportContent}>
              {isGeneratingReport ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)', padding: 'var(--space-8) 0', color: 'var(--color-text-secondary)' }}>
                  <Sparkles size={32} className={styles.sparkleIcon} style={{ color: 'var(--color-brand)' }} />
                  <p>A Inteligência Artificial está analisando os criativos e os passos de decisão...</p>
                </div>
              ) : (
                <>
                  <div className={styles.aiReportSection}>
                    <h4>Contexto e Tom de Voz</h4>
                    <p>Esta coleção demonstra uma abordagem visual voltada para a autoridade e clareza. Os criativos utilizam predominantemente layouts de alto contraste (Texto | Imagem) que favorecem a leitura rápida e a retenção da mensagem. A paleta de cores sugere um posicionamento premium e direto.</p>
                  </div>
                  
                  <div className={styles.aiReportSection}>
                    <h4>Padrões Identificados</h4>
                    <ul>
                      <li><strong>Estrutura de Carrossel:</strong> A maioria das apresentações segue a estrutura &ldquo;Problema → Solução → Call to Action&rdquo;, mantendo o usuário engajado até o último slide.</li>
                      <li><strong>Densidade de Texto:</strong> Os slides estão configurados com densidade &ldquo;Breve&rdquo;, o que é ideal para o Instagram e LinkedIn, garantindo que o visual não fique sobrecarregado.</li>
                      <li><strong>Uso de Imagens:</strong> Imagens de referência são frequentemente usadas no lado direito, criando uma âncora visual enquanto o texto à esquerda conduz a narrativa.</li>
                    </ul>
                  </div>

                  <div className={styles.aiReportSection}>
                    <h4>Sugestões da IA para os Próximos Passos</h4>
                    <ul>
                      <li>Experimente alternar para o layout &ldquo;Citação&rdquo; no meio dos carrosséis para quebrar o ritmo e dar destaque a uma frase de efeito.</li>
                      <li>Para os posts únicos (Single Image), teste abordagens com a densidade &ldquo;Média&rdquo; caso precise explicar conceitos um pouco mais complexos na mesma imagem.</li>
                      <li>Considere criar uma pasta separada apenas para &ldquo;Templates Testados&rdquo; para manter os melhores desempenhos isolados para reutilização futura.</li>
                    </ul>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <Link href="/galeria" className={styles.backLink}>
        <ArrowLeft size={16} />
        Voltar
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <PageHeader
          title={marca}
          description="Histórico de artes e criativos gerados para esta marca."
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <Link href={`/${slug}/fabrica`}>
            <Button size="sm">
              <Sparkles size={14} />
              Nova Arte
            </Button>
          </Link>
          <div className={styles.viewToggle}>
          <AiSpendBadge slug={slug} />
          {brand?.members && (
            <div className={styles.teamAvatars}>
              {brand.members.slice(0, 3).map(m => (
                <div key={m.user.id} className={styles.avatar} title={`${m.user.name} (${m.role})`}>
                  {m.user.name.charAt(0).toUpperCase()}
                </div>
              ))}
              {brand.members.length > 3 && (
                <div className={styles.avatarMore}>+{brand.members.length - 3}</div>
              )}
              <Link href={`/${slug}/configuracoes/equipe`} className={styles.inviteBtn} title="Convidar para a Equipe">
                <Plus size={14} />
              </Link>
            </div>
          )}
          
          <button 
            className={`${styles.toggleBtn} ${viewMode === 'list' ? styles.toggleBtnActive : ''}`}
            onClick={() => setViewMode('list')}
            title="Visualização em Lista"
          >
            <List size={18} />
          </button>
          <button 
            className={`${styles.toggleBtn} ${viewMode === 'grid' ? styles.toggleBtnActive : ''}`}
            onClick={() => setViewMode('grid')}
            title="Visualização em Grade"
          >
            <LayoutGrid size={18} />
          </button>
        </div>
        </div>
      </div>

      <div className={styles.foldersContainer}>
        <div className={styles.foldersHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            <h3 className={styles.foldersTitle} style={{ fontFamily: 'var(--font-serif)', fontSize: '20px', textTransform: 'none', color: 'var(--color-text)', letterSpacing: 'normal' }}>Pastas do Projeto</h3>
            <button 
              className={styles.aiReportBtn} 
              title="Gerar relatório de estilo desta pasta com Inteligência Artificial"
              onClick={handleGenerateAiReport}
            >
              <Sparkles size={14} className={styles.sparkleIcon} />
              Analisar com IA
            </button>
          </div>
          <Button size="sm" onClick={() => openFolderModal(null)} disabled={!canEdit} title={canEdit ? undefined : hint}>
            <Plus size={14} />
            Criar Pasta
          </Button>
        </div>

        <div className={styles.bundleTabs}>
          <button
            type="button"
            className={`${styles.bundleTab} ${activeBundle === 'PRESENTATION' ? styles.bundleTabActive : ''}`}
            onClick={() => setActiveBundle('PRESENTATION')}
          >
            <Presentation size={16} />
            Apresentações
          </button>
          <button
            type="button"
            className={`${styles.bundleTab} ${activeBundle === 'DESIGNS' ? styles.bundleTabActive : ''}`}
            onClick={() => setActiveBundle('DESIGNS')}
          >
            <LayoutGrid size={16} />
            Designs
          </button>
          <button
            type="button"
            className={`${styles.bundleTab} ${activeBundle === 'ANIMATION' ? styles.bundleTabActive : ''}`}
            onClick={() => setActiveBundle('ANIMATION')}
          >
            <Sparkles size={16} />
            Animações
          </button>
        </div>

        {activeBundle === 'DESIGNS' && (
          <div className={styles.formatFilters}>
            {(['all', '1:1', '3:4', '4:5', '16:9', '9:16'] as const).map((fmt) => (
              <button
                key={fmt}
                type="button"
                className={`${styles.formatChip} ${activeFormat === fmt ? styles.formatChipActive : ''}`}
                onClick={() => setActiveFormat(fmt)}
              >
                {fmt === 'all' ? 'Todos' :
                 fmt === '1:1' ? '1:1 · Quadrado' :
                 fmt === '3:4' ? '3:4 · Retrato' :
                 fmt === '4:5' ? '4:5 · iPhone' :
                 fmt === '16:9' ? '16:9 · Paisagem' :
                 '9:16 · Story'}
              </button>
            ))}
          </div>
        )}

        <div className={styles.foldersGrid}>
          <div
            className={`${styles.folderCard} ${activeFolder === null ? styles.folderCardActive : ''} ${dragOverFolderId === 'root' ? styles.folderCardDragOver : ''}`}
            onClick={() => setActiveFolder(null)}
            onDragOver={(e) => handleDragOver(e, 'root')}
            onDragLeave={() => setDragOverFolderId(null)}
            onDrop={(e) => handleDrop(e, 'root')}
            title="Arraste uma pasta para cá para tirá-la de dentro de outra"
          >
            <Folder size={16} />
            <span className={styles.folderName}>Todas as Artes</span>
          </div>
          <div
            className={`${styles.folderCard} ${activeFolder === 'unassigned' ? styles.folderCardActive : ''} ${dragOverFolderId === 'unassigned' ? styles.folderCardDragOver : ''}`}
            onClick={() => setActiveFolder('unassigned')}
            onDragOver={(e) => handleDragOver(e, 'unassigned')}
            onDragLeave={() => setDragOverFolderId(null)}
            onDrop={(e) => handleDrop(e, 'unassigned')}
          >
            <Folder size={16} />
            <span className={styles.folderName}>Sem Pasta</span>
          </div>
        </div>

        <div className={styles.folderTree}>
          {renderFolderTree(null, 0)}
        </div>
      </div>

      {loading ? (
        <p>Carregando galeria...</p>
      ) : error ? (
        <p className={styles.error}>Erro ao carregar: {error}</p>
      ) : posts.length === 0 ? (
        <div className={styles.empty}>Nenhum post gerado ainda. Vá até a Fábrica para criar!</div>
      ) : filteredPosts.length === 0 ? (
        <div className={styles.empty}>Nenhuma arte encontrada nesta pasta.</div>
      ) : viewMode === 'grid' ? (
        <div className={`${styles.grid} ${activeBundle === 'PRESENTATION' ? styles.gridPresentations : activeBundle === 'DESIGNS' ? styles.gridDesigns : styles.gridAnimations}`}>
          {filteredPosts.map((post, index) => {
            const preview = extractPreviewSource(post.content, null);
            const imageUrl = post.previewUrl || (preview?.kind === 'image' ? preview.url : null);
            const designPages = preview?.kind === 'design' ? preview.pages : null;
            const htmlContent = preview?.kind === 'html-design' ? preview.content : null;
            const firstPage = designPages?.[0];

            return (
              <div
                key={post.id}
                className={`${styles.postCard} ${draggedPostId === post.id ? styles.postCardDragging : ''}`}
                draggable
                onDragStart={() => handleDragStart(post.id)}
                onDragEnd={() => setDraggedPostId(null)}
              >
                  <div 
                    className={`${styles.postThumb} ${activeBundle === 'PRESENTATION' ? styles.postThumbPresentation : activeBundle === 'DESIGNS' ? styles.postThumbDesign : ''}`}
                    onClick={() => setActivePreviewPost(post)}
                  >
                    <div className={styles.thumbOverlay}>
                      <span className={styles.hoverText}>Visualizar</span>
                    </div>

                    {imageUrl ? (
                      <Image
                        src={imageUrl}
                        alt="Post thumbnail"
                        fill
                        className={styles.thumbImage}
                        sizes="260px"
                        unoptimized
                        priority={index < 4}
                      />
                    ) : htmlContent ? (
                      <div className={styles.thumbDesign}>
                        <HtmlSlideRenderer content={htmlContent} mode="cover" hideNav />
                      </div>
                    ) : (designPages && firstPage) ? (
                      <div className={styles.thumbDesign}>
                        <DesignRenderer
                          pages={[firstPage]}
                          canvasWidth={firstPage.width ?? 1080}
                          canvasHeight={firstPage.height ?? 1080}
                          hideNav
                          mode="cover"
                        />
                      </div>
                    ) : (
                      <div className={styles.thumbEmpty}>
                        <span style={{ color: 'var(--color-text-tertiary)', fontSize: '12px' }}>Sem preview</span>
                      </div>
                    )}
                    {(htmlContent || designPages) && (
                      <span className={styles.slideCount}>
                        {htmlContent ? htmlContent.slides.length : designPages?.length} slides
                      </span>
                    )}
                  </div>
                  
                  <div className={styles.postBody}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}>
                      {renamingPostId === post.id ? (
                        <form onSubmit={(e) => handleRenamePost(e, post.id)} style={{ width: '100%' }} onClick={(e) => e.stopPropagation()}>
                          <input 
                            type="text" 
                            value={newPostName} 
                            onChange={(e) => setNewPostName(e.target.value)} 
                            autoFocus 
                            style={{ width: '100%', padding: '4px', fontSize: '14px', borderRadius: '4px', border: '1px solid var(--color-border)' }}
                            onBlur={() => setRenamingPostId(null)}
                          />
                        </form>
                      ) : (
                        <h4 className={styles.postTitle} style={{ margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                          <span>{post.name || `Arte ${post.id.split('-')[0]}`}</span>
                          <button 
                            onClick={(e) => { e.stopPropagation(); setRenamingPostId(post.id); setNewPostName(post.name || ''); }} 
                            style={{ background: 'none', border: 'none', color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: 0 }}
                            title="Renomear"
                          >
                            <Edit3 size={12} />
                          </button>
                        </h4>
                      )}
                      <span className={styles.postDate}>{new Date(post.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={styles.list}>
          {filteredPosts.map((post, index) => {
            const preview = extractPreviewSource(post.content, null);
            const imageUrl = post.previewUrl || (preview?.kind === 'image' ? preview.url : null);
            const designPages = preview?.kind === 'design' ? preview.pages : null;
            const htmlContent = preview?.kind === 'html-design' ? preview.content : null;
            const firstPage = designPages?.[0];
            const chatHistory = extractChatHistory(post.content);
            const sessionId = extractSessionId(post.content);

            return (
              <div
                key={post.id}
                className={`${styles.listItem} ${draggedPostId === post.id ? styles.postCardDragging : ''}`}
                draggable
                onDragStart={() => handleDragStart(post.id)}
                onDragEnd={() => setDraggedPostId(null)}
              >
                <div className={styles.listInfo}>
                  <div className={styles.listThumb}>
                    {imageUrl ? (
                      <div
                        className={styles.thumbDesign}
                        style={{ cursor: 'pointer', width: '100%', height: '100%' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActivePreviewPost(post);
                        }}
                      >
                        <Image
                          src={imageUrl}
                          alt="Post thumbnail"
                          fill
                          className={styles.thumbImage}
                          sizes="64px"
                          unoptimized
                          priority={index < 6}
                        />
                      </div>
                    ) : htmlContent ? (
                      <div
                        className={styles.thumbDesign}
                        style={{ cursor: 'pointer' }}
                        onClick={(e) => { e.stopPropagation(); setActivePreviewPost(post); }}
                      >
                        <HtmlSlideRenderer content={htmlContent} mode="cover" hideNav />
                      </div>
                    ) : designPages && firstPage ? (
                      <div
                        className={styles.thumbDesign}
                        style={{ backgroundColor: firstPage.backgroundColor ?? '#111', cursor: 'pointer' }}
                        onClick={(e) => { e.stopPropagation(); setActivePreviewPost(post); }}
                      >
                        <DesignRenderer
                          pages={[firstPage]}
                          canvasWidth={firstPage.width ?? 1080}
                          canvasHeight={firstPage.height ?? 1080}
                          hideNav
                          mode="cover"
                        />
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', color: 'var(--color-text-tertiary)', backgroundColor: 'var(--color-bg-secondary)' }}>
                        <LayoutGrid size={20} />
                      </div>
                    )}
                  </div>
                  <div className={styles.listDetails}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {renamingPostId === post.id ? (
                        <form onSubmit={(e) => handleRenamePost(e, post.id)}>
                          <input 
                            type="text" 
                            value={newPostName} 
                            onChange={(e) => setNewPostName(e.target.value)} 
                            autoFocus 
                            style={{ padding: '4px', fontSize: '14px', borderRadius: '4px', border: '1px solid var(--color-border)' }}
                            onBlur={() => setRenamingPostId(null)}
                          />
                        </form>
                      ) : (
                        <span style={{ fontWeight: 500, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {post.name || `Arte ${post.id.split('-')[0]}`}
                          <button onClick={(e) => { e.stopPropagation(); setRenamingPostId(post.id); setNewPostName(post.name || ''); }} style={{ background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', padding: 0 }}>
                            <Edit3 size={14} />
                          </button>
                        </span>
                      )}
                      <div className={styles.listMeta}>
                        <span>{formatPostType(post.type)}</span>
                        <span>•</span>
                        <span>{new Date(post.createdAt).toLocaleDateString()}</span>
                        <span>•</span>
                        <span
                          className={styles.postStatus}
                          data-status={post.status || 'READY'}
                          style={{ position: 'static', background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}
                        >
                          {formatStatus(post.status)}
                        </span>
                        {post.createdBy && (
                          <>
                            <span>•</span>
                            <span title={post.createdBy.email}>👤 {post.createdBy.name.split(' ')[0]}</span>
                          </>
                        )}
                        {designPages && (
                          <>
                            <span>•</span>
                            <span>{designPages.length} slides</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.listActions}>
                  {imageUrl && (
                    <>
                      <button
                        className={styles.actionBtn}
                        onClick={(e) => { e.stopPropagation(); setActivePreviewPost(post); }}
                        title="Visualizar"
                      >
                        <Maximize2 size={16} />
                      </button>
                      <button
                        className={styles.actionBtn}
                        onClick={(e) => handleDownload(e, imageUrl, `post-${post.id}.png`)}
                        title="Baixar imagem"
                      >
                        <Download size={16} />
                      </button>
                    </>
                  )}
                  {htmlContent && canEdit && (
                    <Link
                      href={`/${slug}/editor/${post.id}`}
                      className={styles.actionBtn}
                      title="Abrir no Editor"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <PenLine size={16} />
                    </Link>
                  )}
                  {htmlContent && (
                    <button
                      className={styles.actionBtn}
                      onClick={(e) => handleExportCanva(e, post.id)}
                      disabled={exportandoCanva !== null}
                      title="Exportar / Baixar design"
                    >
                      {exportandoCanva?.postId === post.id
                        ? <Loader2 size={16} className={styles.spin} />
                        : <Send size={16} />}
                    </button>
                  )}
                  {designPages && firstPage && (
                     <button
                      className={styles.actionBtn}
                      onClick={() => setActivePreviewPost(post)}
                      title="Visualizar Apresentação"
                     >
                       <Maximize2 size={16} />
                     </button>
                  )}
                  {(chatHistory.length > 0 || sessionId) && (
                    <button
                      className={styles.actionBtn}
                      onClick={() => setChatHistoryPreview({
                        sessionId,
                        messages: chatHistory,
                        postLabel: `Arte ${post.id.split('-')[0]}`,
                      })}
                      title="Ver histórico da conversa"
                    >
                      <MessageSquareText size={16} />
                    </button>
                  )}
                  <button
                    className={styles.actionBtn}
                    onClick={(e) => handleDeletePost(post.id, e)}
                    title="Excluir"
                    style={{ color: 'rgb(220, 38, 38)' }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
