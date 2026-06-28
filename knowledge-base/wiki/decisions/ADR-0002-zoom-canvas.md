---
name: ADR-0002-zoom-canvas
description: Implementar zoom in/out/fit no canvas do editor com Ctrl+scroll e botões de controle
metadata:
  type: decision
  status: implemented
  priority: crítico
  created: 2026-06-27
  implemented: 2026-06-27
---

# ADR-0002 — Zoom do Canvas no Editor

## Contexto

O `CanvasEditor.tsx` auto-calcula um `scale` baseado no `ResizeObserver` do container (linha ~57): o canvas sempre cabe na área disponível. Não há como o usuário ampliar para trabalhar em detalhes ou recuar para ver o todo.

```typescript
// atual: scale é read-only, calculado automaticamente
const obs = new ResizeObserver(([entry]) => {
  setScale(entry.contentRect.width / canvasWidth);
});
```

## Problema

- Trabalhar em textos pequenos ou alinhamentos precisos é impossível sem zoom.
- Inconsistente com qualquer editor visual (Figma, Canva, Photoshop).
- O `scale` calculado automaticamente serve como "fit" (zoom 0), mas o usuário precisa de níveis maiores.

## Decisão

Separar `fitScale` (auto-calculado) de `userZoom` (multiplicador do usuário):

```typescript
// scale efetivo = fitScale * userZoom
const effectiveScale = fitScale * userZoom;
```

### Controles a implementar

| Ação | Trigger |
|---|---|
| Zoom in | Ctrl+scroll up **ou** botão `+` |
| Zoom out | Ctrl+scroll down **ou** botão `−` |
| Zoom to fit (100% visual) | Ctrl+0 **ou** botão `⊡` |
| Zoom to actual size (1:1) | Ctrl+1 |

### Níveis de zoom

Steps: `[25, 50, 75, 100, 125, 150, 200, 300, 400]%` relativos ao fitScale.

### UI

Badge no canto inferior direito do canvas mostrando `"75%"` (percentual do fitScale×userZoom). Clicável para resetar.

### Pan

Com zoom > 100%, o canvas pode sair da área de view. Adicionar **pan com Space+drag** (cursor muda para mão).

## Alternativas consideradas

- **Transform CSS + `transform-origin`**: mais simples mas pode causar bugs com `Rnd` (que usa posições absolutas). Preferível manter a abordagem de `scale` já usada.
- **ScrollArea wrapping**: scrollbar nativa — mais simples para pan, mas menos controle visual.

## Consequências

- `CanvasEditor` recebe props `zoom` e `onZoomChange` do editor pai.
- `Rnd` continua funcionando pois `toCanvasPos` já divide por `scale` — apenas atualizar para usar `effectiveScale`.
- Adicionar shortcut `ctrl+=` e `ctrl+-` em `shortcuts.ts`.

## Arquivos afetados

- `frontend/src/components/Editor/CanvasEditor.tsx`
- `frontend/src/lib/shortcuts.ts` (adicionar zoom shortcuts)
- `frontend/src/app/[marca]/editor/[postId]/page.tsx`
- Novo componente: `frontend/src/components/Editor/ZoomControls.tsx`

**Why:** Sem zoom não é possível fazer ajustes finos. É a feature mais bloqueante para trabalho de detalhes.
**How to apply:** Implementar junto com ADR-0001 (add layer) pois ambos são da barra de controle do editor.

## Implementação (2026-06-27)

- `CanvasEditor.tsx` reescrito: separa `fitScale` (auto, `ResizeObserver`) de `userZoom` (multiplicador do usuário); `effectiveScale = fitScale * userZoom`. `toCanvasPos`, `transform` do canvas, `Rnd scale` e overlay de marquee passaram a usar `effectiveScale` + offset de `pan`.
- Steps `[25,50,75,100,125,150,200,300,400]%` relativos ao fit. Ctrl+scroll/pinça faz zoom em direção ao cursor (`applyZoom` com foco). Pan com **Space+drag** (cursor grab/grabbing), com `clampPan` que centraliza no eixo menor e impede arrastar para fora.
- Exposto via `useImperativeHandle` (`CanvasEditorHandle`): `zoomIn/zoomOut/zoomFit/zoomActual`. A página liga aos atalhos.
- Novos atalhos em `shortcuts.ts` (`zoom-in` Ctrl+= / Ctrl++, `zoom-out` Ctrl+-, `zoom-fit` Ctrl+0, `zoom-actual` Ctrl+1) — `useShortcutHandler` já dá `preventDefault`, sobrescrevendo o zoom nativo do browser.
- Novo componente `ZoomControls.tsx` (badge inferior-direito com −/%/+/⊡; o % e o ⊡ resetam para o fit).
- Reset de zoom/pan ao trocar de post via `key={W}x{H}` no `<CanvasEditor>` (evita `setState` em effect, proibido pelo lint do Next 16).

**Arquivos:** `CanvasEditor.tsx` (reescrito), `ZoomControls.tsx` (novo), `lib/shortcuts.ts`, `app/[marca]/editor/[postId]/page.tsx`.
