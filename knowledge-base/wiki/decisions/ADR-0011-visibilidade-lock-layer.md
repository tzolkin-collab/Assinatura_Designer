---
name: ADR-0011-visibilidade-lock-layer
description: Implementar toggle de visibilidade (👁) e lock (🔒) por camada no editor
metadata:
  type: decision
  status: proposed
  priority: importante
  created: 2026-06-27
---

# ADR-0011 — Visibilidade e Lock de Camada

## Contexto

Não existe como esconder ou travar uma camada sem deletá-la. Em designs complexos (10+ layers), layers de fundo são frequentemente movidas acidentalmente, e layers de rascunho precisam ser ocultadas sem exclusão.

## Problema

- Layers de fundo (cor, imagem) são as mais movidas acidentalmente.
- Ocultar uma layer temporariamente exige deletar e recriar.
- Profissionais de design não aceitam editor sem visibilidade e lock.

## Decisão

### Modelo de dados

```typescript
interface Layer {
  visible?: boolean;  // undefined = true
  locked?: boolean;   // undefined = false
}
```

### Comportamento de `visible: false`

- Layer **não é renderizada** no canvas visual (CanvasEditor).
- Layer **não é exportada** no PNG (htmlRaster e CanvasEditor).
- Layer **aparece no LayerListPanel** (ADR-0006) com opacidade 40% e ícone de olho fechado.
- Shortcut `Ctrl+H` (hide): toggle `visible` das layers selecionadas.

### Comportamento de `locked: true`

- Layer **é renderizada** e visível.
- `Rnd` **não dispara drag/resize** (verificar `e.preventDefault()` no `onDragStart`).
- **Não é selecionável** pelo click no canvas (click passa para layer abaixo).
- **Ainda selecionável** pelo LayerListPanel (click na row).
- TransformPanel fica em modo read-only quando layer está locked.

### Toggle

Implementado no `LayerListPanel` (ADR-0006). Também acessível via menu contextual (`···`).

### Atalhos

| Ação | Shortcut |
|---|---|
| Toggle visibilidade | `Ctrl+H` |
| Toggle lock | `Ctrl+Shift+L` |

## Arquivos afetados

- `frontend/src/components/Fabrica/DesignRenderer.tsx` (type `Layer`)
- `frontend/src/components/Editor/CanvasEditor.tsx` (checar visible/locked no render e drag)
- `frontend/src/components/Editor/LayerListPanel.tsx` (ADR-0006)
- `frontend/src/lib/shortcuts.ts`

**Why:** Lock de layer de fundo é proteção básica que evita os acidentes mais comuns de edição.
**How to apply:** Implementar junto com ADR-0006 (Layer List Panel) — os controles ficam no mesmo componente.
