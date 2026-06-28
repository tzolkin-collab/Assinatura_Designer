---
name: ADR-0021-group-ungroup
description: Implementar agrupamento de camadas (Ctrl+G) para mover/transformar múltiplas layers como uma unidade
metadata:
  type: decision
  status: proposed
  priority: desejável
  created: 2026-06-27
---

# ADR-0021 — Agrupar e Desagrupar Camadas (Ctrl+G)

## Contexto

Não há como agrupar layers. Em designs com componentes repetidos (ex: ícone + texto + linha), cada elemento precisa ser movido individualmente. Isso é lento e causa desalinhamentos.

## Problema

- Mover um "componente" de 3 layers exige selecionar todas as 3 cada vez.
- Sem grupo, não há hierarquia visual no LayerListPanel.
- Componentes copiados entre slides (ADR-0003) perdem coesão sem grupo.

## Decisão

### Modelo de dados

```typescript
interface LayerGroup {
  id: string;
  type: 'group';
  name?: string;
  children: Layer[]; // layers aninhadas
  x: number; y: number; // posição do grupo (offset)
  zIndex: number;
  visible?: boolean;
  locked?: boolean;
}
```

🟡 HIPÓTESE — verificar se o schema atual de `Layer` suporta nested ou se precisa de union type com `LayerGroup`.

### Operações

| Ação | Trigger | Comportamento |
|---|---|---|
| Agrupar | `Ctrl+G` (2+ layers selecionadas) | Cria LayerGroup com bounding box, ajusta coords dos filhos para relativas ao grupo |
| Desagrupar | `Ctrl+Shift+G` (grupo selecionado) | Expande filhos para coords absolutas, remove grupo |
| Selecionar dentro do grupo | Double-click no canvas | Entra no modo de edição do grupo |
| Sair do grupo | Esc | Retorna seleção ao grupo |

### Renderização

`CanvasEditor` renderiza grupo como container `<div>` com `position: absolute` + `transform: translate`. Filhos são renderizados como layers normais dentro do container.

### Restrições da primeira versão

- Grupos planos (1 nível de profundidade). Sem grupos dentro de grupos.
- Resize do grupo redimensiona proporcionalmente todos os filhos.

## Alternativas consideradas

- **Implementação via Multi-select sempre**: mais simples, sem schema change, mas perde a persistência do grupo entre sessões.

## Arquivos afetados

- `frontend/src/components/Fabrica/DesignRenderer.tsx` (type Layer | LayerGroup)
- `frontend/src/components/Editor/CanvasEditor.tsx`
- `frontend/src/components/Editor/LayerListPanel.tsx`
- `frontend/src/lib/shortcuts.ts`

**Why:** Grupos são a base de componentes reutilizáveis. Sem eles, designs complexos são impossíveis de manter coesos.
**How to apply:** Implementar após ADR-0006 (Layer List) e ADR-0003 (copy-paste) — grupos se beneficiam de ambas as features.
