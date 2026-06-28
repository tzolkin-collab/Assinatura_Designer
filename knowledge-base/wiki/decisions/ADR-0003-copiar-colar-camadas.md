---
name: ADR-0003-copiar-colar-camadas
description: Implementar Ctrl+C/V para copiar e colar camadas, incluindo cross-slide em carrosséis
metadata:
  type: decision
  status: proposed
  priority: crítico
  created: 2026-06-27
---

# ADR-0003 — Copiar e Colar Camadas (Ctrl+C / Ctrl+V)

## Contexto

O editor tem Ctrl+D para duplicar (in-place, mesmo slide), mas não tem Ctrl+C/V. Em carrosséis, copiar um elemento de um slide para outro é o fluxo mais comum de edição de consistência visual entre slides.

## Problema

- Ctrl+D duplica mas não permite mover para outro slide.
- Sem clipboard, o designer precisa recriar ou re-pedir à IA os mesmos elementos em slides diferentes.
- Ctrl+C / Ctrl+V é o atalho mais universal de qualquer aplicação.

## Decisão

### Clipboard em memória (não usa `navigator.clipboard`)

```typescript
// clipboard-store.ts
let clipboard: Layer[] = [];

export function copyLayers(layers: Layer[]) {
  clipboard = layers.map(l => ({ ...l }));
}

export function pasteLayers(offsetX = 20, offsetY = 20): Layer[] {
  return clipboard.map(l => ({
    ...l,
    id: crypto.randomUUID(),
    x: l.x + offsetX,
    y: l.y + offsetY,
  }));
}
```

Usar memória (não `localStorage`) para evitar serialização de dados de imagem grandes.

### Comportamento

| Ação | Resultado |
|---|---|
| Ctrl+C (seleção ativa) | Copia as layers selecionadas para o clipboard |
| Ctrl+V (mesmo slide) | Cola com offset +20px/+20px, seleciona as novas layers |
| Ctrl+V (outro slide) | Cola no centro do slide destino |
| Ctrl+X | Copia + deleta (cut) |

### Cross-slide

O clipboard é global (módulo singleton). Ao trocar de slide (ver ADR-0004), o Ctrl+V cola as layers do clipboard no slide atual.

### Conflito com inputs de texto

Quando o foco está em um `<textarea>` ou `<input>` (edição de conteúdo de texto), os eventos Ctrl+C/V devem ser passados para o browser normalmente. O `useShortcutHandler` já tem lógica de scope `'canvas'` — garantir que o scope exclui inputs focados.

## Alternativas consideradas

- **`navigator.clipboard` API**: permitiria colar entre abas/apps, mas adiciona complexidade com permissões e serialização. Não necessário agora.

## Consequências

- Novo módulo `frontend/src/lib/clipboardStore.ts`.
- Shortcuts adicionados: `ctrl+c`, `ctrl+v`, `ctrl+x`.
- Pasta de shortcuts: `shortcuts.ts` → nova categoria `'Edição'`.

## Arquivos afetados

- `frontend/src/lib/shortcuts.ts`
- `frontend/src/hooks/useShortcutHandler.ts`
- Novo: `frontend/src/lib/clipboardStore.ts`
- `frontend/src/app/[marca]/editor/[postId]/page.tsx`

**Why:** Cross-slide copy-paste é o fluxo número 1 de edição de carrosséis. Duplicar (Ctrl+D) não substitui.
**How to apply:** Implementar junto com ADR-0004 (navegação entre slides) para habilitar o cross-slide.
