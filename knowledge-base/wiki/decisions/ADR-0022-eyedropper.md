---
name: ADR-0022-eyedropper
description: Adicionar eyedropper (pipeta de cor) no ColorSwatch para pegar cores do canvas
metadata:
  type: decision
  status: proposed
  priority: desejável
  created: 2026-06-27
---

# ADR-0022 — Eyedropper (Pipeta de Cor)

## Contexto

`ColorSwatch` usa apenas `<input type="color">`. Para copiar uma cor de outra layer (ex: pegar o azul exato do background para usar num texto), o designer precisa abrir o DevTools ou adivinhar o hex.

## Problema

- "Qual era o hex exato dessa cor?" é uma pergunta frequente.
- Sem eyedropper, consistência de cor entre layers de tipos diferentes é manual.
- A API `EyeDropper` existe no Chrome/Edge desde 2021.

## Decisão

### EyeDropper API

```typescript
async function pickColorFromScreen(): Promise<string | null> {
  if (!('EyeDropper' in window)) return null;
  const eyeDropper = new (window as any).EyeDropper();
  const result = await eyeDropper.open();
  return result.sRGBHex;
}
```

### UI no ColorSwatch

Botão `💧` ao lado do color picker. Ao clicar, chama `pickColorFromScreen()`, que ativa o seletor nativo do browser (cursor vira pipeta). Ao selecionar um pixel, a cor é aplicada.

### Fallback

Se `EyeDropper` não suportado (Firefox, Safari), o botão `💧` fica disabled com tooltip "Não suportado neste browser".

### Escopo de seleção

A API `EyeDropper` captura qualquer pixel da tela, não apenas do canvas — o que é uma vantagem (pode pegar cor de referência externa).

## Arquivos afetados

- `frontend/src/components/Editor/panels/shared.tsx` (ColorSwatch)

**Why:** Eyedropper é o atalho mais rápido para consistência de cor. Sem ele, o designer usa valores numéricos de memória.
**How to apply:** Mudança isolada de 20 linhas no ColorSwatch. Implementar junto com ADR-0018 (cores da marca).
