---
name: ADR-0020-gradiente-multi-stop
description: Expandir o editor de gradiente do ShapePanel para suportar múltiplos color stops
metadata:
  type: decision
  status: proposed
  priority: desejável
  created: 2026-06-27
---

# ADR-0020 — Gradiente Multi-Stop no ShapePanel

## Contexto

`ShapePanel.tsx` tem gradiente com apenas 2 cores (`color` + `gradientColor2`) e ângulo. Gradientes com 3+ stops são comuns em design moderno (ex: roxo → azul → ciano, com stop em posições customizadas).

## Problema

- A IA pode gerar gradientes com 3+ stops mas o editor só edita 2.
- Gradientes de marca frequentemente têm 3 cores.
- Limite de 2 cores é arbitrário dado que CSS suporta N stops.

## Decisão

### Novo modelo de dados

```typescript
interface GradientStop {
  color: string;    // hex/rgba
  position: number; // 0-100 (%)
}

interface Layer {
  // campos atuais mantidos para compatibilidade:
  gradientType?: 'none' | 'linear' | 'radial';
  gradientAngle?: number;
  
  // novo campo para multi-stop:
  gradientStops?: GradientStop[]; // se presente, substitui color + gradientColor2
}
```

### Migração do formato antigo

`computeLayerStyle` checa `gradientStops` primeiro; se ausente, usa `color` + `gradientColor2` (retrocompatível).

### UI do editor de stops

```
[ Stop 1: [██] 0% ]  [+]  [−]
[ Stop 2: [██] 50%]
[ Stop 3: [██] 100%]

Ângulo: [──●──] 135°
```

Cada stop tem `ColorSwatch` + slider de posição 0-100%. Botão `+` adiciona stop intermediário. Botão `−` remove (mínimo 2 stops).

### CSS gerado

```typescript
const stops = layer.gradientStops
  .sort((a, b) => a.position - b.position)
  .map(s => `${s.color} ${s.position}%`)
  .join(', ');
const grad = type === 'radial'
  ? `radial-gradient(${stops})`
  : `linear-gradient(${angle}deg, ${stops})`;
```

## Arquivos afetados

- `frontend/src/components/Editor/panels/ShapePanel.tsx`
- `frontend/src/components/Fabrica/DesignRenderer.tsx` (type Layer)
- `frontend/src/lib/layerStyle.ts`

**Why:** Gradientes de 3+ cores são o padrão em design 2025. Limite de 2 é uma restrição desnecessária.
**How to apply:** Implementar como extensão do ShapePanel atual; retrocompatível via fallback.
