---
name: ADR-0025-clip-path-mask
description: Implementar clip path básico (círculo, elipse, polígono) e máscara de imagem por forma
metadata:
  type: decision
  status: proposed
  priority: nice-to-have
  created: 2026-06-27
---

# ADR-0025 — Clip Path e Máscara

## Contexto

Fotos em formato circular ou hexagonal são padrão em posts de apresentação de pessoas. `clip-path` CSS permite isso sem software externo.

## Problema

- Foto de perfil circular requer pré-editar a imagem fora da plataforma.
- A IA pode gerar layers com `clip-path: circle(50%)` mas o editor não expõe essa propriedade.

## Decisão

### Fase 1 — Presets de clip-path

```typescript
type ClipPathPreset = 
  | 'none'
  | 'circle'      // circle(50%)
  | 'ellipse'     // ellipse(50% 40%)
  | 'rounded'     // inset(0 round 24px)
  | 'diamond'     // polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)
  | 'hexagon'     // polygon(...)
  | 'custom';     // valor CSS raw

interface Layer {
  clipPath?: ClipPathPreset;
  clipPathValue?: string; // para 'custom'
}
```

### UI no ImagePanel (ou TransformPanel para todos os tipos)

```
Forma:  [ Sem corte ] [ ○ Círculo ] [ ⬡ Hexágono ] [ ◇ Diamante ]
        [ Arredondado ] [ Personalizado: ____________ ]
```

### Fase 2 — Máscara de layer

Usar uma layer como máscara de outra: selecionar 2 layers → menu contextual → "Usar como máscara". Implementação via CSS `mask-image` ou `clip-path`. Fase 2 é pós-MVP.

### CSS gerado

```typescript
const clipMap = {
  circle: 'circle(50%)',
  ellipse: 'ellipse(50% 40%)',
  rounded: 'inset(0 round 24px)',
  diamond: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
  hexagon: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)',
};
styles.clipPath = layer.clipPath === 'custom'
  ? layer.clipPathValue
  : clipMap[layer.clipPath ?? 'none'];
```

## Arquivos afetados

- `frontend/src/components/Fabrica/DesignRenderer.tsx` (type Layer)
- `frontend/src/components/Editor/panels/ImagePanel.tsx`
- `frontend/src/lib/layerStyle.ts`

**Why:** Fotos circulares são o layout de destaque mais comum em posts de apresentação. Um preset de 5 opções resolve 90% dos casos.
**How to apply:** Implementar após ADR-0017 (object-fit) — clip-path e object-fit são frequentemente usados juntos.
