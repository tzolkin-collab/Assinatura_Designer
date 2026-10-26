'use client';

// O editor, reescrito slim (2026-07-18) — de 1.800 para ~400 linhas.
//
// A decisão de produto mudou o trabalho desta página: a edição fina é no CANVA
// (via PPTX) e pelo CHAT; aqui fica o essencial sobre o ÚNICO formato do
// produto (html-design): ver o deck, editar com IA, editar o CÓDIGO do slide
// (a mesma primitiva sanitizada que a IA usa), restaurar versões e baixar.
//
// Os ramos ancestrais (modelo Layer/CanvasEditor: 0 posts no banco; editor IR:
// posts migrados para html-design em 2026-07-18) foram removidos — o histórico
// vive no git e nos PostVersions.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Crosshair, Download, History, ImagePlus,
  Loader2, MessageSquareText, Presentation, RotateCcw, Sparkles, X,
} from 'lucide-react';
import { api, getApiErrorMessage } from '@/lib/api';
import Button from '@/components/ui/Button';
import styles from './editorPost.module.css';
import HtmlSlideRenderer from '@/components/DesignDocument/HtmlSlideRenderer';
import SlideThumb from '@/components/DesignDocument/SlideThumb';
import SlideCodeEditor, { type SlideCode } from '@/components/DesignDocument/SlideCodeEditor';
import PhotoSlotsPanel from '@/components/DesignDocument/PhotoSlotsPanel';
import GenerationCostChip from '@/components/GenerationCost/GenerationCostChip';
import { baixarSlide, exportarDeck, type DeckFileFormat } from '@/lib/deckFile';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface HtmlContent {
  kind: 'html-design';
  width?: number;
  height?: number;
  fonts?: string[];
  slides: SlideCode[];
}

interface Post {
  id: string;
  name?: string | null;
  type?: string;
  content: unknown;
}

type VersionSource = 'MANUAL' | 'EDITOR' | 'AI' | 'RESTORE';

interface PostVersion {
  id: string;
  label?: string | null;
  source: VersionSource;
  slideCount?: number;
  createdAt: string;
}

const VERSION_SOURCE_LABEL: Record<VersionSource, string> = {
  MANUAL: 'Manual',
  EDITOR: 'Editor',
  AI: 'IA',
  RESTORE: 'Restauração',
};

function isHtmlContent(c: unknown): c is HtmlContent {
  return !!c && typeof c === 'object' && (c as { kind?: string }).kind === 'html-design'
    && Array.isArray((c as { slides?: unknown[] }).slides);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

type Painel = 'ia' | 'fotos' | 'codigo' | 'versoes';

const TIPO_LABEL: Record<string, string> = {
  PRESENTATION: 'Apresentação',
  CAROUSEL: 'Carrossel',
  SINGLE_IMAGE: 'Imagem',
};

// Pedidos comuns, um toque: preenchem a caixa (não enviam), para a pessoa ajustar antes de aplicar.
const SUGESTOES: Array<{ label: string; texto: string }> = [
  { label: 'Título maior', texto: 'Deixa o título maior' },
  { label: 'Texto mais curto', texto: 'Resume o texto, mantendo só o essencial' },
  { label: 'Mais respiro', texto: 'Dá mais espaço entre os elementos e nas margens' },
  { label: 'Mais contraste', texto: 'Aumenta o contraste entre o texto e o fundo' },
  { label: 'Fundo na cor da marca', texto: 'Troca o fundo para a cor principal da marca' },
];

// ── Página ────────────────────────────────────────────────────────────────────

export default function EditorPage() {
  const params = useParams<{ marca: string; postId: string }>();
  const router = useRouter();
  const marca = params.marca;
  const postId = params.postId;

  const [post, setPost] = useState<Post | null>(null);
  const [content, setContent] = useState<HtmlContent | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [formatoLegado, setFormatoLegado] = useState(false);

  const [activeSlide, setActiveSlide] = useState(0);
  const [painel, setPainel] = useState<Painel>('ia');

  // IA (mesmo endpoint do chat da Fábrica: editHtmlSlide sanitizado no servidor)
  const [instrucao, setInstrucao] = useState('');
  const [editando, setEditando] = useState(false);
  const [editLog, setEditLog] = useState<string[]>([]);
  const [erroEdicao, setErroEdicao] = useState<string | null>(null);
  // Cada edição por IA gasta tokens: sobe este contador para o chip de custo reler o rastro.
  const [custoKey, setCustoKey] = useState(0);

  // Seletor "inspecionar": clica no elemento do preview e a instrução de IA
  // passa a mirar EXATAMENTE nele (identifier + caminho + trecho de HTML).
  interface ElementoAlvo { identifier?: string; path?: string; text?: string; outerHTML?: string }
  const [inspecionando, setInspecionando] = useState(false);
  const [alvo, setAlvo] = useState<ElementoAlvo | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const msg = e.data as { type?: string; data?: ElementoAlvo } | null;
      if (msg?.type !== 'ELEMENT_SELECTED' || !msg.data) return;
      setAlvo(msg.data);
      setInspecionando(false); // pick único, como no DevTools
      setPainel('ia');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Trocou de slide: o alvo do slide anterior não vale mais.
  useEffect(() => { setAlvo(null); setInspecionando(false); }, [activeSlide]);

  // Versões
  const [versoes, setVersoes] = useState<PostVersion[]>([]);
  const [restaurando, setRestaurando] = useState<string | null>(null);

  // Downloads
  const [exportando, setExportando] = useState<{ formato: string; done: number; total: number } | null>(null);
  const [menuBaixar, setMenuBaixar] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const p = await api.get<Post>(`/posts/${postId}`);
      setPost(p);
      if (isHtmlContent(p.content)) {
        setContent(p.content);
        setFormatoLegado(false);
      } else {
        setContent(null);
        setFormatoLegado(true);
      }
    } catch (e) {
      setErro(getApiErrorMessage(e, 'Não consegui carregar o design.'));
    } finally {
      setCarregando(false);
    }
  }, [postId]);

  useEffect(() => {
    void carregar();
    if (postId && marca) {
      localStorage.setItem(`editor_last_post_${marca}`, postId);
    }
  }, [carregar, postId, marca]);

  const carregarVersoes = useCallback(async () => {
    try {
      setVersoes(await api.get<PostVersion[]>(`/posts/${postId}/versions`));
    } catch { /* silencioso: painel mostra vazio */ }
  }, [postId]);

  useEffect(() => {
    if (painel === 'versoes') void carregarVersoes();
  }, [painel, carregarVersoes]);

  const instrucaoRef = useRef<HTMLTextAreaElement>(null);

  const slideCount = content?.slides.length ?? 0;
  const irPara = useCallback((i: number) => {
    setActiveSlide(Math.min(Math.max(i, 0), Math.max(0, slideCount - 1)));
  }, [slideCount]);

  // Setas trocam de slide, menos quando a pessoa está digitando.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      setActiveSlide((cur) => Math.min(Math.max(cur + (e.key === 'ArrowRight' ? 1 : -1), 0), Math.max(0, slideCount - 1)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [slideCount]);

  const usarSugestao = (texto: string) => {
    setInstrucao(texto);
    instrucaoRef.current?.focus();
  };
  const safeSlide = Math.min(activeSlide, Math.max(0, slideCount - 1));
  const canvasW = content?.width ?? 1080;
  const canvasH = content?.height ?? 1080;
  // Quantos espaços de foto o slide ativo tem (só para o selo da aba; o painel lê a lista de verdade).
  const espacosDeFoto = (content?.slides[safeSlide]?.html.match(/data-photo-slot=/g) ?? []).length;

  const aplicarSlide = useCallback((idx: number, slide: SlideCode) => {
    setContent(prev => {
      if (!prev) return prev;
      const slides = prev.slides.slice();
      slides[idx] = slide;
      return { ...prev, slides };
    });
  }, []);

  const editarComIA = useCallback(async () => {
    const texto = instrucao.trim();
    if (!texto || editando || !content) return;
    setEditando(true);
    setErroEdicao(null);
    try {
      const resp = await api.post<{ slideIndex: number; slide: SlideCode }>(
        `/posts/${postId}/edit-slide`,
        {
          slideIndex: safeSlide,
          instruction: texto,
          // Sem isto cada edição chegava sem passado: "agora um pouco menor" não
          // tinha a que se referir e obrigava a reescrever a frase inteira.
          previousInstructions: editLog,
          ...(alvo ? { target: alvo } : {}),
        },
      );
      aplicarSlide(resp.slideIndex, resp.slide);
      // O step da edição é gravado em segundo plano (fail-open, sem await): reler na hora
      // podia pegar o rastro sem ele. Um respiro curto resolve sem virar polling.
      setTimeout(() => setCustoKey((k) => k + 1), 1200);
      setEditLog(prev => [...prev.slice(-5), alvo?.identifier ? `[${alvo.identifier}] ${texto}` : texto]);
      setInstrucao('');
      setAlvo(null); // alvo consumido — o elemento pode nem existir mais após a edição
    } catch (e) {
      setErroEdicao(getApiErrorMessage(e, 'A edição falhou — o slide continua como estava.'));
    } finally {
      setEditando(false);
    }
  }, [instrucao, editando, content, postId, safeSlide, aplicarSlide, alvo, editLog]);

  const restaurar = useCallback(async (versionId: string) => {
    setRestaurando(versionId);
    try {
      await api.post(`/posts/${postId}/versions/${versionId}/restore`, {});
      await carregar();
      await carregarVersoes();
    } catch (e) {
      setErro(getApiErrorMessage(e, 'Não consegui restaurar a versão.'));
    } finally {
      setRestaurando(null);
    }
  }, [postId, carregar, carregarVersoes]);

  const baixarDeck = useCallback(async (formato: DeckFileFormat) => {
    setMenuBaixar(false);
    setExportando({ formato, done: 0, total: slideCount });
    try {
      await exportarDeck(postId, formato, (done, total) => setExportando({ formato, done, total }));
    } catch (e) {
      setErro(getApiErrorMessage(e, `Não consegui gerar o ${formato.toUpperCase()}.`));
    } finally {
      setExportando(null);
    }
  }, [postId, slideCount]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (carregando) {
    return (
      <div className={styles.center}>
        <span className={styles.loading}><Loader2 size={16} className="animate-spin" /> Carregando design…</span>
      </div>
    );
  }

  if (formatoLegado || !content) {
    return (
      <div className={styles.center}>
        <div className={styles.centerInner}>
          <h2>Formato não suportado pelo editor</h2>
          <p>
            {erro ?? 'Este design é de um formato legado. O acervo atual foi migrado para html-design — se este post importa, me avise no chat da Fábrica.'}
          </p>
          <Button onClick={() => router.push(`/${marca}/galeria`)}>Voltar à galeria</Button>
        </div>
      </div>
    );
  }

  const aba = (id: Painel, label: string, Icone: typeof Sparkles) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={painel === id}
      onClick={() => setPainel(id)}
      className={[styles.tab, painel === id ? styles.tabActive : ''].join(' ')}
    >
      <Icone size={14} /> {label}
    </button>
  );

  const tituloPost = post?.name?.trim() || `${TIPO_LABEL[post?.type ?? ''] ?? 'Design'} sem nome`;
  const semNome = !post?.name?.trim();

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <button type="button" onClick={() => router.push(`/${marca}/galeria`)} className={styles.back}>
          <ArrowLeft size={15} /> Galeria
        </button>
        <div className={styles.titleBlock}>
          <div className={[styles.title, semNome ? styles.titleMuted : ''].join(' ')} title={tituloPost}>{tituloPost}</div>
          <span className={styles.meta}>
            {slideCount} slide{slideCount > 1 ? 's' : ''} · {canvasW}×{canvasH}
          </span>
        </div>

        <div className={styles.actions}>
          <GenerationCostChip postId={postId} refreshKey={custoKey} />
          <div className={styles.menuWrap}>
            <button
              type="button"
              onClick={() => setMenuBaixar(v => !v)}
              disabled={exportando !== null}
              aria-haspopup="menu"
              aria-expanded={menuBaixar}
              className={styles.btnPrimary}
            >
              {exportando
                ? <><Loader2 size={14} className="animate-spin" /> {exportando.formato.toUpperCase()} {exportando.done}/{exportando.total}</>
                : <><Download size={14} /> Baixar <ChevronDown size={13} /></>}
            </button>
            {menuBaixar && (
              <div className={styles.menu} role="menu">
                {([
                  ['pptx', 'PPTX editável', 'Visual fiel + textos editáveis'],
                  ['pdf', 'PDF do deck', 'Uma página por slide'],
                  ['zip', 'ZIP com PNGs', 'Imagens em alta'],
                ] as Array<[DeckFileFormat, string, string]>).map(([f, label, hint]) => (
                  <button key={f} type="button" role="menuitem" onClick={() => void baixarDeck(f)} className={styles.menuItem}>
                    {label}
                    <small>{hint}</small>
                  </button>
                ))}
                <div className={styles.menuRule} />
                <button type="button" role="menuitem" className={styles.menuItem} onClick={() => { setMenuBaixar(false); void baixarSlide(postId, safeSlide, 'png'); }}>
                  PNG deste slide
                </button>
                <button type="button" role="menuitem" className={styles.menuItem} onClick={() => { setMenuBaixar(false); void baixarSlide(postId, safeSlide, 'html'); }}>
                  HTML deste slide
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {erro && <div className={styles.alert} role="alert">{erro}</div>}

      <div className={[styles.body, slideCount > 1 ? '' : styles.bodySolo].join(' ')}>
        <main className={styles.stage}>
          <div className={styles.stageBar}>
            <button
              type="button"
              onClick={() => setInspecionando(v => !v)}
              title="Clique em um elemento do slide para mirar a edição de IA nele"
              aria-pressed={inspecionando}
              className={[styles.btn, inspecionando ? styles.btnActive : ''].join(' ')}
            >
              <Crosshair size={14} /> {inspecionando ? 'Clique em um elemento do slide…' : 'Selecionar elemento'}
            </button>
            {alvo && !inspecionando && (
              <span className={styles.target}>alvo: <code className={styles.code}>{alvo.identifier}</code></span>
            )}
            {slideCount > 1 && (
              <div className={styles.pager} role="group" aria-label="Navegar entre slides">
                <button type="button" className={styles.iconBtn} onClick={() => irPara(safeSlide - 1)} disabled={safeSlide === 0} aria-label="Slide anterior">
                  <ChevronLeft size={16} />
                </button>
                <span className={styles.pagerCount} aria-live="polite">{safeSlide + 1} / {slideCount}</span>
                <button type="button" className={styles.iconBtn} onClick={() => irPara(safeSlide + 1)} disabled={safeSlide >= slideCount - 1} aria-label="Próximo slide">
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>

          <div className={styles.canvasArea}>
            <div
              className={[styles.canvas, inspecionando ? styles.canvasInspecting : ''].join(' ')}
              style={{ aspectRatio: `${canvasW} / ${canvasH}`, ['--ar' as string]: canvasW / canvasH }}
            >
              <HtmlSlideRenderer content={content} activeSlide={safeSlide} onSlideChange={setActiveSlide} hideNav inspectorMode={inspecionando} />
            </div>
          </div>
        </main>

        {slideCount > 1 && (
          <nav className={styles.rail} aria-label="Slides do deck">
            {content.slides.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setActiveSlide(i)}
                aria-label={`Slide ${i + 1}`}
                aria-current={i === safeSlide ? 'true' : undefined}
                className={[styles.thumb, i === safeSlide ? styles.thumbActive : ''].join(' ')}
              >
                <SlideThumb content={content} index={i} className={styles.thumbFrame} />
                <span className={styles.thumbNum}>{i + 1}</span>
              </button>
            ))}
          </nav>
        )}

        <div className={styles.panel}>
          <div className={styles.tabs} role="tablist">
            {aba('ia', 'Editar', Sparkles)}
            {aba('fotos', espacosDeFoto > 0 ? `Fotos (${espacosDeFoto})` : 'Fotos', ImagePlus)}
            {aba('codigo', 'Código', MessageSquareText)}
            {aba('versoes', 'Versões', History)}
          </div>

          <div className={styles.panelBody}>
            {painel === 'ia' && (
              <div className={styles.stack}>
                <div className={styles.heading}>Slide {safeSlide + 1}: o que mudar?</div>
                <p className={styles.hint}>A IA altera só o que você pedir e guarda uma versão a cada edição.</p>

                {alvo && (
                  <div className={styles.targetBar}>
                    <Crosshair size={14} style={{ flexShrink: 0, color: 'var(--color-brand)' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <code>{alvo.identifier}</code>
                      {alvo.text && <span style={{ color: 'var(--color-text-secondary)' }}> — “{alvo.text.slice(0, 48)}{(alvo.text.length ?? 0) > 48 ? '…' : ''}”</span>}
                    </div>
                    <button type="button" className={styles.iconBtn} onClick={() => setAlvo(null)} aria-label="Remover alvo" title="Remover alvo (a instrução volta a valer para o slide todo)">
                      <X size={14} />
                    </button>
                  </div>
                )}

                {erroEdicao && <div className={styles.alertInline} role="alert">{erroEdicao}</div>}

                <div className={styles.composer}>
                  <textarea
                    ref={instrucaoRef}
                    className={styles.textarea}
                    value={instrucao}
                    onChange={(e) => setInstrucao(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter quebra linha. Numa caixa de 3 linhas, enviar no Enter
                      // disparava a edição no meio de uma frase.
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void editarComIA(); }
                    }}
                    placeholder={alvo ? 'O que fazer com este elemento?' : 'Descreva a mudança, ex.: "troca o fundo para o verde da marca"'}
                    aria-label="Instrução para a IA"
                    rows={3}
                    disabled={editando}
                  />
                  <div className={styles.composerBar}>
                    <span className={styles.fine}>
                      {typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl'}+Enter aplica
                    </span>
                    <button type="button" className={styles.apply} onClick={() => void editarComIA()} disabled={editando || !instrucao.trim()}>
                      {editando ? <><Loader2 size={14} className="animate-spin" /> Editando…</> : <><Sparkles size={14} /> Aplicar no slide</>}
                    </button>
                  </div>
                </div>

                <div className={styles.suggestions} role="group" aria-label="Sugestões de edição">
                  {SUGESTOES.map((sug) => (
                    <button key={sug.label} type="button" className={styles.chip} disabled={editando} onClick={() => usarSugestao(sug.texto)}>
                      {sug.label}
                    </button>
                  ))}
                </div>

                {!alvo && (
                  <p className={styles.fine}>
                    Para mirar um elemento, use <strong>Selecionar elemento</strong> acima do slide.
                  </p>
                )}

                {editLog.length > 0 && (
                  <div className={styles.logBlock}>
                    <div className={styles.logTitle}>Pedidos já aplicados</div>
                    {editLog.map((m, i) => (
                      <div key={i} className={styles.log}><Check size={12} /> <span>{m}</span></div>
                    ))}
                    <div className={styles.fine}>A IA recebe esses pedidos como contexto: dá para dizer &quot;agora um pouco menos&quot;.</div>
                  </div>
                )}
              </div>
            )}

            {painel === 'fotos' && content.slides[safeSlide] && (
              <PhotoSlotsPanel
                key={`${postId}-${safeSlide}`}
                postId={postId}
                marca={marca}
                slideIndex={safeSlide}
                slideHtml={content.slides[safeSlide].html}
                onApplied={aplicarSlide}
                onPedirEspaco={() => {
                  setInstrucao('Adicione ao lado do texto uma área de foto vazia (data-photo-slot), sem alterar nenhum texto do slide.');
                  setPainel('ia');
                }}
              />
            )}

            {painel === 'codigo' && content.slides[safeSlide] && (
              <SlideCodeEditor
                postId={postId}
                slideIndex={safeSlide}
                slide={content.slides[safeSlide]}
                onSaved={aplicarSlide}
                maxAreaHeight={340}
              />
            )}

            {painel === 'versoes' && (
              <div className={styles.stack}>
                <div className={styles.heading}>Histórico de versões</div>
                {versoes.length === 0 && (
                  <p className={styles.hint}>Nenhuma versão ainda — elas nascem a cada edição de IA ou de código.</p>
                )}
                <div className={styles.versions}>
                  {versoes.map((v) => (
                    <div key={v.id} className={styles.version}>
                      <Clock size={14} style={{ flexShrink: 0, color: 'var(--color-text-tertiary)' }} />
                      <div className={styles.versionText}>
                        <div className={styles.versionName}>{v.label?.trim() || VERSION_SOURCE_LABEL[v.source]}</div>
                        <div className={styles.fine}>
                          {formatDate(v.createdAt)}{typeof v.slideCount === 'number' ? ` · ${v.slideCount} slides` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        className={styles.btn}
                        onClick={() => void restaurar(v.id)}
                        disabled={restaurando !== null}
                        title="Restaurar esta versão (o estado atual vira versão antes)"
                      >
                        {restaurando === v.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Restaurar
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className={styles.footnote}>
            <Presentation size={13} />
            <span>Para edição visual completa, baixe o PPTX e abra no Canva ou PowerPoint. O texto continua editável.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
