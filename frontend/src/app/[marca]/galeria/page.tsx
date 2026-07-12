'use client';

import { useParams } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { ArrowLeft, Download, Maximize2, X, Folder, Plus, Trash2, LayoutGrid, List, Sparkles, MessageSquareText, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import styles from './brand-galeria.module.css';
import { useBrandPosts, type Post } from '@/lib/hooks';
import { useState, useEffect } from 'react';
import { api, API_BASE } from '@/lib/api';
import { extractChatHistory, extractPreviewSource, extractSessionId, type FabricaChatHistoryMessage, type HtmlDesignPostContent } from '@/lib/designContent';
import DesignRenderer, { type DesignPage } from '@/components/Fabrica/DesignRenderer';
import DesignDocumentRenderer from '@/components/DesignDocument/DesignDocumentRenderer';
import HtmlSlideRenderer from '@/components/DesignDocument/HtmlSlideRenderer';
import IRSlideRenderer from '@/components/DesignDocument/IRSlideRenderer';

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
  const preview = extractPreviewSource(post.content, post.previewUrl);
  return preview?.kind === 'image' && preview.url === previewImage;
}

function formatChatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function formatAttachmentLabel(name: string, mimeType: string) {
  if (mimeType.startsWith('image/')) return `${name} · imagem`;
  return name;
}

export default function BrandGaleriaPage() {
  const params = useParams();
  const slug = params.marca as string;
  const marca = decodeURIComponent(slug);
  const { posts, loading, error, mutate } = useBrandPosts(slug);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewDesign, setPreviewDesign] = useState<{ pages: DesignPage[]; width: number; height: number; document?: unknown } | null>(null);
  const [previewHtml, setPreviewHtml] = useState<HtmlDesignPostContent | null>(null);
  const [chatHistoryPreview, setChatHistoryPreview] = useState<{ sessionId: string | null; messages: FabricaChatHistoryMessage[]; postLabel: string } | null>(null);

  const [folders, setFolders] = useState<{id: string, name: string}[]>([]);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [showAiReportModal, setShowAiReportModal] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  
  const [draggedPostId, setDraggedPostId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  useEffect(() => {
    if (!slug) return;
    // Fetch folders
    api.get<{id: string, name: string}[]>(`/folders/${slug}`).then(data => {
      if (data) setFolders(data);
    }).catch(err => console.warn('Falha ao carregar pastas:', err.message));
  }, [slug]);

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim() || creatingFolder) return;
    
    setCreatingFolder(true);
    try {
      const data = await api.post<{id: string, name: string}>(`/folders/${slug}`, { name: newFolderName });
      if (data) {
        setFolders(prev => [data, ...prev]);
        setNewFolderName('');
        setShowFolderModal(false);
      }
    } catch (err) {
      console.error('Failed to create folder:', err);
    } finally {
      setCreatingFolder(false);
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
      if (previewImage) setPreviewImage(null);
    } catch (err) {
      console.error('Failed to delete post:', err);
    }
  };

  const handleDragStart = (postId: string) => {
    setDraggedPostId(postId);
  };

  const handleDragOver = (e: React.DragEvent, targetFolderId: string | null) => {
    if (!draggedPostId) return;
    
    const post = posts.find(p => p.id === draggedPostId);
    if (!post) return;

    // Todas as Artes (all) não deve aceitar drop, pois é apenas um filtro de visualização
    if (targetFolderId === 'all') return;

    // Não permitir drop em "Sem Pasta" se o post já estiver sem pasta
    if (targetFolderId === 'unassigned' && !post.folderId) return;

    // Não permitir drop na mesma pasta que o post já está
    if (targetFolderId === post.folderId) return;

    e.preventDefault(); // Permite o drop apenas se as condições acima forem atendidas
    setDragOverFolderId(targetFolderId);
  };

  const handleDrop = async (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    if (draggedPostId) {
      await handleMoveToFolder(draggedPostId, folderId === 'unassigned' ? null : folderId);
    }
    setDraggedPostId(null);
    setDragOverFolderId(null);
  };

  const handleDeleteFolder = async (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Deseja excluir esta pasta? Os itens não serão deletados, apenas movidos para a galeria geral.')) return;
    try {
      await api.delete(`/folders/${folderId}`);
      setFolders(prev => prev.filter(f => f.id !== folderId));
      if (activeFolder === folderId) setActiveFolder(null);
    } catch (err) {
      console.error('Failed to delete folder:', err);
    }
  };

  const filteredPosts = posts.filter(post => {
    if (activeFolder === null) return true; // Show all
    if (activeFolder === 'unassigned') return !post.folderId;
    return post.folderId === activeFolder;
  });

  const previewPost = previewImage ? posts.find((p) => postMatchesPreviewImage(p, previewImage)) : undefined;

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

  // Export de post html-design: renderiza no backend (chromium) e baixa o PNG.
  const handleDownloadHtml = async (e: React.MouseEvent, postId: string, slideCount: number) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      for (let slide = 0; slide < Math.min(slideCount, 12); slide++) {
        const resp = await fetch(`${API_BASE}/posts/${postId}/export?slide=${slide}`, { headers: auth });
        if (!resp.ok) throw new Error('Falha ao exportar slide ' + (slide + 1));
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `post-${postId.slice(0, 8)}-slide-${slide + 1}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('[export html]', err);
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

  return (
    <div>
      {showFolderModal && (
        <div className={styles.modalOverlay} onClick={() => setShowFolderModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Criar Pasta</h3>
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

      {previewImage && (
        <div className={styles.modalOverlay} onClick={() => setPreviewImage(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Visualização</h3>
              <button className={styles.closeBtn} onClick={() => setPreviewImage(null)}>
                <X size={20} />
              </button>
            </div>
            <Image
              src={previewImage}
              alt="Preview em tamanho real"
              width={1080}
              height={1080}
              className={styles.modalImage}
              unoptimized
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <select 
                className={styles.folderSelect}
                value={previewPost?.folderId || ''}
                onChange={(e) => {
                  if (previewPost) handleMoveToFolder(previewPost.id, e.target.value || null);
                }}
              >
                <option value="">Sem Pasta</option>
                {folders.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
              <Button variant="secondary" onClick={(e) => previewPost && handleDeletePost(previewPost.id, e)}>
                <Trash2 size={16} />
                Excluir
              </Button>
              <Button onClick={(e) => handleDownload(e, previewImage, `post-${Date.now()}.png`)}>
                <Download size={16} />
                Fazer Download
              </Button>
            </div>
          </div>
        </div>
      )}

      {previewHtml && (
        <div className={styles.modalOverlay} onClick={() => setPreviewHtml(null)}>
          <div className={styles.designModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Apresentação — {previewHtml.slides.length} slides</h3>
              <button className={styles.closeBtn} onClick={() => setPreviewHtml(null)}>
                <X size={20} />
              </button>
            </div>
            <div className={styles.designModalBody}>
              <HtmlSlideRenderer content={previewHtml} mode="contain" />
            </div>
          </div>
        </div>
      )}

      {previewDesign && (
        <div className={styles.modalOverlay} onClick={() => setPreviewDesign(null)}>
          <div className={styles.designModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Apresentação — {previewDesign.pages.length} slides</h3>
              <button className={styles.closeBtn} onClick={() => setPreviewDesign(null)}>
                <X size={20} />
              </button>
            </div>
            <div className={styles.designModalBody}>
              {previewDesign.document ? (
                <DesignDocumentRenderer document={previewDesign.document} mode="contain" />
              ) : (
                <DesignRenderer
                  pages={previewDesign.pages}
                  canvasWidth={previewDesign.width}
                  canvasHeight={previewDesign.height}
                />
              )}
            </div>
          </div>
        </div>
      )}

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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <PageHeader
          title={marca}
          description="Histórico de artes e criativos gerados para esta marca."
        />
        
        <div className={styles.viewToggle}>
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
          <Button size="sm" onClick={() => setShowFolderModal(true)}>
            <Plus size={14} />
            Criar Pasta
          </Button>
        </div>
        
        <div className={styles.foldersGrid}>
          <div 
            className={`${styles.folderCard} ${activeFolder === null ? styles.folderCardActive : ''}`}
            onClick={() => setActiveFolder(null)}
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
          
          {folders.map(folder => (
            <div 
              key={folder.id}
              className={`${styles.folderCard} ${activeFolder === folder.id ? styles.folderCardActive : ''} ${dragOverFolderId === folder.id ? styles.folderCardDragOver : ''}`}
              onClick={() => setActiveFolder(folder.id)}
              onDragOver={(e) => handleDragOver(e, folder.id)}
              onDragLeave={() => setDragOverFolderId(null)}
              onDrop={(e) => handleDrop(e, folder.id)}
            >
              <Folder size={16} />
              <span className={styles.folderName}>{folder.name}</span>
              <button 
                className={styles.closeBtn} 
                onClick={(e) => handleDeleteFolder(folder.id, e)}
                title="Excluir Pasta"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
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
        <div className={styles.grid}>
          {filteredPosts.map((post, index) => {
            const preview = extractPreviewSource(post.content, post.previewUrl);
            const imageUrl = preview?.kind === 'image' ? preview.url : null;
            const designPages = preview?.kind === 'design' ? preview.pages : null;
            const designDocument = preview?.kind === 'design' ? preview.document : undefined;
            const htmlContent = preview?.kind === 'html-design' ? preview.content : null;
            const irContent = preview?.kind === 'ir-design' ? preview.content : null;
            const firstPage = designPages?.[0];
            const isHybridUncompiled = preview?.kind === 'hybrid-document';
            const chatHistory = extractChatHistory(post.content);
            const sessionId = extractSessionId(post.content);

            return (
              <div
                key={post.id}
                className={`${styles.postCard} ${draggedPostId === post.id ? styles.postCardDragging : ''}`}
                draggable
                onDragStart={() => handleDragStart(post.id)}
                onDragEnd={() => setDraggedPostId(null)}
              >
                <Card hover padding="none">
                  <div className={styles.postThumb}>
                    <span className={styles.postType}>{formatPostType(post.type)}</span>

                    <div className={styles.postActions}>
                      <button
                        className={styles.actionBtn}
                        onClick={(e) => handleDeletePost(post.id, e)}
                        title="Excluir Arte"
                        style={{ color: 'rgb(220, 38, 38)' }}
                      >
                        <Trash2 size={14} />
                      </button>
                      {imageUrl && (
                        <>
                          <button
                            className={styles.actionBtn}
                            onClick={(e) => { e.stopPropagation(); setPreviewImage(imageUrl); }}
                            title="Visualizar em tela cheia"
                          >
                            <Maximize2 size={14} />
                          </button>
                          <button
                            className={styles.actionBtn}
                            onClick={(e) => handleDownload(e, imageUrl, `post-${post.id}.png`)}
                            title="Baixar imagem"
                          >
                            <Download size={14} />
                          </button>
                        </>
                      )}
                      {htmlContent && (
                        <button
                          className={styles.actionBtn}
                          onClick={(e) => handleDownloadHtml(e, post.id, htmlContent.slides.length)}
                          title="Baixar PNGs"
                        >
                          <Download size={14} />
                        </button>
                      )}
                      {(chatHistory.length > 0 || sessionId) && (
                        <button
                          className={styles.actionBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            setChatHistoryPreview({
                              sessionId,
                              messages: chatHistory,
                              postLabel: `Arte ${post.id.split('-')[0]}`,
                            });
                          }}
                          title="Ver histórico da conversa"
                        >
                          <MessageSquareText size={14} />
                        </button>
                      )}
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
                      <div
                        className={styles.thumbDesign}
                        style={{ cursor: 'pointer' }}
                        onClick={(e) => { e.stopPropagation(); setPreviewHtml(htmlContent); }}
                      >
                        <HtmlSlideRenderer content={htmlContent} mode="cover" hideNav />
                        <span className={styles.slideCount}>{htmlContent.slides.length} slides — clique para abrir</span>
                      </div>
                    ) : irContent ? (
                      <div className={styles.thumbDesign}>
                        <IRSlideRenderer content={irContent} mode="cover" hideNav />
                        <span className={styles.slideCount}>{irContent.ir?.slides?.length ?? 0} slides</span>
                      </div>
                    ) : designPages && firstPage ? (
                      <div
                        className={styles.thumbDesign}
                        style={{ backgroundColor: firstPage.backgroundColor ?? '#111', cursor: 'pointer' }}
                        onClick={(e) => { e.stopPropagation(); setPreviewDesign({ pages: designPages, width: firstPage.width ?? 1080, height: firstPage.height ?? 1080, document: designDocument }); }}
                      >
                        {designDocument ? (
                          <DesignDocumentRenderer document={designDocument} mode="cover" hideNav />
                        ) : (
                          <DesignRenderer
                            pages={[firstPage]}
                            canvasWidth={firstPage.width ?? 1080}
                            canvasHeight={firstPage.height ?? 1080}
                            hideNav
                            mode="cover"
                          />
                        )}
                        <span className={styles.slideCount}>{designPages.length} slides — clique para abrir</span>
                      </div>
                    ) : isHybridUncompiled ? (
                      <div className={styles.thumbEmpty}>
                        <Sparkles size={24} style={{ color: 'var(--color-brand)', marginBottom: 8 }} />
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '12px', textAlign: 'center', padding: '0 12px' }}>
                          Preview pendente (DesignDocument)
                        </span>
                      </div>
                    ) : (
                      <div className={styles.thumbEmpty}>
                        <span style={{ color: 'var(--color-text-tertiary)', fontSize: '12px' }}>Sem preview</span>
                      </div>
                    )}
                  </div>
                  <div className={styles.postBody}>
                    <div className={styles.postMetaGroup}>
                      <span className={styles.postId}>{post.id.split('-')[0]}</span>
                      <span className={styles.postDate}>{new Date(post.createdAt).toLocaleDateString()}</span>
                    </div>
                    {(chatHistory.length > 0 || sessionId) && (
                      <button
                        className={styles.chatHistoryInlineBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          setChatHistoryPreview({
                            sessionId,
                            messages: chatHistory,
                            postLabel: `Arte ${post.id.split('-')[0]}`,
                          });
                        }}
                      >
                        <MessageSquareText size={14} />
                        Ver conversa
                      </button>
                    )}
                  </div>
                </Card>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={styles.list}>
          {filteredPosts.map((post, index) => {
            const preview = extractPreviewSource(post.content, post.previewUrl);
            const imageUrl = preview?.kind === 'image' ? preview.url : null;
            const designPages = preview?.kind === 'design' ? preview.pages : null;
            const designDocument = preview?.kind === 'design' ? preview.document : undefined;
            const htmlContent = preview?.kind === 'html-design' ? preview.content : null;
            const irContent = preview?.kind === 'ir-design' ? preview.content : null;
            const firstPage = designPages?.[0];
            const isHybridUncompiled = preview?.kind === 'hybrid-document';
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
                      <Image
                        src={imageUrl}
                        alt="Post thumbnail"
                        fill
                        className={styles.thumbImage}
                        sizes="64px"
                        unoptimized
                        priority={index < 6}
                      />
                    ) : htmlContent ? (
                      <div
                        className={styles.thumbDesign}
                        style={{ cursor: 'pointer' }}
                        onClick={(e) => { e.stopPropagation(); setPreviewHtml(htmlContent); }}
                      >
                        <HtmlSlideRenderer content={htmlContent} mode="cover" hideNav />
                      </div>
                    ) : irContent ? (
                      <div className={styles.thumbDesign}>
                        <IRSlideRenderer content={irContent} mode="cover" hideNav />
                      </div>
                    ) : designPages && firstPage ? (
                      <div
                        className={styles.thumbDesign}
                        style={{ backgroundColor: firstPage.backgroundColor ?? '#111', cursor: 'pointer' }}
                        onClick={(e) => { e.stopPropagation(); setPreviewDesign({ pages: designPages, width: firstPage.width ?? 1080, height: firstPage.height ?? 1080, document: designDocument }); }}
                      >
                        {designDocument ? (
                          <DesignDocumentRenderer document={designDocument} mode="cover" hideNav />
                        ) : (
                          <DesignRenderer
                            pages={[firstPage]}
                            canvasWidth={firstPage.width ?? 1080}
                            canvasHeight={firstPage.height ?? 1080}
                            hideNav
                            mode="cover"
                          />
                        )}
                      </div>
                    ) : isHybridUncompiled ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', color: 'var(--color-brand)', backgroundColor: 'var(--color-bg-secondary)' }}>
                        <Sparkles size={20} />
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', color: 'var(--color-text-tertiary)', backgroundColor: 'var(--color-bg-secondary)' }}>
                        <LayoutGrid size={20} />
                      </div>
                    )}
                  </div>
                  <div className={styles.listDetails}>
                    <span className={styles.listTitle}>Arte {post.id.split('-')[0]}</span>
                    <div className={styles.listMeta}>
                      <span>{formatPostType(post.type)}</span>
                      <span>•</span>
                      <span>{new Date(post.createdAt).toLocaleDateString()}</span>
                      {designPages && (
                        <>
                          <span>•</span>
                          <span>{designPages.length} slides</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className={styles.listActions}>
                  {imageUrl && (
                    <>
                      <button
                        className={styles.actionBtn}
                        onClick={(e) => { e.stopPropagation(); setPreviewImage(imageUrl); }}
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
                  {designPages && firstPage && (
                     <button
                      className={styles.actionBtn}
                      onClick={() => setPreviewDesign({ pages: designPages, width: firstPage.width ?? 1080, height: firstPage.height ?? 1080, document: designDocument })}
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
