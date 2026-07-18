'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Code2, Copy, Download, Eye, Loader2 } from 'lucide-react';
import { baixarIrJson, baixarSlide, exportarDeck, type DeckFileFormat } from '@/lib/deckFile';
import { getApiErrorMessage } from '@/lib/api';
import SlideCodeEditor, { type SlideCode } from '@/components/DesignDocument/SlideCodeEditor';

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
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '8px 12px', border: 'none', background: 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
        fontSize: 13, color: 'var(--color-text, #111827)',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ display: 'block', fontWeight: 500 }}>{label}</span>
      <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted, #6b7280)' }}>{hint}</span>
    </button>
  );

  const botaoAba = (id: Aba, label: string, Icone: typeof Eye) => (
    <button
      type="button"
      onClick={() => setAba(id)}
      disabled={id === 'fonte' && !temArtefato}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 500,
        border: '1px solid transparent',
        background: aba === id ? 'rgba(0,0,0,0.06)' : 'transparent',
        color: aba === id ? 'var(--color-text, #111827)' : 'var(--color-text-muted, #6b7280)',
        cursor: id === 'fonte' && !temArtefato ? 'not-allowed' : 'pointer',
      }}
    >
      <Icone size={13} /> {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* ── Barra do artefato ────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          // Telas estreitas (Fábrica empilhada no mobile): a barra quebra linha
          // em vez de estourar horizontalmente.
          flexWrap: 'wrap',
          padding: '8px 12px',
          borderBottom: '1px solid var(--color-border, rgba(0,0,0,0.08))',
          background: 'var(--color-surface, rgba(255,255,255,0.7))',
          backdropFilter: 'blur(8px)',
          flexShrink: 0,
          // O backdrop-filter cria um stacking context: sem z-index explícito a
          // barra (e o dropdown de download DENTRO dela) pintava ABAIXO do corpo
          // do preview, que vem depois no documento. z-30 põe a barra inteira
          // (menu incluído) acima do preview.
          position: 'relative',
          zIndex: 30,
        }}
      >
        {botaoAba('preview', 'Preview', Eye)}
        {botaoAba('fonte', 'Fonte', Code2)}

        <span style={{ fontSize: 11, color: 'var(--color-text-muted, #6b7280)', marginLeft: 4 }}>
          {temArtefato
            ? `${slideCount} slide${slideCount > 1 ? 's' : ''}${gerando ? ' · gerando…' : ''}`
            : gerando ? 'gerando…' : ''}
        </span>

        <div ref={boxRef} style={{ position: 'relative', marginLeft: 'auto' }}>
          <button
            type="button"
            onClick={() => setMenuAberto((v) => !v)}
            disabled={!podeBaixar || job !== null}
            title={podeBaixar ? 'Baixar o design' : 'Disponível assim que o primeiro slide sair'}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              border: '1px solid var(--color-border, rgba(0,0,0,0.12))',
              borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 500,
              background: 'transparent',
              cursor: !podeBaixar || job ? 'not-allowed' : 'pointer',
              opacity: !podeBaixar || job ? 0.5 : 1,
            }}
          >
            {job ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={13} />}
            {job ? `${job.formato.toUpperCase()} ${job.done}/${job.total}` : 'Baixar'}
            {!job && <ChevronDown size={12} />}
          </button>

          {menuAberto && (
            <div
              style={{
                position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 20,
                width: 'min(260px, calc(100vw - 24px))', padding: '4px 0',
                background: 'var(--color-surface, #fff)',
                border: '1px solid var(--color-border, rgba(0,0,0,0.12))',
                borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              }}
            >
              {itemMenu('PPTX editável', 'Texto, formas e imagens editáveis (PowerPoint/Canva)', () => void baixarDeck('pptx'))}
              {itemMenu('PDF do deck', 'Uma página por slide, texto de verdade', () => void baixarDeck('pdf'))}
              {itemMenu('ZIP com os PNGs', `${slideCount} imagem${slideCount > 1 ? 'ns' : ''} em alta`, () => void baixarDeck('zip'))}
              <div style={{ height: 1, background: 'var(--color-border, rgba(0,0,0,0.08))', margin: '4px 0' }} />
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
      </div>

      {erro && (
        <div style={{ padding: '6px 12px', fontSize: 12, color: '#b91c1c', background: '#fef2f2', flexShrink: 0 }}>
          {erro}
        </div>
      )}

      {/* ── Corpo: preview ou fonte ──────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
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
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                color: 'var(--color-text, #111827)',
              }}
            >
              {fonte}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
