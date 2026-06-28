---
name: ADR-0008-lock-proporcao
description: Adicionar toggle de lock de proporção (aspect ratio) no TransformPanel e no resize via Rnd
metadata:
  type: decision
  status: proposed
  priority: importante
  created: 2026-06-27
---

# ADR-0008 — Lock de Proporção (Aspect Ratio) no Resize

## Contexto

`TransformPanel.tsx` exibe Largura e Altura como campos independentes. O `Rnd` component permite resize livre pelas handles. Ao redimensionar uma imagem ou logo, manter a proporção é obrigatório para não distorcer.

## Problema

- Redimensionar uma imagem pelo painel numérico distorce sem aviso.
- Figma e Canva têm cadeado de proporção como controle padrão.
- Imagens e logos são os elementos mais afetados.

## Decisão

### No TransformPanel

Cadeado entre os campos W e H:

```
Largura  [   400  px]
    🔓              ← clica para travar
Altura   [   300  px]
```

Quando 🔒 travado:
- Editar W recalcula H: `newH = W_novo * (originalH / originalW)`
- Editar H recalcula W: `newW = H_novo * (originalW / originalH)`

O ratio é capturado no momento em que o cadeado é ativado.

### No CanvasEditor (Rnd)

`Rnd` tem prop `lockAspectRatio`. Mas é global — precisamos controle por layer.

Solução: passar `lockAspectRatio={layer.lockAspectRatio ?? false}` para cada `Rnd`. O toggle no painel atualiza `layer.lockAspectRatio`.

### Estado do lock

```typescript
interface Layer {
  lockAspectRatio?: boolean; // default false
}
```

Persistido no content do Post (JSON), mantido entre sessões.

### Shift+drag

Comportamento padrão: Shift pressionado durante resize no canvas ativa proporção temporariamente (sem alterar `lockAspectRatio`). Implementado via `onResizeStart` + checar `e.shiftKey`.

## Arquivos afetados

- `frontend/src/components/Editor/panels/TransformPanel.tsx`
- `frontend/src/components/Editor/CanvasEditor.tsx`
- `frontend/src/components/Fabrica/DesignRenderer.tsx` (type `Layer`)

**Why:** Distorcer logos e imagens é o erro mais comum e visível em posts. O lock de proporção é proteção básica.
**How to apply:** Fácil de implementar isoladamente; não depende de outros ADRs.
