---
name: ADR-0016-blend-modes
description: Adicionar propriedade mix-blend-mode por camada para efeitos de sobreposição
metadata:
  type: decision
  status: proposed
  priority: desejável
  created: 2026-06-27
---

# ADR-0016 — Blend Modes por Camada

## Contexto

CSS tem `mix-blend-mode` com 16 valores (normal, multiply, screen, overlay, darken, lighten, color-dodge, color-burn, hard-light, soft-light, difference, exclusion, hue, saturation, color, luminosity). A IA pode gerar designs usando blend modes para efeitos visuais — o editor não expõe controle desse campo.

## Problema

- Efeitos de sobreposição (ex: imagem com multiply sobre cor de fundo) são comuns em social design.
- A IA gera com blend modes mas o editor não permite modificá-los.
- Sem blend modes, elementos de textura e cor ficam limitados a opacidade simples.

## Decisão

### Campo no tipo Layer

```typescript
interface Layer {
  blendMode?: CSSProperties['mixBlendMode']; // default 'normal'
}
```

### UI no TransformPanel (abaixo de Opacidade)

```
Blend Mode: [ Normal ▾ ]
  ─── Normal ───
  Multiply
  Screen
  Overlay
  Darken / Lighten
  Color Dodge / Burn
  ─── Avançado ───
  Hard/Soft Light
  Difference
  Exclusion
  Hue / Saturation / Color / Luminosity
```

`<select>` agrupado com `<optgroup>` por categoria.

### CSS gerado

Em `layerStyle.ts`:
```typescript
if (layer.blendMode && layer.blendMode !== 'normal') {
  styles.mixBlendMode = layer.blendMode;
}
```

### Compatibilidade de exportação

`mix-blend-mode` funciona no browser. O `htmlRaster` (Playwright) renderiza corretamente. Verificar se `html2canvas` (usado na exportação alternativa) suporta — se não, usar apenas Playwright path.

## Arquivos afetados

- `frontend/src/components/Fabrica/DesignRenderer.tsx` (type Layer)
- `frontend/src/components/Editor/panels/TransformPanel.tsx`
- `frontend/src/lib/layerStyle.ts`

**Why:** Blend modes são a ferramenta mais poderosa para efeitos visuais sem imagens extras. Ampliam muito o repertório visual.
**How to apply:** Mudança simples — apenas um campo CSS. Baixo risco, implementar junto com outras extensões do TransformPanel.
