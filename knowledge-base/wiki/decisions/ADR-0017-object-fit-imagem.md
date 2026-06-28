---
name: ADR-0017-object-fit-imagem
description: Adicionar controle de object-fit (cover/contain/fill) e crop de imagem no ImagePanel
metadata:
  type: decision
  status: proposed
  priority: desejável
  created: 2026-06-27
---

# ADR-0017 — Object-Fit e Crop de Imagem

## Contexto

`ImagePanel.tsx` tem apenas URL e border-radius. Não há controle de como a imagem ocupa a área da layer (`object-fit`) nem de crop (posicionamento dentro da área de clip).

## Problema

- Uma foto 4:3 numa layer quadrada aparece distorcida ou com barras.
- `object-fit: cover` é o comportamento esperado para fotos em cards — e não é o default.
- Sem crop, o designer não consegue enquadrar o sujeito principal da foto.

## Decisão

### Campos no tipo Layer

```typescript
interface Layer {
  objectFit?: 'cover' | 'contain' | 'fill' | 'none'; // default 'cover'
  objectPositionX?: number; // % 0-100, default 50
  objectPositionY?: number; // % 0-100, default 50
}
```

### UI no ImagePanel

```
Ajuste:  [ Cover ] [ Contain ] [ Fill ]

Posição X: [──────●────] 50%
Posição Y: [──────●────] 50%
```

`Cover` = preenche tudo (pode cortar). `Contain` = encaixa tudo (pode ter espaço vazio). `Fill` = estica para preencher.

Os sliders de posição X/Y só aparecem quando `objectFit === 'cover'`.

### CSS gerado

```typescript
if (layer.type === 'image') {
  styles.objectFit = layer.objectFit ?? 'cover';
  styles.objectPosition = `${layer.objectPositionX ?? 50}% ${layer.objectPositionY ?? 50}%`;
}
```

### Crop visual no canvas

Bonus (fase 2): modo de crop ativado por double-click na imagem — mostra a imagem com overlay de máscara e handle para mover a posição internamente.

## Arquivos afetados

- `frontend/src/components/Editor/panels/ImagePanel.tsx`
- `frontend/src/components/Fabrica/DesignRenderer.tsx` (type Layer)
- `frontend/src/lib/layerStyle.ts`

**Why:** `cover` vs `fill` é a diferença entre uma foto profissional e uma foto distorcida. Default incorreto arruína qualquer design com fotos.
**How to apply:** Mudança simples e isolada no ImagePanel. Implementar antes de adicionar upload de imagem (ADR-0005).
