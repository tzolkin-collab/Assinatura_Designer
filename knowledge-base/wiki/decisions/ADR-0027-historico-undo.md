---
name: ADR-0027-historico-undo
description: Implementar painel visual de histórico de undo com lista de ações e jump para estado anterior
metadata:
  type: decision
  status: proposed
  priority: nice-to-have
  created: 2026-06-27
---

# ADR-0027 — Histórico Visual de Undo/Redo

## Contexto

Ctrl+Z e Ctrl+Y (Undo/Redo) já existem nos shortcuts mas não há visibilidade de quantas ações estão disponíveis nem qual ação será desfeita. Um painel de histórico como o do Photoshop permite "voltar 5 passos" de uma vez.

## Problema

- O usuário não sabe quantos undos têm disponíveis.
- Desfazer 10 passos exige pressionar Ctrl+Z 10 vezes.
- Sem histórico visual, o designer não consegue navegar para um estado específico.

## Decisão

### Estado de histórico

```typescript
interface HistoryEntry {
  id: string;
  label: string;       // ex: "Moveu 'Título'" "Alterou cor" "Adicionou texto"
  timestamp: number;
  snapshot: { layers: Layer[]; backgroundColor: string }; // estado completo
}

const [history, setHistory] = useState<HistoryEntry[]>([initialState]);
const [historyIndex, setHistoryIndex] = useState(0);
```

Máximo 50 entradas (FIFO quando excede).

### Labels automáticos por ação

```typescript
function describeChange(prev: Layer[], next: Layer[]): string {
  const added = next.filter(l => !prev.find(p => p.id === l.id));
  const removed = prev.filter(l => !next.find(n => n.id === l.id));
  const changed = next.filter(l => {
    const p = prev.find(p => p.id === l.id);
    return p && JSON.stringify(p) !== JSON.stringify(l);
  });
  if (added.length) return `Adicionou ${added[0].type}`;
  if (removed.length) return `Removeu camada`;
  if (changed.length === 1) return `Editou ${changed[0].name ?? changed[0].type}`;
  return `Editou ${changed.length} camadas`;
}
```

### UI — Painel colapsável

```
HISTÓRICO
─────────────────────
→ [atual] Editou Título
  Moveu Retângulo
  Adicionou imagem
  Alterou cor de fundo
  [estado inicial]
```

Click em qualquer entrada: jump para aquele estado (`setHistoryIndex(i)`).

### Performance

Snapshots completos de layers. Para designs com 20+ layers de 1KB cada = 20KB por snapshot × 50 = 1MB no máximo. Aceitável.

## Arquivos afetados

- `frontend/src/app/[marca]/editor/[postId]/page.tsx` (gerenciar history array)
- Novo: `frontend/src/components/Editor/HistoryPanel.tsx`
- `frontend/src/hooks/useShortcutHandler.ts` (Ctrl+Z navega no history)

**Why:** Histórico visual é a feature de "confiança" — o designer experimenta mais quando sabe que pode voltar qualquer passo.
**How to apply:** Implementar após a arquitetura de estado do editor estar estável — o history depende do estado de layers ser imutável.
