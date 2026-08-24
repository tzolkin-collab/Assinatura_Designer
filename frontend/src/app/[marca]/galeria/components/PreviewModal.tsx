import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  X, Download, PenLine, FileDown, Folder, Send, ExternalLink,
  Loader2, Trash2, Globe, Check, Copy, Presentation, Image as LucideImage
} from 'lucide-react';
import { Post } from '@/lib/hooks';
import {
  extractChatHistory,
  extractPreviewSource,
  extractSessionId,
  extractUsedAssets
} from '@/lib/designContent';
import styles from '../brand-galeria.module.css';
import dynamic from 'next/dynamic';

const HtmlSlideRenderer = dynamic(() => import('@/components/DesignDocument/HtmlSlideRenderer'), { ssr: false });

interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
}

function formatPostType(type: string) {
  switch (type) {
    case 'CAROUSEL': return 'Apresentação';
    case 'PRESENTATION': return 'Apresentação';
    case 'SINGLE_IMAGE': return 'Post Único';
    default: return type;
  }
}

interface PreviewModalProps {
  post: Post;
  onClose: () => void;
  slug: string;
  canEdit: boolean;
  folders: FolderNode[];
  onMoveToFolder: (postId: string, folderId: string | null) => void;
  onDeletePost: (postId: string, e: React.MouseEvent) => void;
  onDownload: (e: React.MouseEvent, url: string, filename: string) => void;
  onDownloadDeck: (e: React.MouseEvent, postId: string, format: 'pdf' | 'zip' | 'html' | 'pptx') => void;
  exportando: { postId: string; formato: string; done: number; total: number } | null;
  onCanvaExport: (post: Post) => void;

  // Publicar apresentação props
  onPublishPresentation: (postId: string, config: { autoplay: boolean; showCounter: boolean }) => Promise<void>;
  onUnpublishPresentation: (postId: string) => Promise<void>;
  publishingHost: boolean;
  hostErro: string | null;
}

export function PreviewModal({
  post,
  onClose,
  slug,
  canEdit,
  folders,
  onMoveToFolder,
  onDeletePost,
  onDownload,
  onDownloadDeck,
  exportando,
  onCanvaExport,
  onPublishPresentation,
  onUnpublishPresentation,
  publishingHost,
  hostErro
}: PreviewModalProps) {
  const [hostAutoplay, setHostAutoplay] = useState(false);
  const [hostShowCounter, setHostShowCounter] = useState(true);
  const [hostCopiado, setHostCopiado] = useState(false);
  const [hostQrDataUrl, setHostQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    const hc = post.hostingConfig ?? {};
    setHostShowCounter(hc.showCounter !== false);
    setHostAutoplay(!!hc.autoplay);
    setHostCopiado(false);
  }, [post.id, post.hostingConfig]);

  const publicHostUrl = post.publicSlug
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/apresentacao/${post.publicSlug}`
    : '';

  useEffect(() => {
    if (!publicHostUrl) { setHostQrDataUrl(null); return; }
    let cancelled = false;
    import('qrcode').then(({ default: QRCode }) =>
      QRCode.toDataURL(publicHostUrl, { margin: 1, width: 176 }),
    ).then((dataUrl) => { if (!cancelled) setHostQrDataUrl(dataUrl); })
      .catch(() => { if (!cancelled) setHostQrDataUrl(null); });
    return () => { cancelled = true; };
  }, [publicHostUrl]);

  const handleCopyPublicHostUrl = () => {
    if (!publicHostUrl) return;
    navigator.clipboard?.writeText(publicHostUrl).then(() => {
      setHostCopiado(true);
      setTimeout(() => setHostCopiado(false), 1500);
    }).catch(() => {});
  };

  const preview = extractPreviewSource(post.content, null);
  const imageUrl = post.previewUrl || (preview?.kind === 'image' ? preview.url : null);
  const htmlContent = preview?.kind === 'html-design' ? preview.content : null;
  const chatHistory = extractChatHistory(post.content);
  const sessionId = extractSessionId(post.content);
  const usedAssets = extractUsedAssets(post.content);

  // Calcular proporção real das páginas
  const contentWidth = htmlContent?.width || 1080;
  const contentHeight = htmlContent?.height || 1080;
  const aspectRatio = `${contentWidth} / ${contentHeight}`;

  return (
    <div className={styles.adobeModalOverlay} onClick={onClose}>
      <div className={styles.adobeModalContainer} onClick={(e) => e.stopPropagation()}>

        {/* Lado Esquerdo: Área de Preview (Fundo Escuro) */}
        <div className={styles.adobePreviewArea}>
          <button className={styles.adobeCloseBtn} onClick={onClose}>
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
            ) : (
              <div style={{ color: 'var(--color-text-tertiary)' }}>Sem preview disponível</div>
            )}
          </div>
        </div>

        {/* Lado Direito: Barra de Configurações e Propriedades (Adobe-like) */}
        <div className={styles.adobePanelArea}>
          <div className={styles.adobePanelHeader}>
            <div className={styles.adobeMetaBadge}>
              {formatPostType(post.type)}
            </div>
            <h3 className={styles.adobePostTitle}>
              {post.name || `Arte ${post.id.split('-')[0]}`}
            </h3>
            <div className={styles.adobePanelMeta}>
              <span>Criado em: {new Date(post.createdAt).toLocaleDateString()}</span>
              <span>ID: {post.id.split('-')[0]}</span>
              {post.createdBy && (
                <span title={post.createdBy.email}>
                  Por: {post.createdBy.name}
                </span>
              )}
            </div>
          </div>

          <div className={styles.adobePanelBody}>
            {/* Seção: Ações Rápidas */}
            {htmlContent && canEdit && (
              <div className={styles.adobePanelSection}>
                <h4 className={styles.adobeSectionTitle}>Editar</h4>
                <Link
                  href={`/${slug}/editor/${post.id}`}
                  className={styles.adobeMainActionBtn}
                  onClick={onClose}
                >
                  <PenLine size={16} />
                  Abrir no Editor
                </Link>
              </div>
            )}

            {/* Seção: Assets da marca usados neste deck */}
            {usedAssets.length > 0 && (
              <div className={styles.adobePanelSection}>
                <h4 className={styles.adobeSectionTitle}>Assets da marca usados ({usedAssets.length})</h4>
                <div className={styles.usedAssetsGrid}>
                  {usedAssets.map((asset) => (
                    <div key={asset.id} className={styles.usedAssetCard} title={asset.name}>
                      <img src={asset.url} alt={asset.name} className={styles.usedAssetThumb} />
                      <span className={styles.usedAssetName}>{asset.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Seção: Exportar / Downloads */}
            <div className={styles.adobePanelSection}>
              <h4 className={styles.adobeSectionTitle}>Exportar e Downloads</h4>
              <div className={styles.adobeBtnGrid}>
                {imageUrl && (
                  <button
                    className={styles.adobeSecondaryBtn}
                    onClick={(e) => onDownload(e, imageUrl, `post-${post.id}.png`)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <LucideImage size={14} style={{ opacity: 0.7 }} />
                      <span>Baixar Imagem (PNG)</span>
                    </div>
                    <Download size={14} style={{ opacity: 0.5 }} />
                  </button>
                )}

                {htmlContent && (
                  <>
                    <button
                      className={styles.adobeSecondaryBtn}
                      onClick={(e) => onDownloadDeck(e, post.id, 'pptx')}
                      disabled={exportando !== null}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Presentation size={14} style={{ opacity: 0.7 }} />
                        <span>Apresentação (PPTX)</span>
                      </div>
                      {exportando?.postId === post.id && exportando.formato === 'pptx' ? (
                        <Loader2 size={14} className={styles.spin} />
                      ) : (
                        <Download size={14} style={{ opacity: 0.5 }} />
                      )}
                    </button>
                    <button
                      className={styles.adobeSecondaryBtn}
                      onClick={(e) => onDownloadDeck(e, post.id, 'pdf')}
                      disabled={exportando !== null}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FileDown size={14} style={{ opacity: 0.7 }} />
                        <span>Documento (PDF)</span>
                      </div>
                      {exportando?.postId === post.id && exportando.formato === 'pdf' ? (
                        <Loader2 size={14} className={styles.spin} />
                      ) : (
                        <Download size={14} style={{ opacity: 0.5 }} />
                      )}
                    </button>
                    <button
                      className={styles.adobeSecondaryBtn}
                      onClick={(e) => onDownloadDeck(e, post.id, 'zip')}
                      disabled={exportando !== null}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Folder size={14} style={{ opacity: 0.7 }} />
                        <span>Imagens Separadas (ZIP)</span>
                      </div>
                      {exportando?.postId === post.id && exportando.formato === 'zip' ? (
                        <Loader2 size={14} className={styles.spin} />
                      ) : (
                        <Download size={14} style={{ opacity: 0.5 }} />
                      )}
                    </button>
                    {htmlContent && (
                      <button
                        className={styles.adobeSecondaryBtn}
                        onClick={(e) => onDownloadDeck(e, post.id, 'html')}
                        disabled={exportando !== null}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <FileDown size={14} style={{ opacity: 0.7 }} />
                          <span>Código Fonte (HTML)</span>
                        </div>
                        {exportando?.postId === post.id && exportando.formato === 'html' ? (
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
                        onCanvaExport(post);
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

            {/* Seção: Publicar apresentação */}
            {htmlContent && (
              <div className={styles.adobePanelSection}>
                <h4 className={styles.adobeSectionTitle}>Publicar Apresentação</h4>
                <p className={styles.hostSectionHint}>
                  Gera uma página pública navegável (sem login) com o design atual — um link vivo pra compartilhar, não um arquivo.
                </p>

                {post.publicSlug ? (
                  <>
                    <div className={styles.hostPublicUrlRow}>
                      <span className={styles.hostPublicUrlText} title={publicHostUrl}>{publicHostUrl}</span>
                      <button type="button" className={styles.hostIconBtn} onClick={handleCopyPublicHostUrl} title="Copiar link">
                        {hostCopiado ? <Check size={13} /> : <Copy size={13} />}
                      </button>
                      <a href={publicHostUrl} target="_blank" rel="noreferrer" className={styles.hostIconBtn} title="Abrir em nova aba">
                        <ExternalLink size={13} />
                      </a>
                    </div>
                    {hostQrDataUrl && (
                      <div className={styles.hostQrRow}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={hostQrDataUrl} alt="QR code do link público" width={132} height={132} className={styles.hostQrImage} />
                      </div>
                    )}
                    {hostErro && <p className={styles.hostErrorText}>{hostErro}</p>}
                    <div className={styles.adobeBtnGrid}>
                      <button
                        className={styles.adobeSecondaryBtn}
                        onClick={(e) => { e.stopPropagation(); void onUnpublishPresentation(post.id); }}
                        disabled={publishingHost}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Globe size={14} style={{ opacity: 0.7 }} />
                          <span>{publishingHost ? 'Despublicando…' : 'Despublicar'}</span>
                        </div>
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <label className={styles.hostToggleLabel}>
                      <input type="checkbox" checked={hostShowCounter} onChange={(e) => setHostShowCounter(e.target.checked)} />
                      Mostrar contador de slides (ex.: &quot;2 / 6&quot;)
                    </label>
                    <label className={styles.hostToggleLabel}>
                      <input type="checkbox" checked={hostAutoplay} onChange={(e) => setHostAutoplay(e.target.checked)} />
                      Avançar automaticamente (autoplay)
                    </label>
                    {hostErro && <p className={styles.hostErrorText}>{hostErro}</p>}
                    <div className={styles.adobeBtnGrid}>
                      <button
                        className={styles.adobeSecondaryBtn}
                        onClick={(e) => { e.stopPropagation(); void onPublishPresentation(post.id, { autoplay: hostAutoplay, showCounter: hostShowCounter }); }}
                        disabled={publishingHost}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Globe size={14} style={{ opacity: 0.7 }} />
                          <span>{publishingHost ? 'Publicando…' : 'Publicar apresentação'}</span>
                        </div>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Seção: Organização e Pastas */}
            {canEdit && (
              <div className={styles.adobePanelSection}>
                <h4 className={styles.adobeSectionTitle}>Organizar</h4>
                <div className={styles.adobeFolderRow}>
                  <span className={styles.adobeLabel}>Pasta destino:</span>
                  <select
                    className={styles.folderSelect}
                    value={post.folderId || ''}
                    onChange={(e) => onMoveToFolder(post.id, e.target.value || null)}
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
                      onClick={onClose}
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
                  onClick={(e) => onDeletePost(post.id, e)}
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
}
