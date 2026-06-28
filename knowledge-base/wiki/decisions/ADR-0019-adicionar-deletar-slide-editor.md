---
name: ADR-0019-adicionar-deletar-slide-editor
description: Permitir adicionar, duplicar e deletar slides diretamente do editor sem voltar à Fábrica
metadata:
  type: decision
  status: proposed
  priority: desejável
  created: 2026-06-27
---

# ADR-0019 — Adicionar e Deletar Slides no Editor

## Contexto

Gerenciar o número de slides de um carrossel exige voltar à Fábrica e re-gerar. O editor (ADR-0004) terá navegação entre slides mas não terá CRUD de slides.

## Problema

- Adicionar um slide extra para CTA ao final do carrossel exige re-geração completa.
- Deletar um slide irrelevante também requer re-geração.
- O editor deveria ser o terminal do design, não um preview de leitura parcial.

## Decisão

### Ações disponíveis no SlideThumbnailPanel (ADR-0004)

| Ação | UI | Comportamento |
|---|---|---|
| Novo slide em branco | Botão `+` ao final | Cria slide com `{ layers: [], backgroundColor: '#ffffff' }` |
| Duplicar slide | Botão `⧉` no hover do thumbnail | Copia o slide atual com novas IDs em todas as layers |
| Deletar slide | Botão `🗑` no hover do thumbnail | Confirm dialog → remove do array |
| Reordenar | Drag do thumbnail | Reordena array de slides |

### Restrições

- Mínimo 1 slide (botão delete desabilitado quando há só 1).
- Máximo 20 slides (limite prático para carrosséis do Instagram).
- Ao criar slide duplicado, IDs das layers são regenerados (`crypto.randomUUID()`).

### Persistência

As mudanças chamam o endpoint de save (`POST /api/posts/:id` ou equivalente) com o `content` atualizado.

## Arquivos afetados

- `frontend/src/components/Editor/SlideThumbnailPanel.tsx` (ADR-0004)
- `frontend/src/app/[marca]/editor/[postId]/page.tsx`

**Why:** Gerenciar slides é parte do fluxo de edição, não de geração. Forçar re-geração para ajustar quantidade quebra o fluxo editorial.
**How to apply:** Implementar dentro do ADR-0004 (SlideThumbnailPanel) — é extensão natural do mesmo componente.
