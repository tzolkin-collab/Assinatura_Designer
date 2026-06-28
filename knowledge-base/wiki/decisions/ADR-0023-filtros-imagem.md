---
name: ADR-0023-filtros-imagem
description: Adicionar filtros CSS (brightness, contrast, saturação, blur) no ImagePanel
metadata:
  type: decision
  status: proposed
  priority: nice-to-have
  created: 2026-06-27
---

# ADR-0023 — Filtros de Imagem (Brightness, Contrast, Saturação)

## Contexto

CSS tem `filter: brightness() contrast() saturate() blur() grayscale()` que aplicam efeitos visuais em tempo real em imagens. São comuns em tratamentos fotográficos para consistência de estilo visual da marca.

## Problema

- Fotos com diferentes exposições ficam inconsistentes no carrossel.
- Adicionar um tom mais escuro/saturado para combinar com a paleta da marca requer pós-edição externa.
- Filtros CSS são gratuitos computacionalmente (GPU) e funcionam na exportação via Playwright.

## Decisão

### Campos no tipo Layer

```typescript
interface Layer {
  filterBrightness?: number;  // default 100 (%)
  filterContrast?: number;    // default 100 (%)
  filterSaturation?: number;  // default 100 (%)
  filterBlur?: number;        // default 0 (px)
  filterGrayscale?: number;   // default 0 (%)
  filterSepia?: number;       // default 0 (%)
}
```

### UI no ImagePanel — seção Filtros

Sliders para cada filtro com valor numérico ao lado:

```
Brilho:     [──────●──] 100%
Contraste:  [──────●──] 100%
Saturação:  [──────●──] 100%
Blur:       [●────────] 0px
Escala Cinza: [●──────] 0%
Botão: [ Resetar filtros ]
```

### CSS gerado em layerStyle.ts

```typescript
const filters = [
  layer.filterBrightness !== undefined && layer.filterBrightness !== 100
    ? `brightness(${layer.filterBrightness}%)`
    : null,
  // ... outros
].filter(Boolean).join(' ');

if (filters) styles.filter = filters;
```

### Aplicação em shapes

Filtros também fazem sentido em shapes — disponibilizar como seção colapsada no ShapePanel.

## Arquivos afetados

- `frontend/src/components/Editor/panels/ImagePanel.tsx`
- `frontend/src/components/Fabrica/DesignRenderer.tsx` (type Layer)
- `frontend/src/lib/layerStyle.ts`

**Why:** Consistência de tom fotográfico é um diferencial visual de marca. Filtros CSS são a forma mais eficiente de conseguir isso.
**How to apply:** Implementar após ADR-0017 (object-fit) já que ambos são extensões do ImagePanel.
