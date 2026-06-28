---
name: ADR-0006-lista-camadas
description: Implementar painel lateral com lista ordenada de todas as camadas com visibilidade, lock e reorder via drag
metadata:
  type: decision
  status: proposed
  priority: crítico
  created: 2026-06-27
---

# ADR-0006 — Painel de Lista de Camadas

## Contexto

O editor não tem um painel mostrando todas as layers do slide. O designer só interage com layers clicando no canvas — layers sobrepostas ou pequenas demais ficam inacessíveis. Figma, Photoshop e Canva têm um painel de camadas como elemento central da UX.

## Problema

- Layers empilhadas: a de baixo fica inacessível sem z-index juggling.
- Sem visibilidade de quais layers existem, o designer não tem mental map do slide.
- Sem lock, layers de fundo são movidas acidentalmente.

## Decisão

### Layout

Painel lateral direito (ou esquerdo, configurável), colapsável, com lista:

```
CAMADAS                              [+]
─────────────────────────────────────
👁 🔒  [T] Título principal      ···
👁 🔒  [□] Retângulo fundo       ···
👁 🔒  [🖼] Foto do produto      ···
👁 🔒  [T] Subtítulo             ···
```

### Colunas por layer

| Ícone | Função |
|---|---|
| 👁 (olho) | Toggle visibilidade (`layer.visible`) |
| 🔒 (cadeado) | Toggle lock (`layer.locked`) |
| Tipo icon | Indica texto/shape/imagem |
| Nome/preview | Primeiros chars do conteúdo, ou "Shape", "Imagem" |
| `···` | Menu contextual (renomear, duplicar, deletar) |

### Interações

- **Click na row**: seleciona a layer no canvas.
- **Drag reorder**: reordena z-index (layer no topo da lista = z-index mais alto).
- **Double-click no nome**: edita o nome da layer inline.
- **Layer locked**: Rnd não dispara `onDragStart`; painel lateral mostra cadeado ativo.
- **Layer hidden**: não renderizada no canvas; no painel aparece com opacidade reduzida.

### Modelo de dados (extensão de `Layer`)

```typescript
interface Layer {
  // ... campos existentes ...
  visible?: boolean;   // default true
  locked?: boolean;    // default false
  name?: string;       // label customizado
}
```

### Relação com ADR-0001

O botão `+` do InsertToolbar (ADR-0001) pode também ser o `[+]` do painel de camadas.

## Alternativas consideradas

- **Painel colapsável** (sidebar à direita): permite uso em telas pequenas.
- **Lista floating overlay**: mais compacto mas conflita com painéis de propriedades.

## Consequências

- `Layer` precisa de campos `visible`, `locked`, `name` (backwards-compatible: `undefined` = `true`/`false`/nome-auto).
- `CanvasEditor` precisa checar `layer.locked` antes de permitir drag.
- `LayerPropertiesPanel` recebe a lista de layers e o setter.

## Arquivos afetados

- `frontend/src/components/Editor/LayerPropertiesPanel.tsx`
- `frontend/src/components/Fabrica/DesignRenderer.tsx` (type `Layer`)
- `frontend/src/components/Editor/CanvasEditor.tsx`
- Novo: `frontend/src/components/Editor/LayerListPanel.tsx`

**Why:** Painel de layers é estrutural para qualquer editor visual. Sem ele o editor não escala para designs com 10+ elementos.
**How to apply:** Implementar junto com ADR-0001 pois ambos lidam com adição/gestão de layers.
