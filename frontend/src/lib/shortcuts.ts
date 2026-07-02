export type ShortcutScope = 'global' | 'canvas';
export type ShortcutCategory = 'Geral' | 'Camadas' | 'Navegação' | 'Texto';

export interface ShortcutDef {
  id: string;
  label: string;
  category: ShortcutCategory;
  /** Each string is one binding. A binding can be:
   *  - simple combo:   "ctrl+s"
   *  - multi-modifier: "ctrl+shift+z"
   *  - sequence:       "g d"  (press g then d within SEQUENCE_TIMEOUT ms)
   */
  keys: string[];
  scope: ShortcutScope;
}

export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  // ── Geral ──
  { id: 'save',           label: 'Salvar',                category: 'Geral',     keys: ['ctrl+s'],               scope: 'global' },
  { id: 'undo',           label: 'Desfazer',              category: 'Geral',     keys: ['ctrl+z'],               scope: 'global' },
  { id: 'redo',           label: 'Refazer',               category: 'Geral',     keys: ['ctrl+y', 'ctrl+shift+z'], scope: 'global' },
  { id: 'select-all',     label: 'Selecionar tudo',       category: 'Geral',     keys: ['ctrl+a'],               scope: 'canvas' },
  { id: 'zoom-in',        label: 'Aumentar zoom',         category: 'Geral',     keys: ['ctrl+=', 'ctrl++'],     scope: 'global' },
  { id: 'zoom-out',       label: 'Diminuir zoom',         category: 'Geral',     keys: ['ctrl+-'],               scope: 'global' },
  { id: 'zoom-fit',       label: 'Zoom para caber',       category: 'Geral',     keys: ['ctrl+0'],               scope: 'global' },
  { id: 'zoom-actual',    label: 'Zoom real (1:1)',       category: 'Geral',     keys: ['ctrl+1'],               scope: 'global' },
  { id: 'copy',           label: 'Copiar',                category: 'Geral',     keys: ['ctrl+c'],               scope: 'canvas' },
  { id: 'paste',          label: 'Colar',                 category: 'Geral',     keys: ['ctrl+v'],               scope: 'canvas' },
  { id: 'cut',            label: 'Recortar',              category: 'Geral',     keys: ['ctrl+x'],               scope: 'canvas' },
  { id: 'center-h',       label: 'Centralizar na horizontal', category: 'Geral', keys: ['ctrl+shift+h'],         scope: 'canvas' },
  { id: 'center-v',       label: 'Centralizar na vertical', category: 'Geral',   keys: ['ctrl+shift+v'],         scope: 'canvas' },
  { id: 'shortcuts',      label: 'Atalhos',               category: 'Geral',     keys: ['?'],                    scope: 'canvas' },
  // ── Camadas ──
  { id: 'deselect',       label: 'Desselecionar',         category: 'Camadas',   keys: ['escape'],               scope: 'canvas' },
  { id: 'delete',         label: 'Deletar camada',        category: 'Camadas',   keys: ['delete', 'backspace'],  scope: 'canvas' },
  { id: 'duplicate',      label: 'Duplicar camada',       category: 'Camadas',   keys: ['ctrl+d'],               scope: 'canvas' },
  { id: 'zindex-forward', label: 'Trazer para frente',    category: 'Camadas',   keys: ['ctrl+]'],               scope: 'canvas' },
  { id: 'zindex-back',    label: 'Enviar para trás',      category: 'Camadas',   keys: ['ctrl+['],               scope: 'canvas' },
  { id: 'zindex-front',   label: 'Trazer para o topo',    category: 'Camadas',   keys: ['ctrl+shift+]'],         scope: 'canvas' },
  { id: 'zindex-back-all',label: 'Enviar para o fundo',   category: 'Camadas',   keys: ['ctrl+shift+['],         scope: 'canvas' },
  { id: 'toggle-visibility', label: 'Ocultar/Mostrar',    category: 'Camadas',   keys: ['ctrl+h'],               scope: 'canvas' },
  { id: 'toggle-lock',    label: 'Travar/Destravar',      category: 'Camadas',   keys: ['ctrl+shift+l'],         scope: 'canvas' },
  // ── Texto ──
  { id: 'text-bold',      label: 'Negrito',               category: 'Texto',     keys: ['ctrl+b'],               scope: 'canvas' },
  { id: 'text-italic',    label: 'Itálico',               category: 'Texto',     keys: ['ctrl+i'],               scope: 'canvas' },
  { id: 'text-underline', label: 'Sublinhado',            category: 'Texto',     keys: ['ctrl+u'],               scope: 'canvas' },
  // ── Navegação ──
  { id: 'move-left',      label: 'Mover esquerda 1px',   category: 'Navegação', keys: ['arrowleft'],            scope: 'canvas' },
  { id: 'move-right',     label: 'Mover direita 1px',    category: 'Navegação', keys: ['arrowright'],           scope: 'canvas' },
  { id: 'move-up',        label: 'Mover cima 1px',       category: 'Navegação', keys: ['arrowup'],              scope: 'canvas' },
  { id: 'move-down',      label: 'Mover baixo 1px',      category: 'Navegação', keys: ['arrowdown'],            scope: 'canvas' },
  { id: 'move-left-10',   label: 'Mover esquerda 10px',  category: 'Navegação', keys: ['shift+arrowleft'],      scope: 'canvas' },
  { id: 'move-right-10',  label: 'Mover direita 10px',   category: 'Navegação', keys: ['shift+arrowright'],     scope: 'canvas' },
  { id: 'move-up-10',     label: 'Mover cima 10px',      category: 'Navegação', keys: ['shift+arrowup'],        scope: 'canvas' },
  { id: 'move-down-10',   label: 'Mover baixo 10px',     category: 'Navegação', keys: ['shift+arrowdown'],      scope: 'canvas' },
];

// ── Key normalisation ────────────────────────────────────────────────────────

/** Convert a KeyboardEvent into a canonical combo string, e.g. "ctrl+shift+z". */
export function normalizeKeyEvent(e: KeyboardEvent): string | null {
  const key = e.key.toLowerCase();
  if (['control', 'meta', 'alt', 'shift', 'os', 'dead'].includes(key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey && key !== 'shift') parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

const KEY_LABEL: Record<string, string> = {
  ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt',
  arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓',
  delete: 'Del', backspace: '⌫', escape: 'Esc', enter: '↵',
  tab: '⇥', ' ': 'Space', 'pageup': 'PgUp', 'pagedown': 'PgDn',
};

/** Converts "ctrl+shift+z" → ['Ctrl','Shift','Z'] or "g d" → ['G','→','D'] */
export function formatKeyParts(binding: string): string[] {
  const parts = binding.split(' ');
  if (parts.length > 1) {
    // sequence
    return parts.flatMap((part, i) => [
      ...formatSingleCombo(part),
      ...(i < parts.length - 1 ? ['›'] : []),
    ]);
  }
  return formatSingleCombo(parts[0]);
}

function formatSingleCombo(combo: string): string[] {
  return combo.split('+').map((k) => KEY_LABEL[k] ?? k.toUpperCase());
}

// ── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'editor-shortcuts-v1';

export function loadShortcuts(): ShortcutDef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SHORTCUTS;
    const saved: ShortcutDef[] = JSON.parse(raw);
    // Merge: keep user keys for known ids, add new defaults for unknown ids
    const savedMap = new Map(saved.map((s) => [s.id, s]));
    return DEFAULT_SHORTCUTS.map((def) =>
      savedMap.has(def.id) ? { ...def, keys: savedMap.get(def.id)!.keys } : def
    );
  } catch {
    return DEFAULT_SHORTCUTS;
  }
}

export function saveShortcuts(shortcuts: ShortcutDef[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcuts));
}

export function resetShortcuts(): ShortcutDef[] {
  localStorage.removeItem(STORAGE_KEY);
  return DEFAULT_SHORTCUTS;
}
