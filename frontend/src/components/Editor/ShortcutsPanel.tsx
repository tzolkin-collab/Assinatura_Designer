'use client';

import { useState, useEffect, useRef } from 'react';
import { X, RotateCcw, Plus, Trash2, Settings2, BookOpen } from 'lucide-react';
import { type ShortcutDef, type ShortcutCategory, formatKeyParts, DEFAULT_SHORTCUTS } from '@/lib/shortcuts';
import { useKeyRecorder } from '@/hooks/useShortcutHandler';

interface Props {
  shortcuts: ShortcutDef[];
  onClose: () => void;
  onUpdate: (id: string, keys: string[]) => void;
  onResetAll: () => void;
}

const CATEGORIES: ShortcutCategory[] = ['Geral', 'Camadas', 'Navegação'];

// ── Keyboard badge ────────────────────────────────────────────────────────────

function KeyBadge({ text, dim }: { text: string; dim?: boolean }) {
  return (
    <kbd
      style={{
        fontSize: 10,
        fontFamily: 'var(--font-mono)',
        padding: '2px 6px',
        background: dim ? 'transparent' : 'var(--color-bg-secondary)',
        border: `1px solid ${dim ? 'transparent' : 'var(--color-border)'}`,
        borderRadius: 4,
        color: dim ? 'var(--color-text-tertiary)' : 'var(--color-text)',
        boxShadow: dim ? 'none' : '0 1px 0 var(--color-border)',
        whiteSpace: 'nowrap',
        lineHeight: 1.6,
      }}
    >
      {text}
    </kbd>
  );
}

function BindingDisplay({ binding }: { binding: string }) {
  const parts = formatKeyParts(binding);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      {parts.map((p, i) =>
        p === '›' ? (
          <span key={i} style={{ fontSize: 10, color: 'var(--color-text-tertiary)', margin: '0 1px' }}>›</span>
        ) : (
          <KeyBadge key={i} text={p} />
        )
      )}
    </div>
  );
}

// ── Shortcut row (config mode) ────────────────────────────────────────────────

interface RowProps {
  shortcut: ShortcutDef;
  isDefault: boolean;
  onUpdate: (keys: string[]) => void;
  onReset: () => void;
}

function ShortcutRow({ shortcut, isDefault, onUpdate, onReset }: RowProps) {
  const [recording, setRecording] = useState<number | null>(null); // index being recorded
  const [seqMode, setSeqMode] = useState(false); // sequence capture mode
  const [seqBuffer, setSeqBuffer] = useState<string[]>([]);
  const recorder = useKeyRecorder();
  const cleanupRef = useRef<(() => void) | null>(null);

  function stopRecording() {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setRecording(null);
    setSeqBuffer([]);
  }

  // Stop recording on Escape
  useEffect(() => {
    if (recording === null) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        stopRecording();
      }
    };
    window.addEventListener('keydown', handleEsc, { capture: true });
    return () => window.removeEventListener('keydown', handleEsc, { capture: true });
  }, [recording]);

  function startRecord(index: number) {
    if (recording !== null) stopRecording();
    setRecording(index);
    setSeqBuffer([]);

    if (seqMode) {
      // Sequence: capture multiple keys, commit on Enter
      const captured: string[] = [];
      const cleanup = recorder.start((combo) => {
        if (combo === 'enter') {
          if (captured.length > 0) {
            commitBinding(index, captured.join(' '));
          }
          stopRecording();
          return;
        }
        captured.push(combo);
        setSeqBuffer([...captured]);
      });
      cleanupRef.current = cleanup;
      return;
    }
    
    // Single combo: capture one key press
    const cleanup = recorder.start((combo) => {
      commitBinding(index, combo);
      stopRecording();
    });
    cleanupRef.current = cleanup;
  }

  function commitBinding(index: number, newBinding: string) {
    const next = [...shortcut.keys];
    if (index >= next.length) {
      next.push(newBinding);
      onUpdate(next);
      return;
    }
    
    next[index] = newBinding;
    onUpdate(next);
  }

  function removeBinding(index: number) {
    const next = shortcut.keys.filter((_, i) => i !== index);
    onUpdate(next.length > 0 ? next : shortcut.keys); // keep at least one
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 'var(--radius-md)',
        background: recording !== null ? 'var(--color-bg-secondary)' : 'transparent',
        transition: 'background 120ms',
      }}
    >
      {/* Label */}
      <span
        style={{
          flex: 1,
          fontSize: 12,
          color: 'var(--color-text-secondary)',
          paddingTop: 3,
          minWidth: 0,
        }}
      >
        {shortcut.label}
      </span>

      {/* Bindings */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
        {shortcut.keys.map((binding, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {recording === idx ? (
              <div
                style={{
                  fontSize: 10,
                  fontFamily: 'var(--font-mono)',
                  padding: '3px 8px',
                  background: '#fef3c7',
                  border: '1px solid #f59e0b',
                  borderRadius: 4,
                  color: '#92400e',
                  minWidth: 80,
                  textAlign: 'center',
                }}
              >
                {seqMode && seqBuffer.length > 0
                  ? seqBuffer.join(' › ') + ' › ...'
                  : seqMode
                  ? 'Digite sequência + Enter'
                  : '⬛ gravando...'}
              </div>
            ) : (
              <button
                onClick={() => startRecord(idx)}
                title="Clique para regravar"
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                <BindingDisplay binding={binding} />
              </button>
            )}

            {/* Remove binding button (only if >1 binding) */}
            {shortcut.keys.length > 1 && recording !== idx && (
              <button
                onClick={() => removeBinding(idx)}
                title="Remover atalho"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--color-text-tertiary)',
                  display: 'flex',
                  padding: 2,
                  borderRadius: 3,
                  lineHeight: 1,
                }}
              >
                <Trash2 size={9} />
              </button>
            )}
          </div>
        ))}

        {/* Add another binding */}
        {recording === null && (
          <button
            onClick={() => startRecord(shortcut.keys.length)}
            style={{
              fontSize: 10,
              color: 'var(--color-text-tertiary)',
              background: 'none',
              border: '1px dashed var(--color-border)',
              borderRadius: 4,
              padding: '1px 6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            <Plus size={9} />
            add
          </button>
        )}
      </div>

      {/* Controls: seq toggle + reset */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center', paddingTop: 2 }}>
        <button
          onClick={() => setSeqMode((v) => !v)}
          title={seqMode ? 'Modo single (desativar sequência)' : 'Modo sequência (ex: g d)'}
          style={{
            fontSize: 9,
            padding: '1px 4px',
            border: `1px solid ${seqMode ? 'var(--color-accent)' : 'var(--color-border)'}`,
            borderRadius: 3,
            background: seqMode ? 'var(--color-accent)' : 'none',
            color: seqMode ? '#fff' : 'var(--color-text-tertiary)',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
            lineHeight: 1.6,
          }}
        >
          seq
        </button>

        {!isDefault && (
          <button
            onClick={onReset}
            title="Restaurar padrão"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-tertiary)',
              display: 'flex',
              padding: 0,
            }}
          >
            <RotateCcw size={10} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

type PanelMode = 'reference' | 'config';

export default function ShortcutsPanel({ shortcuts, onClose, onUpdate, onResetAll }: Props) {
  const [mode, setMode] = useState<PanelMode>('reference');

  const defaultKeys = new Map(DEFAULT_SHORTCUTS.map((s) => [s.id, s.keys]));

  function isDefault(s: ShortcutDef): boolean {
    const def = defaultKeys.get(s.id);
    return !!def && JSON.stringify(def) === JSON.stringify(s.keys);
  }

  const resetShortcut = (id: string) => {
    const def = DEFAULT_SHORTCUTS.find((s) => s.id === id);
    if (def) onUpdate(id, def.keys);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(3px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-2xl)',
          width: 420,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 80px rgba(0,0,0,0.25)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '14px 16px',
            borderBottom: '1px solid var(--color-border)',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontWeight: 500,
              fontSize: 'var(--text-base)',
              color: 'var(--color-text)',
              flex: 1,
            }}
          >
            Atalhos de teclado
          </span>

          {/* Mode toggle */}
          <div
            style={{
              display: 'flex',
              background: 'var(--color-bg-secondary)',
              borderRadius: 'var(--radius-md)',
              padding: 2,
              gap: 2,
            }}
          >
            {([
              { id: 'reference', icon: <BookOpen size={12} />, label: 'Referência' },
              { id: 'config', icon: <Settings2 size={12} />, label: 'Configurar' },
            ] as const).map(({ id, icon, label }) => (
              <button
                key={id}
                onClick={() => setMode(id)}
                title={label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 8px',
                  fontSize: 11,
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  cursor: 'pointer',
                  background: mode === id ? 'var(--color-surface)' : 'transparent',
                  color: mode === id ? 'var(--color-text)' : 'var(--color-text-tertiary)',
                  boxShadow: mode === id ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
                  transition: 'all 120ms',
                }}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-tertiary)',
              display: 'flex',
              padding: 4,
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
          {CATEGORIES.map((cat) => {
            const catShortcuts = shortcuts.filter((s) => s.category === cat);
            if (catShortcuts.length === 0) return null;

            return (
              <div key={cat} style={{ marginBottom: 12 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--color-text-tertiary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    padding: '6px 10px 4px',
                    borderBottom: '1px solid var(--color-border)',
                    marginBottom: 4,
                  }}
                >
                  {cat}
                </div>

                {catShortcuts.map((s) =>
                  mode === 'reference' ? (
                    /* ── Reference row ── */
                    <div
                      key={s.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        padding: '5px 10px',
                      }}
                    >
                      <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                        {s.label}
                      </span>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {s.keys.map((binding, bi) => (
                          <BindingDisplay key={bi} binding={binding} />
                        ))}
                      </div>
                    </div>
                  ) : (
                    /* ── Config row ── */
                    <ShortcutRow
                      key={s.id}
                      shortcut={s}
                      isDefault={isDefault(s)}
                      onUpdate={(keys) => onUpdate(s.id, keys)}
                      onReset={() => resetShortcut(s.id)}
                    />
                  )
                )}
              </div>
            );
          })}
        </div>

        {/* Footer (config mode only) */}
        {mode === 'config' && (
          <div
            style={{
              padding: '10px 16px',
              borderTop: '1px solid var(--color-border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              Clique em um atalho para regravar · <strong>seq</strong> = sequência de teclas
            </span>
            <button
              onClick={onResetAll}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                padding: '4px 10px',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                background: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-secondary)',
              }}
            >
              <RotateCcw size={11} />
              Restaurar todos
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
