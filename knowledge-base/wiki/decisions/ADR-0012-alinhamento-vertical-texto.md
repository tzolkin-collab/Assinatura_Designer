---
name: ADR-0012-alinhamento-vertical-texto
description: Adicionar alinhamento vertical (top/middle/bottom) dentro da caixa de texto
metadata:
  type: decision
  status: proposed
  priority: importante
  created: 2026-06-27
---

# ADR-0012 — Alinhamento Vertical de Texto (Top / Middle / Bottom)

## Contexto

`TextPanel.tsx` tem alinhamento horizontal (left/center/right) mas não tem alinhamento vertical dentro da caixa de texto. O CSS equivalente é `display: flex; align-items: [flex-start | center | flex-end]` no container da layer de texto.

## Problema

- Textos em botões e cards precisam de alinhamento vertical centralizado.
- A IA gera layers com conteúdo centralizado verticalmente, mas o editor não edita esse comportamento.
- `computeLayerStyle` em `layerStyle.ts` provavelmente não tem esse campo.

## Decisão

### Campo no tipo Layer

```typescript
interface Layer {
  verticalAlign?: 'top' | 'middle' | 'bottom'; // default 'top'
}
```

### UI no TextPanel

Três botões de toggle abaixo do alinhamento horizontal:

```
Alinhamento H: [  ←  ] [ ↔ ] [ → ]
Alinhamento V: [  ↑  ] [ ↕ ] [ ↓ ]
```

Ícones sugeridos: `AlignVerticalJustifyStart`, `AlignVerticalJustifyCenter`, `AlignVerticalJustifyEnd` (lucide-react).

### CSS gerado

Em `layerStyle.ts`:

```typescript
if (layer.type === 'text') {
  styles.display = 'flex';
  styles.flexDirection = 'column';
  styles.alignItems = layer.textAlign === 'center' ? 'center'
    : layer.textAlign === 'right' ? 'flex-end' : 'flex-start';
  styles.justifyContent = layer.verticalAlign === 'middle' ? 'center'
    : layer.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start';
}
```

### Atenção

A mudança no `layerStyle.ts` afeta tanto o editor quanto a exportação (htmlRaster). Verificar que layers existentes sem `verticalAlign` continuam renderizando igual (default `'top'` = `flex-start`).

## Arquivos afetados

- `frontend/src/components/Editor/panels/TextPanel.tsx`
- `frontend/src/components/Editor/panels/MultiSelectPanel.tsx` (edição em lote)
- `frontend/src/lib/layerStyle.ts`
- `frontend/src/components/Fabrica/DesignRenderer.tsx` (type Layer)

**Why:** Textos em cards, botões e badges quase sempre precisam de centralização vertical. Sem isso, o ajuste fica com padding manual.
**How to apply:** Mudança isolada — não depende de outros ADRs. Implementar junto com refactor do TextPanel.
