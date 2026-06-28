---
name: ADR-0028-tamanho-canvas
description: Permitir alterar as dimensões do canvas (formato) diretamente no editor
metadata:
  type: decision
  status: proposed
  priority: nice-to-have
  created: 2026-06-27
---

# ADR-0028 — Controle de Tamanho do Canvas (Formato)

## Contexto

O canvas tem dimensões fixas de 1080×1080px (quadrado). Não há UI para trocar para Story (1080×1920), Landscape (1920×1080) ou tamanhos customizados. Diferentes redes sociais exigem diferentes formatos.

## Problema

- Instagram Feed = 1080×1080 (quadrado) ✅ atual
- Instagram Story = 1080×1920 (vertical)
- LinkedIn = 1200×627 (landscape)
- Pinterest = 1000×1500 (vertical)
- Um post precisa ser adaptado para múltiplos formatos.

## Decisão

### Presets de formato

Dropdown na toolbar do editor:

```
Formato: [ Quadrado 1:1 ▾ ]
  ─── Instagram ───
  ● Quadrado 1:1         1080 × 1080
    Story / Reels 9:16   1080 × 1920
    Landscape 1.91:1     1080 × 566
  ─── LinkedIn ───
    Imagem de post        1200 × 627
    Capa do perfil        1584 × 396
  ─── Custom ───
    [  1080  ] × [  1080  ]
```

### Comportamento ao trocar de formato

**Opção A — Preservar posições absolutas**: layers ficam onde estão, canvas muda de tamanho. Pode deixar elements fora da área.

**Opção B — Escalar proporcionalmente**: layers são escaladas para o novo aspect ratio. Pode distorcer textos.

**Decisão**: Opção A como default + botão "Ajustar layers ao novo formato" que escala proporcionalmente com preview.

### Persistência

Dimensões salvas no `Post.content` junto com as layers:
```typescript
{ canvasWidth: 1080, canvasHeight: 1920, slides: [...] }
```

### Restrições

- Mínimo 400×400, máximo 4000×4000.
- Trocar de formato com undo (ADR-0027) — a mudança de canvas size entra no histórico.

## Arquivos afetados

- `frontend/src/app/[marca]/editor/[postId]/page.tsx`
- `frontend/src/components/Editor/CanvasEditor.tsx` (canvasWidth/Height props)
- `backend/src/lib/htmlRaster.ts` (viewport size)
- Novo: `frontend/src/components/Editor/CanvasSizePicker.tsx`

**Why:** Designers precisam do mesmo conteúdo em múltiplos formatos. Forçar saída via Fábrica para mudar de formato quebra o fluxo.
**How to apply:** Implementar após ADR-0002 (zoom) pois auto-fit do canvas depende das dimensões.
