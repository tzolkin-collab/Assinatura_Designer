'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Code2, Copy, Download, Eye, Loader2 } from 'lucide-react';
import { baixarIrJson, baixarSlide, exportarDeck, type DeckFileFormat } from '@/lib/deckFile';
import { getApiErrorMessage } from '@/lib/api';

interface ArtifactPanelProps {
  /** Envelope do design (ir-design/html-design). `undefined` = nada gerado ainda. */
  design?: unknown;
  /** Existe assim que o primeiro slide é persistido — antes do fim da geração. */
  postId?: string;
  slideIndex: number;
  slideCount: number;
  gerando: boolean;
  /** O preview que já existia (renderer + navegação + thumbs). */
  children: ReactNode;
}

type Aba = 'preview' | 'fonte';

/** O IR do slide em foco — é o que o usuário vê na aba Fonte. */
function irDoSlide(design: unknown, index: number): unknown {
  const env = design as { ir?: { slides?: unknown[] }; slides?: unknown[] } | undefined;
  return env?.ir?.slides?.[index] ?? env?.slides?.[index] ?? null;
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
  const fonte = temArtefato ? JSON.stringify(irDoSlide(design, slideIndex), null, 2) : '';

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
          padding: '8px 12px',
          borderBottom: '1px solid var(--color-border, rgba(0,0,0,0.08))',
          background: 'var(--color-surface, rgba(255,255,255,0.7))',
          backdropFilter: 'blur(8px)',
          flexShrink: 0,
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
                width: 260, padding: '4px 0',
                background: 'var(--color-surface, #fff)',
                border: '1px solid var(--color-border, rgba(0,0,0,0.12))',
                borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              }}
            >
              {itemMenu('PDF do deck', 'Uma página por slide, texto de verdade', () => void baixarDeck('pdf'))}
              {itemMenu('ZIP com os PNGs', `${slideCount} imagem${slideCount > 1 ? 'ns' : ''} em alta`, () => void baixarDeck('zip'))}
              <div style={{ height: 1, background: 'var(--color-border, rgba(0,0,0,0.08))', margin: '4px 0' }} />
              {itemMenu('PNG deste slide', `Slide ${slideIndex + 1}`, () =>
                void comErro(() => baixarSlide(postId!, slideIndex, 'png')),
              )}
              {itemMenu('HTML deste slide', 'O documento que vira a arte', () =>
                void comErro(() => baixarSlide(postId!, slideIndex, 'html')),
              )}
              {itemMenu('JSON do design (IR)', 'A fonte do deck inteiro', () =>
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
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', flexShrink: 0 }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted, #6b7280)' }}>
                DesignIR · slide {slideIndex + 1} de {slideCount}
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
