import React from 'react';
import { X, Loader2 } from 'lucide-react';
import { Post } from '@/lib/hooks';
import { extractPreviewSource } from '@/lib/designContent';
import styles from '../brand-galeria.module.css';
import dynamic from 'next/dynamic';

const HtmlSlideRenderer = dynamic(() => import('@/components/DesignDocument/HtmlSlideRenderer'), { ssr: false });

interface CanvaExportModalProps {
  post: Post;
  onClose: () => void;
  canvaFormat: 'png' | 'pptx' | 'html';
  setCanvaFormat: (format: 'png' | 'pptx' | 'html') => void;
  mostrarCanvaInstrucoes: boolean;
  setMostrarCanvaInstrucoes: (show: boolean) => void;
  exportando: { postId: string; formato: string; done: number; total: number } | null;
  exportandoCanva: { postId: string; done: number; total: number } | null;
  onExecutarCanvaExport: (e: React.MouseEvent) => void;
}

export function CanvaExportModal({
  post,
  onClose,
  canvaFormat,
  setCanvaFormat,
  mostrarCanvaInstrucoes,
  setMostrarCanvaInstrucoes,
  exportando,
  exportandoCanva,
  onExecutarCanvaExport
}: CanvaExportModalProps) {
  const preview = extractPreviewSource(post.content, null);
  const imageUrl = post.previewUrl || (preview?.kind === 'image' ? preview.url : null);
  const htmlContent = preview?.kind === 'html-design' ? preview.content : null;

  // Calcular proporção real das páginas
  const contentWidth = htmlContent?.width || 1080;
  const contentHeight = htmlContent?.height || 1080;
  const aspectRatio = `${contentWidth} / ${contentHeight}`;

  const isRunningExport = exportandoCanva?.postId === post.id
    || (exportando?.postId === post.id && exportando.formato === 'html');

  return (
    <div className={styles.canvaModalOverlay} onClick={() => { if (!isRunningExport) onClose(); }}>
      <div className={styles.canvaModalContainer} onClick={(e) => e.stopPropagation()}>

        {/* Lado Esquerdo: Área de Preview (Fundo Escuro com Scroll) */}
        <div className={styles.adobePreviewArea}>
          <button className={styles.adobeCloseBtn} onClick={() => { if (!isRunningExport) onClose(); }}>
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
                      Envia os slides renderizados como imagens de alta resolução direto para a sua conta do Canva, unidos num design multipágina. Fiel ao visual, mas o texto vira pixel — não dá pra editar depois.
                    </div>
                  </div>
                </div>

                {/* PPTX Card — caminho editável via Design Import API */}
                {htmlContent && (
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
                      <div className={styles.canvaFormatCardTitle}>Apresentação PPTX (Editável, Automático)</div>
                      <div className={styles.canvaFormatCardDesc}>
                        Gera um PowerPoint e importa direto no Canva como design estático, mantendo os textos editáveis. Funções JavaScript e links não são aceitos pela API do Canva e são descartados na importação.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

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

            <div style={{ marginTop: 'auto', display: 'flex', gap: '12px' }}>
              <button
                className={styles.adobeDangerBtn}
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                onClick={onClose}
                disabled={isRunningExport}
              >
                Cancelar
              </button>
              <button
                className={styles.adobeMainActionBtn}
                onClick={onExecutarCanvaExport}
                disabled={isRunningExport}
              >
                {isRunningExport
                  ? 'Processando...'
                  : canvaFormat === 'html'
                    ? 'Baixar arquivo'
                    : 'Exportar para o Canva'}
              </button>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
