'use client';

import { useRef, useEffect, useState } from 'react';
import HtmlSlideRenderer from '@/components/DesignDocument/HtmlSlideRenderer';
import Button from '@/components/ui/Button';
import { api } from '@/lib/api';
import type { HtmlDesignPostContent } from '@/lib/designContent';

type ChatMsg = { role: 'user' | 'ai'; text: string; error?: boolean };

interface HtmlEditorProps {
  postId: string;
  content: HtmlDesignPostContent;
  onContentChange: (c: HtmlDesignPostContent) => void;
}

const SUGGESTIONS = [
  'Deixe o título maior',
  'Troque a cor de destaque',
  'Mais respiro / menos cheio',
  'Troque a foto',
];

export default function HtmlEditor({ postId, content, onContentChange }: HtmlEditorProps) {
  const [activeSlide, setActiveSlide] = useState(0);
  const [instruction, setInstruction] = useState('');
  const [editing, setEditing] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [isolateSlide, setIsolateSlide] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, editing]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || editing) return;
    const slideAtSend = activeSlide;
    setEditing(true);
    setMessages((m) => [...m, { role: 'user', text: trimmed }]);
    setInstruction('');
    try {
      const resp = await api.post<
        { slideIndex: number; slide: { html: string; css?: string } },
        { slideIndex: number; instruction: string; isolate: boolean }
      >(`/posts/${postId}/edit-slide`, { slideIndex: slideAtSend, instruction: trimmed, isolate: isolateSlide });
      const slides = content.slides.slice();
      slides[resp.slideIndex] = resp.slide;
      onContentChange({ ...content, slides });
      setMessages((m) => [...m, { role: 'ai', text: `Pronto — slide ${resp.slideIndex + 1} atualizado.` }]);
    } catch {
      setMessages((m) => [...m, { role: 'ai', text: 'Não consegui aplicar isso. Tenta reformular o pedido?', error: true }]);
    } finally {
      setEditing(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 16, width: '100%', height: '100%', minHeight: 540 }}>
      {/* ── Chat ─────────────────────────────────────────────── */}
      <div style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 14, overflow: 'hidden', background: 'var(--color-bg-secondary, #fff)' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(0,0,0,0.08)', fontWeight: 600, fontSize: 14 }}>
          Editar com IA <span style={{ color: 'var(--color-text-tertiary, #999)', fontWeight: 400 }}>· slide {activeSlide + 1}</span>
        </div>

        <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,0.02)' }}>
          <input
            type="checkbox"
            id="isolate-slide"
            checked={isolateSlide}
            onChange={(e) => setIsolateSlide(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <label htmlFor="isolate-slide" style={{ cursor: 'pointer', userSelect: 'none', fontSize: 12, color: 'var(--color-text-secondary, #555)' }}>
            Editar Slide Isolado (Seguro)
          </label>
        </div>

        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary, #777)', lineHeight: 1.6 }}>
              Diga em português o que mudar <strong>neste slide</strong>. A IA ajusta só o que você pedir e preserva o resto.
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '88%',
                padding: '8px 12px',
                borderRadius: 12,
                fontSize: 13,
                lineHeight: 1.45,
                background: m.role === 'user' ? '#171717' : m.error ? '#fde8e8' : '#f1f1f1',
                color: m.role === 'user' ? '#fff' : m.error ? '#a12' : '#222',
              }}
            >
              {m.text}
            </div>
          ))}
          {editing && (
            <div style={{ alignSelf: 'flex-start', fontSize: 13, color: 'var(--color-text-tertiary, #999)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="dot-pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: '#FF6B35', display: 'inline-block', animation: 'htmlEditPulse 1s infinite' }} />
              Editando o slide {activeSlide + 1}…
            </div>
          )}
        </div>

        {messages.length === 0 && (
          <div style={{ padding: '0 12px 8px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                disabled={editing}
                style={{ fontSize: 12, padding: '5px 10px', borderRadius: 999, border: '1px solid rgba(0,0,0,0.15)', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-secondary, #555)' }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div style={{ padding: 12, borderTop: '1px solid rgba(0,0,0,0.08)', display: 'flex', gap: 8 }}>
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(instruction); } }}
            disabled={editing}
            placeholder="Descreva o ajuste…"
            style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.15)', fontSize: 13, minWidth: 0 }}
          />
          <Button onClick={() => send(instruction)} disabled={editing || !instruction.trim()}>
            {editing ? '…' : 'Enviar'}
          </Button>
        </div>
      </div>

      {/* ── Preview + thumbnails ─────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', minHeight: 0 }}>
          <div style={{ width: '100%', maxWidth: 580, opacity: editing ? 0.6 : 1, transition: 'opacity 0.2s' }}>
            <HtmlSlideRenderer content={content} activeSlide={activeSlide} onSlideChange={setActiveSlide} hideNav />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          {content.slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setActiveSlide(i)}
              title={`Slide ${i + 1}`}
              style={{
                width: 68,
                aspectRatio: `${content.width} / ${content.height}`,
                borderRadius: 8,
                overflow: 'hidden',
                border: i === activeSlide ? '2px solid #FF6B35' : '1px solid rgba(0,0,0,0.15)',
                padding: 0,
                cursor: 'pointer',
                background: '#000',
                position: 'relative',
              }}
            >
              <HtmlSlideRenderer content={content} activeSlide={i} hideNav mode="cover" />
              <span style={{ position: 'absolute', bottom: 2, right: 4, fontSize: 10, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>{i + 1}</span>
            </button>
          ))}
        </div>
      </div>

      <style>{`@keyframes htmlEditPulse { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }`}</style>
    </div>
  );
}
