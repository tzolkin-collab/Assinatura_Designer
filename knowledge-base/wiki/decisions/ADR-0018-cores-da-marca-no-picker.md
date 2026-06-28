---
name: ADR-0018-cores-da-marca-no-picker
description: Exibir paleta de cores da brand como presets no ColorSwatch de todos os painéis
metadata:
  type: decision
  status: proposed
  priority: desejável
  created: 2026-06-27
---

# ADR-0018 — Cores da Marca como Presets no Color Picker

## Contexto

`ColorSwatch` em `shared.tsx` abre um `<input type="color">` nativo. Não há presets de cores. A `BrandConfig` tem `colors[]` com as cores da marca — mas elas não aparecem nos painéis de edição.

## Problema

- Designer precisa lembrar o hex da cor primária da marca de cabeça.
- Inconsistência de cor entre slides acontece por variação manual.
- A IA usa as cores da brand corretamente; o editor não facilita a mesma coisa.

## Decisão

### Componente ColorSwatch melhorado

```
[#FF5500 ██]  ← cor atual (abre picker nativo ao clicar)

Marca:
[██] [██] [██] [██]  ← cores da BrandConfig.colors[]

Recentes:
[██] [██] [██] [██] [██]  ← últimas 5 usadas (localStorage)
```

### Implementação

`ColorSwatch` precisa receber `brandColors?: string[]` como prop. O editor pai busca as cores da brand via `GET /api/brands/:slug` (já existe).

```typescript
// shared.tsx
interface ColorSwatchProps {
  id: string;
  value: string;
  onChange: (color: string) => void;
  brandColors?: string[];
}
```

### Cores recentes

Salvas em `localStorage` key `'recent-colors-v1'`, máximo 8, rotacionando (FIFO).

### Picker avançado (hex input)

Ao lado do `<input type="color">`, adicionar campo de texto para digitar hex/rgba diretamente sem abrir o picker nativo:

```
[🎨] [#FF5500] ← input texto + color picker nativo
```

## Arquivos afetados

- `frontend/src/components/Editor/panels/shared.tsx` (ColorSwatch)
- `frontend/src/app/[marca]/editor/[postId]/page.tsx` (passar brandColors)
- `frontend/src/lib/api.ts`

**Why:** Usar as cores erradas da marca é o erro de identidade visual mais comum. Expor as cores no picker elimina isso.
**How to apply:** Mudança no ColorSwatch é transversal — beneficia todos os painéis de cor automaticamente.
