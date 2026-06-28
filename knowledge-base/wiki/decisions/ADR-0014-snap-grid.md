---
name: ADR-0014-snap-grid
description: Implementar snap to grid e snap to other layers durante drag no canvas
metadata:
  type: decision
  status: proposed
  priority: desejável
  created: 2026-06-27
---

# ADR-0014 — Snap to Grid e Snap to Layers

## Contexto

O `Rnd` component permite drag livre. Sem snap, alinhar elementos manualmente requer muita precisão manual ou uso constante do TransformPanel com valores numéricos.

## Problema

- Alinhar dois elementos visualmente sem snap resulta em offsets de 1-3px que só aparecem na exportação.
- Profissionais de design dependem de snap para trabalho rápido.

## Decisão

### Snap to Grid

**Grid de 8px** (sistema 8pt, padrão de design de UI/social).

Toggle via botão na toolbar do editor (ou `Ctrl+Shift+G`).

Com snap ativo, durante o drag do `Rnd`, o `onDrag` calcula:
```typescript
const snappedX = Math.round(x / gridSize) * gridSize;
const snappedY = Math.round(y / gridSize) * gridSize;
```

### Overlay de Grid

Quando snap ativo, exibir grid visual como overlay CSS no canvas:
```css
background-image: repeating-linear-gradient(...)
```
Transparente o suficiente para não poluir (10% opacity, cor neutra).

### Snap to Layers

Durante drag de uma layer, detectar proximidade (threshold: 6px no espaço canvas) com bordas e centros das outras layers. Exibir linha guia vermelha/azul quando snap acontece.

```typescript
function getSnapTargets(movingLayer: Layer, otherLayers: Layer[]): SnapLine[] {
  // retorna linhas H/V a X ou Y fixos com threshold de 6px
}
```

Implementar como função separada — pode ser desativado independente do snap de grid.

### Prioridade de snap

Grid > Layers (layers ganham se dentro do threshold de ambos).

### Ativar/Desativar

- Segmented control na toolbar: `[Grid 8px] [Layers] [Ambos] [Off]`
- Persiste em `localStorage`.
- `Alt` durante drag: desativa snap temporariamente (override).

## Alternativas consideradas

- **Grid de 4px**: mais preciso mas mais rápido de desalinhar acidentalmente para textos.
- **Grid configurável**: adiciona complexidade desnecessária agora.

## Arquivos afetados

- `frontend/src/components/Editor/CanvasEditor.tsx`
- Novo: `frontend/src/components/Editor/SnapEngine.ts`
- `frontend/src/app/[marca]/editor/[postId]/page.tsx`

**Why:** Snap é a diferença entre "parece alinhado" e "está alinhado". Elimina ajustes manuais de posição.
**How to apply:** Implementar após zoom (ADR-0002) pois snap precisa considerar o scale do canvas.
