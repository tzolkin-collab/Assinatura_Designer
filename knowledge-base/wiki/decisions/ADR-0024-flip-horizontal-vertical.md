---
name: ADR-0024-flip-horizontal-vertical
description: Adicionar toggle de flip horizontal e vertical por camada
metadata:
  type: decision
  status: proposed
  priority: nice-to-have
  created: 2026-06-27
---

# ADR-0024 — Flip Horizontal e Vertical de Camada

## Contexto

Espelhar um elemento horizontalmente é um ajuste comum em design — especialmente para ícones, setas e fotos onde a direção visual importa para a composição.

## Problema

- Inverter uma imagem requer edição externa ou usar `transform: scaleX(-1)` manualmente.
- Sem flip, o designer fica preso à orientação original do asset.

## Decisão

### Campos no tipo Layer

```typescript
interface Layer {
  flipX?: boolean; // default false — espelha horizontalmente
  flipY?: boolean; // default false — espelha verticalmente
}
```

### CSS gerado em layerStyle.ts

```typescript
const scaleX = layer.flipX ? -1 : 1;
const scaleY = layer.flipY ? -1 : 1;
const rotate = layer.rotation ? `rotate(${layer.rotation}deg)` : '';
styles.transform = `${rotate} scale(${scaleX}, ${scaleY})`.trim();
```

Atenção: combinar com `rotation` existente. Garantir que a ordem de transformações seja `rotate → scale`.

### UI no TransformPanel (abaixo de Rotação)

```
Espelhar:  [↔ H] [↕ V]   ← toggle buttons
```

Botões com ícones `FlipHorizontal` / `FlipVertical` (lucide-react).

## Arquivos afetados

- `frontend/src/components/Fabrica/DesignRenderer.tsx` (type Layer)
- `frontend/src/components/Editor/panels/TransformPanel.tsx`
- `frontend/src/lib/layerStyle.ts`

**Why:** Flip é uma operação de 2 campos booleanos. Baixíssimo custo de implementação, alto valor para ícones e setas.
**How to apply:** Implementar junto com outras extensões do TransformPanel (ADR-0008, ADR-0016).
