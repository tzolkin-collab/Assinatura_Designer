---
name: ADR-0029-padding-interno-texto
description: Adicionar controle de padding interno (top/right/bottom/left) para camadas de texto
metadata:
  type: decision
  status: proposed
  priority: nice-to-have
  created: 2026-06-27
---

# ADR-0029 — Padding Interno de Texto

## Contexto

Layers de texto não têm controle de padding interno. Textos em botões/badges/tags precisam de espaço entre o texto e a borda da layer (especialmente quando há `contrastBackground` ativo — ADR já resolvido).

## Problema

- Botão com texto "Saiba mais" sem padding fica apertado na borda da layer.
- Padding manual é simulado aumentando W/H da layer — workaround frágil.
- `contrastBackground` (fundo de contraste do texto) já usa a layer como área, mas sem padding fica colado.

## Decisão

### Campos no tipo Layer

```typescript
interface Layer {
  paddingTop?: number;    // default 0 (px)
  paddingRight?: number;  // default 0 (px)
  paddingBottom?: number; // default 0 (px)
  paddingLeft?: number;   // default 0 (px)
}
```

### UI no TextPanel — seção Espaçamento

```
Espaçamento interno:
  [🔗] Todos: [ 0 px ]      ← modo "todos iguais"
  
  T: [0px]  D: [0px]
  B: [0px]  E: [0px]        ← modo "independente" (toggle 🔗)
```

O ícone 🔗 linka/desvincula os 4 valores.

### CSS gerado

```typescript
styles.padding = [
  layer.paddingTop ?? 0,
  layer.paddingRight ?? 0,
  layer.paddingBottom ?? 0,
  layer.paddingLeft ?? 0,
].map(v => `${v}px`).join(' ');
```

### Impacto no contrastBackground

O `contrastBackground` deve respeitar o padding (ficará dentro da área com padding). Verificar CSS de implementação atual do contraste.

## Arquivos afetados

- `frontend/src/components/Fabrica/DesignRenderer.tsx` (type Layer)
- `frontend/src/components/Editor/panels/TextPanel.tsx`
- `frontend/src/lib/layerStyle.ts`

**Why:** Padding é o controle mais básico de layout de qualquer elemento UI. Ausência causa textos "apertados" que não ficam profissionais.
**How to apply:** Mudança simples de CSS. Implementar junto com refactor geral do TextPanel.
