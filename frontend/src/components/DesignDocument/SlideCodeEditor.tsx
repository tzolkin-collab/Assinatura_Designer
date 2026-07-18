'use client';

// O CÓDIGO do slide como superfície de edição — a mesma primitiva da IA.
//
// O slide é um arquivo html/css; a IA edita esse arquivo (editHtmlSlide) e o
// humano edita AQUI. Os dois convergem no mesmo endpoint sanitizado
// (PUT /posts/:id/slides/:idx/code — DOMPurify no servidor, versão snapshotada
// antes). Usado pela aba Fonte da Fábrica e pelo editor.

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, RotateCcw, Save } from 'lucide-react';
import { api, getApiErrorMessage } from '@/lib/api';

export interface SlideCode {
  html: string;
  css?: string;
}

interface SlideCodeEditorProps {
  postId: string;
  slideIndex: number;
  slide: SlideCode;
  /** Chamado com o slide SANITIZADO devolvido pelo servidor. */
  onSaved: (slideIndex: number, slide: SlideCode) => void;
  /** Altura máxima de cada área de código (px). */
  maxAreaHeight?: number;
}

const areaStyle: React.CSSProperties = {
  width: '100%',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 12,
  lineHeight: 1.5,
  padding: 10,
  borderRadius: 8,
  border: '1px solid var(--color-border, rgba(0,0,0,0.12))',
  background: 'var(--color-bg-secondary, #fafafa)',
  color: 'var(--color-text, #111827)',
  resize: 'vertical',
  whiteSpace: 'pre',
};

export default function SlideCodeEditor({ postId, slideIndex, slide, onSaved, maxAreaHeight = 260 }: SlideCodeEditorProps) {
  const [html, setHtml] = useState(slide.html);
  const [css, setCss] = useState(slide.css ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Troca de slide (ou conteúdo novo vindo do servidor/IA): recarrega os drafts.
  // A chave slideIndex+postId garante que edições sujas de um slide não vazam
  // para outro; edição suja do MESMO slide é preservada (deps não incluem slide
  // de propósito quando dirty — simplicidade: recarrega sempre que o pai mudar
  // o conteúdo, que é o comportamento correto pós-IA/pós-restauração).
  useEffect(() => {
    setHtml(slide.html);
    setCss(slide.css ?? '');
    setErro(null);
    setSaved(false);
  }, [postId, slideIndex, slide.html, slide.css]);

  const dirty = html !== slide.html || css !== (slide.css ?? '');

  const salvar = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setErro(null);
    try {
      const { slide: cleanSlide } = await api.put<{ slideIndex: number; slide: SlideCode }>(
        `/posts/${postId}/slides/${slideIndex}/code`,
        { html, css: css.trim() ? css : undefined },
      );
      onSaved(slideIndex, cleanSlide);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErro(getApiErrorMessage(e, 'Não consegui salvar o código.'));
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, postId, slideIndex, html, css, onSaved]);

  const atalho = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      void salvar();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} onKeyDown={atalho}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Código do slide {slideIndex + 1}</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted, #6b7280)' }}>
          sanitizado no servidor · Ctrl+S salva · versão criada antes de cada save
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={() => { setHtml(slide.html); setCss(slide.css ?? ''); setErro(null); }}
            disabled={!dirty || saving}
            title="Descartar alterações não salvas"
            style={{
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '5px 10px',
              borderRadius: 8, border: '1px solid var(--color-border, rgba(0,0,0,0.12))',
              background: 'transparent', cursor: dirty && !saving ? 'pointer' : 'not-allowed',
              opacity: dirty && !saving ? 1 : 0.45,
            }}
          >
            <RotateCcw size={12} /> Descartar
          </button>
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={!dirty || saving}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600,
              padding: '5px 12px', borderRadius: 8, border: 'none',
              background: dirty ? 'var(--color-brand, #FF6B35)' : 'rgba(0,0,0,0.08)',
              color: dirty ? '#fff' : 'var(--color-text-muted, #6b7280)',
              cursor: dirty && !saving ? 'pointer' : 'not-allowed',
            }}
          >
            {saving ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : saved ? <Check size={12} /> : <Save size={12} />}
            {saving ? 'Salvando…' : saved ? 'Salvo' : 'Salvar código'}
          </button>
        </div>
      </div>

      {erro && (
        <div style={{ fontSize: 12, color: '#b91c1c', background: '#fef2f2', borderRadius: 8, padding: '6px 10px' }}>{erro}</div>
      )}

      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted, #6b7280)' }}>CSS</label>
      <textarea
        value={css}
        onChange={(e) => setCss(e.target.value)}
        spellCheck={false}
        style={{ ...areaStyle, minHeight: 120, maxHeight: maxAreaHeight }}
        aria-label={`CSS do slide ${slideIndex + 1}`}
      />

      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted, #6b7280)' }}>HTML</label>
      <textarea
        value={html}
        onChange={(e) => setHtml(e.target.value)}
        spellCheck={false}
        style={{ ...areaStyle, minHeight: 160, maxHeight: maxAreaHeight }}
        aria-label={`HTML do slide ${slideIndex + 1}`}
      />
    </div>
  );
}
