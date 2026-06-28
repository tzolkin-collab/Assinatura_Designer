---
name: ADR-0010-atalhos-faltantes
description: Adicionar Ctrl+A (selecionar tudo), Ctrl+B (bold), Ctrl+I (itálico), Ctrl+Shift+]/[ (frente/fundo total) aos shortcuts
metadata:
  type: decision
  status: proposed
  priority: importante
  created: 2026-06-27
---

# ADR-0010 — Atalhos de Teclado Faltantes

## Contexto

`shortcuts.ts` tem os atalhos básicos mas faltam os mais universais de edição de texto e seleção. Alguns existem como botões de UI mas não têm atalho de teclado.

## Problema

- `Ctrl+A` (selecionar tudo) não está mapeado — operação mais comum de seleção múltipla.
- `Ctrl+B` (bold) e `Ctrl+I` (itálico) existem como botões mas não como shortcuts.
- `Ctrl+Shift+]` / `Ctrl+Shift+[` (trazer para frente totalmente / enviar para trás totalmente) — só existe step-by-step.

## Decisão

### Novos shortcuts a adicionar em `shortcuts.ts`

```typescript
// Geral
{ id: 'select-all',       label: 'Selecionar tudo',          keys: ['ctrl+a'],              scope: 'canvas' },

// Camadas  
{ id: 'zindex-front',     label: 'Trazer para frente (tudo)', keys: ['ctrl+shift+]'],        scope: 'canvas' },
{ id: 'zindex-back-all',  label: 'Enviar para trás (tudo)',   keys: ['ctrl+shift+['],        scope: 'canvas' },

// Texto (scope: canvas, mas ativo apenas quando layer texto selecionada)
{ id: 'text-bold',        label: 'Negrito',                   keys: ['ctrl+b'],              scope: 'canvas' },
{ id: 'text-italic',      label: 'Itálico',                   keys: ['ctrl+i'],              scope: 'canvas' },
{ id: 'text-underline',   label: 'Sublinhado',                keys: ['ctrl+u'],              scope: 'canvas' },
```

### Implementação por shortcut

**`select-all`**: `onLayerSelect(null)` + selecionar todas as layers → `setSelectedLayerIds(layers.map(l => l.id))`.

**`zindex-front`**: `onChange({ zIndex: Math.max(...layers.map(l => l.zIndex ?? 0)) + 1 })`.

**`zindex-back-all`**: `onChange({ zIndex: Math.min(...layers.map(l => l.zIndex ?? 0)) - 1 })`.

**`text-bold`**: Só ativo quando layer selecionada tem `type === 'text'`. Toggle `fontWeight` entre `'bold'` e `'normal'`.

**`text-italic`**: Toggle `italic` (já existe no TextPanel).

**`text-underline`**: Toggle `textDecoration` entre `'underline'` e `'none'`.

### Conflito com `<textarea>` focado

Ctrl+B/I/U dentro de um textarea de conteúdo de texto devem **não** acionar o shortcut (o browser usa para navegação). O `useShortcutHandler` já verifica `e.target` — garantir que `INPUT` e `TEXTAREA` escapam esses shortcuts.

## Arquivos afetados

- `frontend/src/lib/shortcuts.ts`
- `frontend/src/hooks/useShortcutHandler.ts`
- `frontend/src/app/[marca]/editor/[postId]/page.tsx`

**Why:** Ctrl+A, Ctrl+B, Ctrl+I são os atalhos mais memorizados por qualquer pessoa que usa computador. Sua ausência é imediatamente notada.
**How to apply:** Mudança isolada em shortcuts.ts + handler — baixo risco, alto impacto.
