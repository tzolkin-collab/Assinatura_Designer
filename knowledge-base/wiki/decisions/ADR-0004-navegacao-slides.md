---
name: ADR-0004-navegacao-slides
description: Implementar painel de thumbnails e navegação prev/next entre slides no editor de carrosséis
metadata:
  type: decision
  status: proposed
  priority: crítico
  created: 2026-06-27
---

# ADR-0004 — Navegação entre Slides no Editor (Carrossel)

## Contexto

O editor em `app/[marca]/editor/[postId]/page.tsx` edita um `Post` inteiro. Posts do tipo `CAROUSEL` têm múltiplos slides no campo `content` (array de layers por slide). Atualmente não há UI para navegar entre slides — o editor mostra apenas um slide de cada vez sem controle aparente de qual.

## Problema

- Impossível editar slide 2, 3, 4... de um carrossel sem código.
- Sem navegação, o tipo de post `CAROUSEL` é efetivamente não-editável no editor.
- Copiar elementos entre slides (ADR-0003) depende desta feature.

## Decisão

### Painel de slides (lateral esquerda)

Coluna à esquerda do canvas com thumbnails de cada slide:

```
[Slide 1] ← selecionado (borda highlight)
[Slide 2]
[Slide 3]
[+ Novo slide]
```

Cada thumbnail é um mini-canvas (scale ~10%) renderizado com `DesignRenderer` em modo read-only.

### Controles

| Ação | Trigger |
|---|---|
| Trocar slide | Click no thumbnail |
| Próximo slide | `→` (quando nenhuma camada selecionada) ou botão `▶` |
| Slide anterior | `←` (quando nenhuma camada selecionada) |
| Duplicar slide | Botão `⧉` no thumbnail (hover) |
| Deletar slide | Botão `🗑` no thumbnail (hover, com confirm) |
| Reordenar | Drag-and-drop entre thumbnails |
| Novo slide em branco | Botão `+` no final da lista |

### Estado

```typescript
const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
const currentSlide = post.content.slides[currentSlideIndex];
```

### Estrutura do content de Carousel

🟡 HIPÓTESE — verificar schema real no `Post.content`:
```typescript
// Suposta estrutura:
{ slides: Array<{ layers: Layer[], backgroundColor?: string }> }
```

Se o schema for diferente, adaptar conforme o tipo em `backend/src/agents/types.ts`.

## Alternativas consideradas

- **Abas horizontais**: mais simples mas perde previsualização — thumbnails são superiores para design.
- **Accordion**: inadequado para design visual.

## Consequências

- Editor para `type: CAROUSEL` ganha painel lateral de slides.
- Editor para `type: SINGLE_IMAGE` ou `PRESENTATION` não exibe o painel.
- Adicionar prop `slideIndex` ao `CanvasEditor`.

## Arquivos afetados

- `frontend/src/app/[marca]/editor/[postId]/page.tsx`
- Novo: `frontend/src/components/Editor/SlideThumbnailPanel.tsx`
- `frontend/src/components/Editor/CanvasEditor.tsx`

**Why:** Carrosséis são o tipo de post mais usado. Sem navegação de slides o editor não serve para o caso de uso principal.
**How to apply:** Implementar antes das features de copy-paste (ADR-0003) que dependem de cross-slide.
