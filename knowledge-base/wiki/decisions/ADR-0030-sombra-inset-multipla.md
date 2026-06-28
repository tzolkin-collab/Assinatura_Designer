---
name: ADR-0030-sombra-inset-multipla
description: Expandir ShadowPanel para suportar shadow inset e múltiplas sombras por camada
metadata:
  type: decision
  status: proposed
  priority: nice-to-have
  created: 2026-06-27
---

# ADR-0030 — Shadow Inset e Múltiplas Sombras

## Contexto

`ShadowPanel.tsx` suporta uma sombra externa (drop shadow). CSS `box-shadow` suporta múltiplas sombras e sombra interna (`inset`). Efeitos como "vidro fosco" e "embossed" requerem múltiplas sombras combinadas.

## Problema

- Uma sombra por layer limita efeitos de profundidade.
- `inset` shadow é necessário para efeitos de botão pressionado e glassmorphism.
- A IA pode gerar `box-shadow: 0 4px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)` — editável apenas como texto raw.

## Decisão

### Novo modelo de dados

```typescript
interface ShadowDef {
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
  spread?: number; // default 0
  inset?: boolean; // default false
}

interface Layer {
  shadows?: ShadowDef[]; // substitui shadowColor/shadowBlur/shadowOffsetX/Y
}
```

### Retrocompatibilidade

Se `shadows` ausente, usar campos legados `shadowColor`, `shadowBlur`, `shadowOffsetX`, `shadowOffsetY`.

### UI no ShadowPanel

```
SOMBRAS                          [+]
──────────────────────────────────
[  ] Inset  [██] #000 40%  blur:20 X:0 Y:4  [−]
[  ] Inset  [██] #fff 10%  blur:0  X:0 Y:1  [−]
```

Cada sombra é uma row expansível com todos os controles. Botão `+` adiciona nova sombra. `[−]` remove.

### CSS gerado

```typescript
const shadows = (layer.shadows ?? [legacyShadow]).map(s => {
  const inset = s.inset ? 'inset ' : '';
  return `${inset}${s.offsetX}px ${s.offsetY}px ${s.blur}px ${s.spread ?? 0}px ${s.color}`;
}).join(', ');
styles.boxShadow = shadows || 'none';
```

## Arquivos afetados

- `frontend/src/components/Fabrica/DesignRenderer.tsx` (type Layer)
- `frontend/src/components/Editor/panels/ShadowPanel.tsx`
- `frontend/src/lib/layerStyle.ts`

**Why:** Múltiplas sombras + inset são necessárias para o efeito glassmorphism que domina design de redes sociais 2024-2025.
**How to apply:** Implementar com retrocompatibilidade. Mudança isolada no ShadowPanel.
