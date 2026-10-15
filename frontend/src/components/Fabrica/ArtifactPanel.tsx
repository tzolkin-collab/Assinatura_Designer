'use client';

import styles from './ArtifactPanel.module.css';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Code2, Copy, Download, Eye, Loader2, ExternalLink, Globe } from 'lucide-react';
import { baixarIrJson, baixarSlide, exportarDeck, type DeckFileFormat } from '@/lib/deckFile';
import { api, getApiErrorMessage } from '@/lib/api';
import { acompanharExport } from '@/lib/canvaExport';
import { publishPost, unpublishPost, type HostingConfig } from '@/lib/presentationHosting';
import SlideCodeEditor, { type SlideCode } from '@/components/DesignDocument/SlideCodeEditor';
import GenerationCostChip from '@/components/GenerationCost/GenerationCostChip';

interface ArtifactPanelProps {
  /** Envelope do design (ir-design/html-design). `undefined` = nada gerado ainda. */
  design?: unknown;
  /** Existe assim que o primeiro slide é persistido — antes do fim da geração. */
  postId?: string;
  slideIndex: number;
  slideCount: number;
  gerando: boolean;
  /** Persistiu a edição de código de um slide (aba Fonte) — atualize o preview. */
  onSlideCodeSaved?: (slideIndex: number, slide: SlideCode) => void;
  /** O preview que já existia (renderer + navegação + thumbs). */
  children: ReactNode;
}

type Aba = 'preview' | 'fonte';

/** A fonte do slide em foco — é o que o usuário vê na aba Fonte. */
function fonteDoSlide(design: unknown, index: number): { raw: unknown; texto: string } {
  const env = design as { ir?: { slides?: unknown[] }; slides?: unknown[] } | undefined;
  const raw = env?.ir?.slides?.[index] ?? env?.slides?.[index] ?? null;

  // html-design: mostra o CÓDIGO de verdade (CSS + HTML), não JSON escapado —
  // é o "ver os arquivos sendo gerados" do slide em foco, ao vivo.
  const slide = raw as { html?: unknown; css?: unknown } | null;
  if (slide && typeof slide.html === 'string') {
    const css = typeof slide.css === 'string' && slide.css.trim() ? `/* ===== CSS ===== */\n${slide.css}\n\n` : '';
    return { raw, texto: `${css}<!-- ===== HTML ===== -->\n${slide.html}` };
  }

  // ir-design (legado) e demais formatos: JSON estruturado.
  return { raw, texto: raw ? JSON.stringify(raw, null, 2) : '' };
}

/**
 * O artefato da Fábrica: o design como PREVIEW, como FONTE e como ARQUIVO.
 *
 * Antes daqui, a arte gerada só existia como pixel na tela — quem precisava levar a
 * apresentação para uma reunião não tinha o que baixar. Os downloads ficam habilitados
 * assim que o primeiro slide existe (não no fim da geração): cada slide é persistido no
 * instante em que aparece, então o arquivo do que já saiu é sempre gerável.
 */
export function ArtifactPanel({
  design,
  postId,
  slideIndex,
  slideCount,
  gerando,
  onSlideCodeSaved,
  children,
}: ArtifactPanelProps) {
  const [aba, setAba] = useState<Aba>('preview');
  const [menuAberto, setMenuAberto] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [job, setJob] = useState<{ formato: DeckFileFormat; done: number; total: number } | null>(null);

  const [canvaDesignId, setCanvaDesignId] = useState<string | null>(null);
  const [canvaDesignName, setCanvaDesignName] = useState<string | null>(null);
  const [canvaExportUrl, setCanvaExportUrl] = useState<string | null>(null);
  const [canvaSyncEnabled, setCanvaSyncEnabled] = useState(false);
  const [canvaLastSyncedAt, setCanvaLastSyncedAt] = useState<string | null>(null);
  const [fetchingSync, setFetchingSync] = useState(false);
  const [togglingSync, setTogglingSync] = useState(false);
  const [exportandoCanva, setExportandoCanva] = useState(false);
  const [exportProgress, setExportProgress] = useState({ done: 0, total: 0 });
  const router = useRouter();

  // ── Hospedagem pública (Fase 5, Fatia 1) ──────────────────────────────────
  const [hostModalOpen, setHostModalOpen] = useState(false);
  const [publicSlug, setPublicSlug] = useState<string | null>(null);
  const [hostAutoplay, setHostAutoplay] = useState(false);
  const [hostShowCounter, setHostShowCounter] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [hostCopiado, setHostCopiado] = useState(false);
  const [hostErro, setHostErro] = useState<string | null>(null);
  const [hostQrDataUrl, setHostQrDataUrl] = useState<string | null>(null);

  const appOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const publicUrl = publicSlug ? `${appOrigin}/apresentacao/${publicSlug}` : '';

  // QR code — mesmo link do botão "Copiar", só que num formato pra escanear
  // (compartilhar numa tela de reunião/apresentação física, sem digitar nada).
  useEffect(() => {
    if (!publicUrl) { setHostQrDataUrl(null); return; }
    let cancelled = false;
    import('qrcode').then(({ default: QRCode }) =>
      QRCode.toDataURL(publicUrl, { margin: 1, width: 176 }),
    ).then((dataUrl) => { if (!cancelled) setHostQrDataUrl(dataUrl); })
      .catch(() => { if (!cancelled) setHostQrDataUrl(null); });
    return () => { cancelled = true; };
  }, [publicUrl]);

  const loadCanvaSyncStatus = useCallback(async () => {
    if (!postId) return;
    try {
      const post = await api.get<any>(`/posts/${postId}`);
      const data = post.data || post;
      setCanvaDesignId(data.canvaDesignId || null);
      setCanvaDesignName(data.canvaDesignName || null);
      setCanvaExportUrl(data.canvaExportUrl || null);
      setCanvaSyncEnabled(!!data.canvaSyncEnabled);
      setCanvaLastSyncedAt(data.canvaLastSyncedAt || null);
      setPublicSlug(data.publicSlug || null);
      const hc = (data.hostingConfig ?? {}) as HostingConfig;
      setHostAutoplay(!!hc.autoplay);
      setHostShowCounter(hc.showCounter !== false);
    } catch (err) {
      console.warn('[ArtifactPanel] Erro ao carregar status do Canva:', err);
    }
  }, [postId]);

  const handlePublish = async () => {
    if (!postId) return;
    setPublishing(true);
    setHostErro(null);
    try {
      const result = await publishPost(postId, { autoplay: hostAutoplay, showCounter: hostShowCounter });
      setPublicSlug(result.publicSlug);
    } catch (err) {
      setHostErro(getApiErrorMessage(err, 'Falha ao publicar a apresentação.'));
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    if (!postId) return;
    setPublishing(true);
    setHostErro(null);
    try {
      await unpublishPost(postId);
      setPublicSlug(null);
    } catch (err) {
      setHostErro(getApiErrorMessage(err, 'Falha ao despublicar.'));
    } finally {
      setPublishing(false);
    }
  };

  const handleCopyPublicUrl = () => {
    if (!publicUrl) return;
    navigator.clipboard?.writeText(publicUrl).then(() => {
      setHostCopiado(true);
      setTimeout(() => setHostCopiado(false), 2000);
    }).catch(() => {});
  };

  useEffect(() => {
    loadCanvaSyncStatus();
  }, [postId, loadCanvaSyncStatus]);

  const handleManualFetch = async () => {
    if (!postId) return;
    setFetchingSync(true);
    setErro(null);
    try {
      const res = await api.post<{ data?: any }>(`/canva/sync/${postId}/fetch`, {});
      const data = res.data || res;
      setCanvaDesignName(data.canvaDesignName || null);
      setCanvaExportUrl(data.canvaExportUrl || null);
      setCanvaLastSyncedAt(data.canvaLastSyncedAt || null);
    } catch (err) {
      setErro(getApiErrorMessage(err, 'Falha ao buscar atualização do Canva.'));
    } finally {
      setFetchingSync(false);
    }
  };

  const handleToggleSync = async (enabled: boolean) => {
    if (!postId) return;
    setTogglingSync(true);
    setErro(null);
    try {
      const res = await api.post<{ data?: any }>(`/canva/sync/${postId}/toggle`, { enabled });
      const data = res.data || res;
      setCanvaSyncEnabled(!!data.canvaSyncEnabled);
    } catch (err) {
      setErro(getApiErrorMessage(err, 'Falha ao alterar sincronização automática.'));
    } finally {
      setTogglingSync(false);
    }
  };

  const handleExportCanva = async () => {
    if (!postId) return;
    setExportandoCanva(true);
    setErro(null);
    try {
      const res = await api.post<{ data?: { jobId?: string }; jobId?: string }>(`/posts/${postId}/export-canva`, {});
      const jobId = res.data?.jobId || res.jobId;
      if (!jobId) throw new Error('Não retornou o ID do job.');
      await acompanharExport(postId, jobId, (done, total) => {
        setExportProgress({ done, total: total || slideCount });
      });
      await loadCanvaSyncStatus();
    } catch (err) {
      setErro(getApiErrorMessage(err, 'Falha ao exportar para o Canva.'));
    } finally {
      setExportandoCanva(false);
    }
  };

  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuAberto) return;
    const fora = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setMenuAberto(false);
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [menuAberto]);

  const temArtefato = Boolean(design) && slideCount > 0;
  const podeBaixar = temArtefato && Boolean(postId);
  const fonte = temArtefato ? fonteDoSlide(design, slideIndex).texto : '';

  // Slide html-design com deck persistido e geração PARADA: código editável.
  // Durante a geração é só leitura — o sync final do pipeline reescreveria a
  // edição manual feita no meio.
  const rawSlide = temArtefato ? (fonteDoSlide(design, slideIndex).raw as { html?: unknown; css?: unknown } | null) : null;
  const slideEditavel: SlideCode | null =
    !gerando && rawSlide && typeof rawSlide.html === 'string'
      ? { html: rawSlide.html, css: typeof rawSlide.css === 'string' ? rawSlide.css : undefined }
      : null;

  const copiarFonte = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(fonte);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      setErro('Não consegui copiar (o navegador bloqueou a área de transferência).');
    }
  }, [fonte]);

  const comErro = useCallback(async (acao: () => Promise<void>) => {
    setErro(null);
    setMenuAberto(false);
    try {
      await acao();
    } catch (e) {
      setErro(getApiErrorMessage(e, 'Não consegui gerar o arquivo.'));
    }
  }, []);

  const baixarDeck = useCallback(
    (formato: DeckFileFormat) =>
      comErro(async () => {
        if (!postId) return;
        setJob({ formato, done: 0, total: slideCount });
        try {
          await exportarDeck(postId, formato, (done, total) =>
            setJob({ formato, done, total: total || slideCount }),
          );
        } finally {
          setJob(null);
        }
      }),
    [comErro, postId, slideCount],
  );

  const itemMenu = (label: string, hint: string, onClick: () => void, disabled = false) => (
    <button type="button" role="menuitem" onClick={onClick} disabled={disabled} className={styles.menuItem}>
      {label}
      <small>{hint}</small>
    </button>
  );

  const botaoAba = (id: Aba, label: string, Icone: typeof Eye) => (
    <button
      type="button"
      role="tab"
      aria-selected={aba === id}
      onClick={() => setAba(id)}
      disabled={id === 'fonte' && !temArtefato}
      className={[styles.tab, aba === id ? styles.tabActive : ''].join(' ')}
    >
      <Icone size={14} /> {label}
    </button>
  );

  return (
    // absolute+inset em vez de height:100% — dentro de um item flex (.previewPanel na
    // Fábrica) percentage-height não resolvia de forma confiável, encolhendo o corpo
    // do preview a uma fração da altura real e empurrando a navegação de slides.
    <div className={styles.root}>
      {/* ── Barra do artefato ────────────────────────────────────────────────── */}
      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist">
          {botaoAba('preview', 'Preview', Eye)}
          {botaoAba('fonte', 'Fonte', Code2)}
        </div>

        <span className={styles.meta}>
          {temArtefato
            ? `${slideCount} slide${slideCount > 1 ? 's' : ''}${gerando ? ' · gerando…' : ''}`
            : gerando ? 'gerando…' : ''}
        </span>

        {/* Custo estimado do deck. Refaz a leitura a cada slide que entra e quando a geração
            termina (cada slide persistido já tem seus steps no rastro), então o valor acompanha
            a geração sem polling. Ancorado à esquerda: aqui o chip está longe da borda direita. */}
        <GenerationCostChip postId={postId} refreshKey={`${gerando ? 'g' : 'i'}:${slideCount}`} align="start" />

        <div className={styles.toolbarEnd}>
          <div ref={boxRef} className={styles.menuWrap}>
            <button
              type="button"
              onClick={() => setMenuAberto((v) => !v)}
              disabled={!podeBaixar || job !== null}
              title={podeBaixar ? 'Baixar o design' : 'Disponível assim que o primeiro slide sair'}
              aria-haspopup="menu"
              aria-expanded={menuAberto}
              className={styles.btn}
            >
              {job ? <Loader2 size={14} className={styles.spin} /> : <Download size={14} />}
              {job ? `${job.formato.toUpperCase()} ${job.done}/${job.total}` : 'Baixar'}
              {!job && <ChevronDown size={13} />}
            </button>

            {menuAberto && (
              <div className={styles.menu} role="menu">
                {itemMenu('PPTX editável', 'Texto, formas e imagens editáveis (PowerPoint/Canva)', () => void baixarDeck('pptx'))}
                {itemMenu('PDF do deck', 'Uma página por slide, texto de verdade', () => void baixarDeck('pdf'))}
                {itemMenu('ZIP com os PNGs', `${slideCount} imagem${slideCount > 1 ? 'ns' : ''} em alta`, () => void baixarDeck('zip'))}
                <div className={styles.menuRule} />
                {itemMenu('PNG deste slide', `Slide ${slideIndex + 1}`, () =>
                  void comErro(() => baixarSlide(postId!, slideIndex, 'png')),
                )}
                {itemMenu('HTML deste slide', 'O documento que vira a arte', () =>
                  void comErro(() => baixarSlide(postId!, slideIndex, 'html')),
                )}
                {itemMenu('JSON do design', 'A fonte do deck inteiro', () =>
                  void comErro(async () => baixarIrJson(design, postId)),
                )}
              </div>
            )}
          </div>

          {/* Hospedar apresentação — recurso qualitativamente diferente de um
              download: cria uma página pública persistente, não um arquivo de
              uma vez só. Por isso fica no próprio botão, fora do menu de Baixar. */}
          <button
            type="button"
            onClick={() => setHostModalOpen(true)}
            disabled={!podeBaixar}
            title={podeBaixar ? 'Hospedar como apresentação pública navegável' : 'Disponível assim que o primeiro slide sair'}
            className={[styles.btn, publicSlug ? styles.btnOn : ''].join(' ')}
          >
            <Globe size={14} />
            {publicSlug ? 'Hospedado' : 'Hospedar'}
          </button>
        </div>
      </div>

      {/* Canva: uma linha só. Detalhe e ações de sincronização aparecem quando já há vínculo. */}
      {postId && (
        <div className={styles.canva}>
          <span className={[styles.canvaDot, canvaDesignId ? styles.canvaDotOn : ''].join(' ')} />
          <span className={styles.canvaTitle}>
            {canvaDesignId ? `Canva: ${canvaDesignName || 'Conectado'}` : 'Não exportado para o Canva'}
          </span>

          {canvaDesignId ? (
            <>
              <span className={styles.canvaMeta}>
                {canvaLastSyncedAt ? `Última sincronização: ${new Date(canvaLastSyncedAt).toLocaleString('pt-BR')}` : 'Nunca sincronizado'}
              </span>
              <div className={styles.canvaActions}>
                <label className={styles.canvaCheck}>
                  <input
                    type="checkbox"
                    checked={canvaSyncEnabled}
                    disabled={togglingSync}
                    onChange={(e) => handleToggleSync(e.target.checked)}
                  />
                  <span>Sincronizar Auto</span>
                </label>
                <button type="button" className={styles.linkBtn} onClick={handleManualFetch} disabled={fetchingSync}>
                  {fetchingSync ? 'Buscando...' : 'Puxar Info'}
                </button>
                <button type="button" className={styles.linkBtn} onClick={handleExportCanva} disabled={exportandoCanva}>
                  {exportandoCanva ? `Enviando (${exportProgress.done}/${exportProgress.total})...` : 'Atualizar Arte'}
                </button>
                {canvaExportUrl && (
                  <a href={canvaExportUrl} target="_blank" rel="noopener noreferrer" className={styles.linkBtn}>
                    Abrir no Canva <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </>
          ) : (
            <div className={styles.canvaActions}>
              <button type="button" className={styles.linkBtn} onClick={handleExportCanva} disabled={exportandoCanva}>
                {exportandoCanva ? `Exportando (${exportProgress.done}/${exportProgress.total})...` : 'Exportar para o Canva'}
              </button>
            </div>
          )}
        </div>
      )}

      {erro && (
        <div className={styles.alert} role="alert">
          <span>{erro}</span>
          {(erro.includes('CANVA_SESSION_EXPIRED') || erro.includes('Sessão do Canva')) && (
            <button
              type="button"
              onClick={() => router.push('/configuracoes/integracoes?canva_error=session_expired')}
              className={styles.btn}
            >
              Reconectar Canva
            </button>
          )}
        </div>
      )}

      {/* ── Corpo: preview ou fonte ──────────────────────────────────────────── */}
      {/* Precisa de display:flex — os filhos (.previewContent) usam flex:1 pra
          preencher a altura disponível; sem isso viravam blocos comuns e encolhiam
          pro tamanho do próprio conteúdo, empurrando a navegação de slides pra fora. */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {aba === 'preview' ? (
          children
        ) : slideEditavel && postId && onSlideCodeSaved ? (
          // html-design com deck persistido: o código é EDITÁVEL — a mesma
          // primitiva que a IA usa (arquivo html/css do slide), sanitizada no
          // servidor. Salvou → o preview atualiza na hora via onSlideCodeSaved.
          <div style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: '10px 12px' }}>
            <SlideCodeEditor
              postId={postId}
              slideIndex={slideIndex}
              slide={slideEditavel}
              onSaved={onSlideCodeSaved}
              maxAreaHeight={400}
            />
          </div>
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', flexShrink: 0 }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted, #6b7280)' }}>
                Fonte · slide {slideIndex + 1} de {slideCount}
              </span>
              <button
                type="button"
                onClick={() => void copiarFonte()}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, marginLeft: 'auto',
                  border: '1px solid var(--color-border, rgba(0,0,0,0.12))',
                  borderRadius: 999, padding: '4px 10px', fontSize: 12,
                  background: 'transparent', cursor: 'pointer',
                }}
              >
                {copiado ? <Check size={13} /> : <Copy size={13} />}
                {copiado ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <pre
              style={{
                flex: 1, margin: 0, padding: '0 12px 12px',
                overflow: 'auto', fontSize: 11.5, lineHeight: 1.5,
                fontSizeAdjust: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                color: 'var(--color-text, #111827)',
              }}
            >
              {fonte}
            </pre>
          </div>
        )}
      </div>

      {hostModalOpen && (
        <div className={styles.scrim} onClick={() => setHostModalOpen(false)}>
          <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="host-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="host-title" className={styles.dialogTitle}>
              <Globe size={16} /> Hospedar apresentação
            </h3>
            <p className={styles.dialogText}>
              Publica uma página pública navegável (sem login) do design atual — botões de avançar/voltar, teclado e tela cheia.
            </p>

            {publicSlug ? (
              <>
                <div className={styles.urlRow}>
                  <span className={styles.url}>{publicUrl}</span>
                  <button type="button" onClick={handleCopyPublicUrl} className={styles.iconBtn} aria-label="Copiar link">
                    {hostCopiado ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                  <a href={publicUrl} target="_blank" rel="noopener noreferrer" className={styles.iconBtn} aria-label="Abrir link">
                    <ExternalLink size={14} />
                  </a>
                </div>
                {hostQrDataUrl && (
                  <div className={styles.qr}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={hostQrDataUrl} alt="QR code do link público" width={132} height={132} />
                  </div>
                )}
                <div className={styles.dialogActions}>
                  <button
                    type="button"
                    onClick={() => void handleUnpublish()}
                    disabled={publishing}
                    className={[styles.btn, styles.btnDanger].join(' ')}
                  >
                    {publishing ? 'Despublicando…' : 'Despublicar'}
                  </button>
                  <button type="button" onClick={() => setHostModalOpen(false)} className={[styles.btn, styles.btnPrimary].join(' ')}>
                    Fechar
                  </button>
                </div>
              </>
            ) : (
              <>
                <label className={styles.check}>
                  <input type="checkbox" checked={hostShowCounter} onChange={(e) => setHostShowCounter(e.target.checked)} />
                  Mostrar contador de slides (ex.: &quot;2 / 6&quot;)
                </label>
                <label className={styles.check}>
                  <input type="checkbox" checked={hostAutoplay} onChange={(e) => setHostAutoplay(e.target.checked)} />
                  Avançar automaticamente (autoplay)
                </label>
                {hostErro && <p className={styles.dialogError}>{hostErro}</p>}
                <div className={styles.dialogActions}>
                  <button type="button" onClick={() => setHostModalOpen(false)} className={styles.btn}>
                    Cancelar
                  </button>
                  <button type="button" onClick={() => void handlePublish()} disabled={publishing} className={[styles.btn, styles.btnPrimary].join(' ')}>
                    {publishing ? 'Publicando…' : 'Publicar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
