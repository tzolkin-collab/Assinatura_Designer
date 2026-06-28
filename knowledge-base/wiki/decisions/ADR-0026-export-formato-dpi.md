---
name: ADR-0026-export-formato-dpi
description: Adicionar opções de formato (PNG/JPG/WebP) e qualidade/DPI no modal de exportação
metadata:
  type: decision
  status: proposed
  priority: nice-to-have
  created: 2026-06-27
---

# ADR-0026 — Exportação com Opções de Formato e Qualidade

## Contexto

A exportação atual gera sempre PNG full-resolution via `htmlRaster` (Playwright). Não há opções de formato (JPG para fotos, WebP para web) ou controle de qualidade/DPI.

## Problema

- PNG de um carrossel de 10 slides pode ter 50MB+ — pesado para upload direto.
- JPG com 90% de qualidade reduz o tamanho em 70% com qualidade imperceptível para social.
- WebP é o formato padrão moderno para web (menor que JPG com mesma qualidade).
- Alguns canais (LinkedIn) preferem JPG ao PNG.

## Decisão

### Modal de exportação

Ao clicar em "Exportar", abrir modal com opções:

```
Exportar design

Formato:   ● PNG   ○ JPG   ○ WebP

Qualidade: [─────────●──] 90%
           (apenas JPG e WebP)

Escala:    ○ 1x   ● 2x   ○ 3x
           (1080px × 1080px → 2x = 2160px)

Slides:    ● Todos   ○ Apenas atual   ○ [1] a [3]

[ Cancelar ]            [ Exportar ]
```

### Implementação backend

Rota `GET /api/posts/:id/export` adiciona query params:
```
?format=jpg&quality=90&scale=2&slides=all
```

`htmlRaster.ts` (Playwright) já suporta `.screenshot({ type: 'jpeg', quality: 90 })`.

### Download

Para múltiplos slides: gerar ZIP com `archiver` no Node.js. Para slide único: download direto.

### Preset rápido

Botão "Exportar rápido" mantém o comportamento atual (PNG 1x, sem modal).

## Arquivos afetados

- `backend/src/lib/htmlRaster.ts`
- `backend/src/routes/posts.ts`
- `frontend/src/app/[marca]/editor/[postId]/page.tsx`
- Novo: `frontend/src/components/Editor/ExportModal.tsx`

**Why:** Reduzir 70% do tamanho de arquivo com JPG é crítico para upload rápido em redes sociais com limite de MB.
**How to apply:** Implementar como modal independente — não depende de outros ADRs de editor.
