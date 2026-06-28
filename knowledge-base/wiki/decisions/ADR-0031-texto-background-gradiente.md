---
name: ADR-0031-texto-background-gradiente
description: Adicionar opção de gradiente como preenchimento de cor de texto (text-fill com clip)
metadata:
  type: decision
  status: proposed
  priority: nice-to-have
  created: 2026-06-27
---

# ADR-0031 — Texto com Preenchimento em Gradiente

## Contexto

Efeito de texto gradiente (ex: "VENDAS" com roxo→azul) é um dos efeitos de destaque mais usados em posts de high performance. CSS permite via `-webkit-background-clip: text` + `background-image: linear-gradient(...)`.

## Problema

- TextPanel só suporta cor sólida no campo `color`.
- Texto gradiente é impossível sem HTML raw.
- A IA pode gerar layers com esse efeito — editor não expõe controle.

## Decisão

### Campo no tipo Layer

```typescript
interface Layer {
  textGradient?: {
    type: 'linear' | 'radial';
    angle?: number;
    stops: Array<{ color: string; position: number }>;
  };
}
```

Quando `textGradient` presente, substitui `color` na renderização.

### CSS gerado em layerStyle.ts

```typescript
if (layer.type === 'text' && layer.textGradient) {
  const { type, angle, stops } = layer.textGradient;
  const stopsCss = stops
    .sort((a, b) => a.position - b.position)
    .map(s => `${s.color} ${s.position}%`)
    .join(', ');
  const grad = type === 'radial'
    ? `radial-gradient(${stopsCss})`
    : `linear-gradient(${angle ?? 90}deg, ${stopsCss})`;
  
  styles.backgroundImage = grad;
  styles.WebkitBackgroundClip = 'text';
  styles.WebkitTextFillColor = 'transparent';
  styles.backgroundClip = 'text';
  styles.color = 'transparent'; // fallback
}
```

### UI no TextPanel

Toggle entre "Cor sólida" e "Gradiente" no campo de cor:

```
Cor:  [ Sólida | Gradiente ]

[modo gradiente]
  [ Stop 1: [██] 0% ]
  [ Stop 2: [██] 100%]
  Ângulo: [ 90° ]
```

### Compatibilidade de exportação

`-webkit-background-clip: text` funciona no Chromium (Playwright). Verificar se html2canvas suporta — provável que não (usar apenas Playwright path para layers com textGradient).

## Arquivos afetados

- `frontend/src/components/Fabrica/DesignRenderer.tsx` (type Layer)
- `frontend/src/components/Editor/panels/TextPanel.tsx`
- `frontend/src/lib/layerStyle.ts`

**Why:** Texto gradiente é o efeito visual de texto mais impactante e pedido em posts de alta performance. Um tipo de efeito extremamente associado a posts virais.
**How to apply:** Implementar após ADR-0020 (gradiente multi-stop) pois compartilha a lógica de stops.
