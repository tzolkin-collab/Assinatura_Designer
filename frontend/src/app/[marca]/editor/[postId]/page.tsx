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

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Check, ChevronDown, Clock, Crosshair, Download, History, Loader2,
  MessageSquareText, Presentation, RotateCcw, Sparkles, X,
} from 'lucide-react';
import { api, getApiErrorMessage } from '@/lib/api';
import Button from '@/components/ui/Button';
import HtmlSlideRenderer from '@/components/DesignDocument/HtmlSlideRenderer';
import SlideCodeEditor, { type SlideCode } from '@/components/DesignDocument/SlideCodeEditor';
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

type Painel = 'ia' | 'codigo' | 'versoes';

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

  const slideCount = content?.slides.length ?? 0;
  const safeSlide = Math.min(activeSlide, Math.max(0, slideCount - 1));
  const canvasW = content?.width ?? 1080;
  const canvasH = content?.height ?? 1080;

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
        { slideIndex: safeSlide, instruction: texto, ...(alvo ? { target: alvo } : {}) },
      );
      aplicarSlide(resp.slideIndex, resp.slide);
      setEditLog(prev => [...prev.slice(-5), alvo?.identifier ? `[${alvo.identifier}] ${texto}` : texto]);
      setInstrucao('');
      setAlvo(null); // alvo consumido — o elemento pode nem existir mais após a edição
    } catch (e) {
      setErroEdicao(getApiErrorMessage(e, 'A edição falhou — o slide continua como estava.'));
    } finally {
      setEditando(false);
    }
  }, [instrucao, editando, content, postId, safeSlide, aplicarSlide, alvo]);

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
      <div style={{ display: 'grid', placeItems: 'center', height: '100dvh', color: 'var(--color-text-muted, #6b7280)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Loader2 size={16} /> Carregando design…</span>
      </div>
    );
  }

  if (formatoLegado || !content) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100dvh', textAlign: 'center', padding: 24 }}>
        <div>
          <h2 style={{ marginBottom: 8 }}>Formato não suportado pelo editor</h2>
          <p style={{ color: 'var(--color-text-muted, #6b7280)', marginBottom: 16, maxWidth: 480 }}>
            {erro ?? 'Este design é de um formato legado. O acervo atual foi migrado para html-design — se este post importa, me avise no chat da Fábrica.'}
          </p>
          <Button onClick={() => router.push(`/${marca}/galeria`)}>Voltar à galeria</Button>
        </div>
      </div>
    );
  }

  const painelBtn = (id: Painel, label: string, Icone: typeof Sparkles) => (
    <button
      key={id}
      type="button"
      onClick={() => setPainel(id)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12.5, fontWeight: 500,
        borderRadius: 999, border: '1px solid transparent', cursor: 'pointer',
        background: painel === id ? 'rgba(0,0,0,0.07)' : 'transparent',
        color: painel === id ? 'var(--color-text, #111827)' : 'var(--color-text-muted, #6b7280)',
      }}
    >
      <Icone size={13} /> {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: 'var(--color-bg, #faf8f5)' }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', flexWrap: 'wrap',
        borderBottom: '1px solid var(--color-border, rgba(0,0,0,0.08))', background: 'var(--color-surface, #fff)',
        position: 'relative', zIndex: 30,
      }}>
        <button
          type="button"
          onClick={() => router.push(`/${marca}/galeria`)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13 }}
        >
          <ArrowLeft size={15} /> Galeria
        </button>
        <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '38vw' }}>
          {post?.name?.trim() || `Design ${postId.slice(0, 8)}`}
        </div>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted, #6b7280)' }}>
          {slideCount} slide{slideCount > 1 ? 's' : ''} · {canvasW}×{canvasH}
        </span>

        <div style={{ marginLeft: 'auto', position: 'relative' }}>
          <button
            type="button"
            onClick={() => setMenuBaixar(v => !v)}
            disabled={exportando !== null}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12.5, fontWeight: 500,
              borderRadius: 999, border: '1px solid var(--color-border, rgba(0,0,0,0.12))',
              background: 'transparent', cursor: exportando ? 'wait' : 'pointer',
            }}
          >
            {exportando
              ? <><Loader2 size={13} /> {exportando.formato.toUpperCase()} {exportando.done}/{exportando.total}</>
              : <><Download size={13} /> Baixar <ChevronDown size={12} /></>}
          </button>
          {menuBaixar && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 40,
              width: 'min(250px, calc(100vw - 24px))', padding: '4px 0', background: 'var(--color-surface, #fff)',
              border: '1px solid var(--color-border, rgba(0,0,0,0.12))', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            }}>
              {([
                ['pptx', 'PPTX editável', 'Visual fiel + textos editáveis'],
                ['pdf', 'PDF do deck', 'Uma página por slide'],
                ['zip', 'ZIP com PNGs', 'Imagens em alta'],
              ] as Array<[DeckFileFormat, string, string]>).map(([f, label, hint]) => (
                <button key={f} type="button" onClick={() => void baixarDeck(f)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer' }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>{label}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted, #6b7280)' }}>{hint}</span>
                </button>
              ))}
              <div style={{ height: 1, background: 'rgba(0,0,0,0.08)', margin: '4px 0' }} />
              <button type="button" onClick={() => { setMenuBaixar(false); void baixarSlide(postId, safeSlide, 'png'); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13 }}>
                PNG deste slide
              </button>
              <button type="button" onClick={() => { setMenuBaixar(false); void baixarSlide(postId, safeSlide, 'html'); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13 }}>
                HTML deste slide
              </button>
            </div>
          )}
        </div>
      </header>

      {erro && (
        <div style={{ padding: '8px 16px', fontSize: 12.5, color: '#b91c1c', background: '#fef2f2' }}>{erro}</div>
      )}

      {/* ── Corpo: viewer + painel ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 14, padding: 14, flexWrap: 'wrap', overflowY: 'auto' }}>
        {/* Viewer */}
        <div style={{ flex: '1 1 480px', minWidth: 320, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={() => setInspecionando(v => !v)}
              title="Clique em um elemento do slide para mirar a edição de IA nele"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', fontSize: 12, fontWeight: 500,
                borderRadius: 999, cursor: 'pointer',
                border: inspecionando ? '1px solid var(--color-brand, #FF6B35)' : '1px solid var(--color-border, rgba(0,0,0,0.12))',
                background: inspecionando ? 'rgba(255,107,53,0.1)' : 'transparent',
                color: inspecionando ? 'var(--color-brand, #FF6B35)' : 'var(--color-text, #111827)',
              }}
            >
              <Crosshair size={13} /> {inspecionando ? 'Clique em um elemento do slide…' : 'Selecionar elemento'}
            </button>
            {alvo && !inspecionando && (
              <span style={{ fontSize: 11.5, color: 'var(--color-text-muted, #6b7280)' }}>
                alvo: <code style={{ fontSize: 11 }}>{alvo.identifier}</code>
              </span>
            )}
          </div>
          <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: inspecionando ? '2px solid var(--color-brand, #FF6B35)' : '1px solid var(--color-border, rgba(0,0,0,0.1))', background: '#fff', aspectRatio: `${canvasW} / ${canvasH}`, maxHeight: '68vh' }}>
            <HtmlSlideRenderer content={content} activeSlide={safeSlide} onSlideChange={setActiveSlide} hideNav inspectorMode={inspecionando} />
          </div>
          {slideCount > 1 && (
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
              {content.slides.map((_, i) => (
                <button key={i} type="button" onClick={() => setActiveSlide(i)}
                  style={{
                    flexShrink: 0, padding: '5px 12px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
                    border: i === safeSlide ? '1px solid var(--color-brand, #FF6B35)' : '1px solid var(--color-border, rgba(0,0,0,0.12))',
                    background: i === safeSlide ? 'rgba(255,107,53,0.08)' : 'transparent',
                    fontWeight: i === safeSlide ? 600 : 400,
                  }}>
                  {i + 1}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Painel: IA | Código | Versões */}
        <div style={{ flex: '1 1 360px', minWidth: 300, maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {painelBtn('ia', 'Editar com IA', Sparkles)}
            {painelBtn('codigo', 'Código', MessageSquareText)}
            {painelBtn('versoes', 'Versões', History)}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', border: '1px solid var(--color-border, rgba(0,0,0,0.1))', borderRadius: 12, background: 'var(--color-surface, #fff)', padding: 14 }}>
            {painel === 'ia' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Editar slide {safeSlide + 1} com IA</div>
                <p style={{ fontSize: 12, color: 'var(--color-text-muted, #6b7280)', margin: 0 }}>
                  Mesma edição do chat da Fábrica: a IA altera só o que você pedir e preserva o resto do slide. Cada edição cria uma versão.
                  {!alvo && ' Dica: use "Selecionar elemento" no preview para mirar a edição.'}
                </p>
                {alvo && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8,
                    border: '1px solid rgba(255,107,53,0.4)', background: 'rgba(255,107,53,0.06)',
                  }}>
                    <Crosshair size={13} style={{ flexShrink: 0, color: 'var(--color-brand, #FF6B35)' }} />
                    <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                      <code style={{ fontSize: 11.5 }}>{alvo.identifier}</code>
                      {alvo.text && <span style={{ color: 'var(--color-text-muted, #6b7280)' }}> — “{alvo.text.slice(0, 48)}{(alvo.text.length ?? 0) > 48 ? '…' : ''}”</span>}
                    </div>
                    <button type="button" onClick={() => setAlvo(null)} title="Remover alvo (a instrução volta a valer para o slide todo)"
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted, #6b7280)', display: 'flex' }}>
                      <X size={13} />
                    </button>
                  </div>
                )}
                {editLog.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {editLog.map((m, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text-secondary, #555)' }}>
                        <Check size={11} /> {m}
                      </div>
                    ))}
                  </div>
                )}
                {erroEdicao && (
                  <div style={{ fontSize: 12, color: '#b91c1c', background: '#fef2f2', borderRadius: 8, padding: '6px 10px' }}>{erroEdicao}</div>
                )}
                <textarea
                  value={instrucao}
                  onChange={(e) => setInstrucao(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void editarComIA(); } }}
                  placeholder='Ex: "deixa o título maior", "troca o fundo para o verde da marca", "resume o parágrafo"'
                  rows={3}
                  disabled={editando}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--color-border, rgba(0,0,0,0.15))', fontSize: 13, resize: 'vertical' }}
                />
                <Button onClick={() => void editarComIA()} disabled={editando || !instrucao.trim()}>
                  {editando ? 'Editando…' : 'Aplicar no slide'}
                </Button>
              </div>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Histórico de versões</div>
                {versoes.length === 0 && (
                  <p style={{ fontSize: 12, color: 'var(--color-text-muted, #6b7280)' }}>Nenhuma versão ainda — elas nascem a cada edição de IA ou de código.</p>
                )}
                {versoes.map((v) => (
                  <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--color-border, rgba(0,0,0,0.08))' }}>
                    <Clock size={13} style={{ flexShrink: 0, color: 'var(--color-text-muted, #6b7280)' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {v.label?.trim() || VERSION_SOURCE_LABEL[v.source]}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted, #6b7280)' }}>
                        {formatDate(v.createdAt)}{typeof v.slideCount === 'number' ? ` · ${v.slideCount} slides` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void restaurar(v.id)}
                      disabled={restaurando !== null}
                      title="Restaurar esta versão (o estado atual vira versão antes)"
                      style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--color-border, rgba(0,0,0,0.12))', background: 'transparent', cursor: 'pointer' }}
                    >
                      {restaurando === v.id ? <Loader2 size={12} /> : <RotateCcw size={12} />} Restaurar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--color-text-muted, #6b7280)' }}>
            <Presentation size={12} />
            Para edição visual completa, baixe o PPTX e abra no Canva/PowerPoint — o texto continua editável.
          </div>
        </div>
      </div>
    </div>
  );
}
