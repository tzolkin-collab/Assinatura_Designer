---
name: ADR-0001-adicionar-camada-manual
description: Implementar botão "+" para criar novas camadas (texto/shape/imagem) diretamente no editor, sem depender da IA
metadata:
  type: decision
  status: proposed
  priority: crítico
  created: 2026-06-27
---

# ADR-0001 — Adicionar Camada Manualmente no Editor

## Contexto

O editor atual (`CanvasEditor.tsx` + `LayerPropertiesPanel.tsx`) só edita camadas geradas pela IA (Fábrica). Não existe nenhuma UI para o designer criar uma nova camada do zero. Isso força o usuário a voltar à Fábrica toda vez que precisa incluir um elemento novo, quebrando o fluxo de edição manual.

## Problema

- Sem botão "+", o editor é apenas um painel de ajuste de layers existentes.
- Qualquer adição de texto, shape ou imagem exige re-geração pela IA.
- Não equivale à experiência de ferramentas como Canva/Figma, onde o designer tem autonomia total.

## Decisão

Criar uma **toolbar de inserção** no topo (ou lateral) do editor com 4 botões:

| Botão | Tipo de layer criada | Defaults |
|---|---|---|
| `T` Texto | `type: "text"` | "Novo texto", 24px, centralizado no canvas |
| `□` Shape | `type: "shape"` | retângulo 200×100, cor primária da brand |
| `🖼` Imagem | `type: "image"` | 300×200, URL vazia (abre ImagePanel) |
| `⬜` Fundo | Edita BackgroundPanel | n/a (não cria layer, seleciona fundo) |

Cada botão chama `onLayersChange([...layers, newLayer])` com um ID gerado (`crypto.randomUUID()`), posicionado no centro do canvas.

## Alternativas consideradas

- **Modal de seleção de tipo**: mais complexo, sem ganho real para 3 tipos simples.
- **Drag-from-panel**: mais moderno (Figma-style) mas custoso para implementar agora.

## Consequências

- Designers podem construir layouts sem depender da IA para cada elemento.
- A IA passa a ser "ponto de partida", não "única fonte de camadas".
- Necessário definir z-index padrão = `max(existingZIndexes) + 1`.

## Arquivos afetados

- `frontend/src/app/[marca]/editor/[postId]/page.tsx` (ou page pai do editor)
- `frontend/src/components/Editor/CanvasEditor.tsx`
- Novo componente: `frontend/src/components/Editor/InsertToolbar.tsx`

**Why:** Equivalência básica com qualquer editor visual. Sem isso o editor é um painel de ajuste, não um criador.
**How to apply:** Implementar antes de qualquer feature de camada (lock, visibilidade, etc.) pois é pré-requisito de usabilidade.
