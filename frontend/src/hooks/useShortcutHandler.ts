'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  type ShortcutDef,
  loadShortcuts,
  saveShortcuts,
  resetShortcuts,
  normalizeKeyEvent,
  DEFAULT_SHORTCUTS,
} from '@/lib/shortcuts';

const SEQUENCE_TIMEOUT_MS = 800;

function isTyping(): boolean {
  const el = document.activeElement;
  return (
    el instanceof HTMLElement &&
    (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
      el.isContentEditable)
  );
}

/** Returns true if the current buffer tail matches a space-separated sequence binding. */
function matchesBinding(buffer: string[], binding: string): boolean {
  const parts = binding.split(' ');
  if (parts.length === 1) {
    // Simple combo: just check the last key
    return buffer[buffer.length - 1] === binding;
  }
  // Sequence: check that the last N entries of the buffer match in order
  if (buffer.length < parts.length) return false;
  const tail = buffer.slice(-parts.length);
  return tail.every((k, i) => k === parts[i]);
}

export interface UseShortcutHandlerReturn {
  shortcuts: ShortcutDef[];
  updateShortcut: (id: string, keys: string[]) => void;
  resetAll: () => void;
}

/**
 * Registers keyboard shortcuts and returns config helpers.
 *
 * @param actions - Map of shortcut id → handler. Handlers are always read
 *   fresh via ref, so they can be defined inline without deps issues.
 */
export function useShortcutHandler(
  actions: Record<string, () => void>
): UseShortcutHandlerReturn {
  const [shortcuts, setShortcuts] = useState<ShortcutDef[]>(() => loadShortcuts());

  // Always-current refs — no need for re-registering the listener on every render
  const shortcutsRef = useRef(shortcuts);
  const actionsRef = useRef(actions);

  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

  // Key sequence buffer: [{ combo, time }]
  const bufferRef = useRef<{ combo: string; time: number }[]>([]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const combo = normalizeKeyEvent(e);
      if (!combo) return; // pure modifier press

      const now = Date.now();

      // Prune stale entries from the buffer
      bufferRef.current = bufferRef.current.filter(
        (b) => now - b.time < SEQUENCE_TIMEOUT_MS
      );
      bufferRef.current.push({ combo, time: now });

      const buffer = bufferRef.current.map((b) => b.combo);
      const typing = isTyping();

      for (const shortcut of shortcutsRef.current) {
        // Skip canvas-only shortcuts when the user is typing
        if (shortcut.scope === 'canvas' && typing) continue;

        for (const binding of shortcut.keys) {
          if (matchesBinding(buffer, binding)) {
            const handler = actionsRef.current[shortcut.id];
            if (handler) {
              e.preventDefault();
              handler();
              bufferRef.current = []; // reset buffer after a match
            }
            return;
          }
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []); // intentionally empty — reads via refs

  const updateShortcut = useCallback((id: string, keys: string[]) => {
    setShortcuts((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, keys } : s));
      saveShortcuts(next);
      return next;
    });
  }, []);

  const resetAll = useCallback(() => {
    const defaults = resetShortcuts();
    setShortcuts(defaults);
  }, []);

  return { shortcuts, updateShortcut, resetAll };
}

// ── Recording helper (used by the config UI) ─────────────────────────────────

export interface RecordingResult {
  /** Call this to start recording; returns a cleanup function. */
  start: (onCapture: (combo: string) => void) => () => void;
}

/**
 * Returns a `start(onCapture)` function that captures the NEXT key
 * press (excluding pure modifiers) and calls `onCapture` with the
 * normalised combo string. The caller must call the returned cleanup.
 */
export function useKeyRecorder(): RecordingResult {
  const start = useCallback((onCapture: (combo: string) => void): (() => void) => {
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const combo = normalizeKeyEvent(e);
      if (!combo) return; // skip pure modifier press
      onCapture(combo);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, []);

  return { start };
}

export { DEFAULT_SHORTCUTS };
