---
name: ADR-0007-alinhar-ao-canvas
description: Adicionar opções de alinhamento relativas ao canvas (centralizar na página, alinhar às bordas)
metadata:
  type: decision
  status: proposed
  priority: importante
  created: 2026-06-27
---

# ADR-0007 — Alinhar ao Canvas (Centralizar na Página)

## Contexto

`MultiSelectPanel.tsx` tem alinhamento relativo à seleção (bounding box das layers selecionadas). Não há como alinhar uma layer relativa ao canvas inteiro — ex: "centralizar horizontalmente na página".

## Problema

- "Centralizar na página" é o uso mais comum de alinhamento em design social.
- Atualmente o designer calcula manualmente: X = (canvasWidth - layerWidth) / 2.
- A inconsistência com Canva/Figma é imediatamente perceptível para designers.

## Decisão

### Toggle no MultiSelectPanel

Adicionar um segmented control no topo do painel de alinhamento:

```
Alinhar em relação a: [ Seleção ] [ Canvas ]
```

Quando "Canvas" selecionado, as funções `alignLeft`, `alignCenterH`, etc. recebem o canvas como bounding box de referência:

```typescript
function alignCenterHToCanvas(layers: Layer[], canvasWidth: number): Map<...> {
  return new Map(layers.map(l => [l.id, { x: (canvasWidth - l.width) / 2 }]));
}
```

### Para seleção única

Quando apenas 1 layer está selecionada, o painel de alinhamento só faz sentido em relação ao canvas. Exibir automaticamente o modo "Canvas" e remover o toggle.

### Shortcuts adicionais

| Ação | Shortcut |
|---|---|
| Centralizar H na página | Ctrl+Shift+H |
| Centralizar V na página | Ctrl+Shift+V |

## Arquivos afetados

- `frontend/src/components/Editor/panels/MultiSelectPanel.tsx`
- `frontend/src/lib/shortcuts.ts`
- `frontend/src/app/[marca]/editor/[postId]/page.tsx` (passar `canvasWidth/Height`)

**Why:** "Centralizar na página" é a ação de alinhamento mais comum para posts de redes sociais.
**How to apply:** Implementar junto com o restante do MultiSelectPanel refactor (ADR-0006 layer list).
