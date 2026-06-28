---
name: ADR-0013-rename-camada
description: Permitir nomear/renomear camadas com double-click no LayerListPanel
metadata:
  type: decision
  status: proposed
  priority: importante
  created: 2026-06-27
---

# ADR-0013 — Renomear Camadas

## Contexto

Layers não têm nome visível além do tipo e conteúdo parcial. Em projetos com muitas layers do mesmo tipo (ex: 5 layers de texto), identificá-las no painel (ADR-0006) é difícil.

## Problema

- "Texto", "Texto 2", "Texto 3" não comunicam o papel de cada layer.
- Sem nome, o designer não consegue comunicar "ajusta o Headline" para outro colaborador.

## Decisão

### Campo `name` no tipo Layer

```typescript
interface Layer {
  name?: string; // se undefined, exibe nome automático
}
```

### Nome automático (fallback)

```typescript
function getLayerDisplayName(layer: Layer): string {
  if (layer.name) return layer.name;
  if (layer.type === 'text') return layer.content?.slice(0, 20) ?? 'Texto';
  if (layer.type === 'image') return 'Imagem';
  if (layer.type === 'shape') return 'Forma';
  return 'Camada';
}
```

### Edição inline no LayerListPanel

- **Double-click** na row abre `<input>` inline com o nome atual.
- `Enter` ou `blur` salva.
- `Esc` cancela.

### Menu contextual

Opção "Renomear" no `···` de cada layer também aciona o input inline.

## Arquivos afetados

- `frontend/src/components/Fabrica/DesignRenderer.tsx` (type Layer)
- `frontend/src/components/Editor/LayerListPanel.tsx` (ADR-0006)

**Why:** Nomes são essenciais para comunicação em equipe e para encontrar layers rapidamente em designs complexos.
**How to apply:** Implementar dentro do ADR-0006 (LayerListPanel) — sem custo adicional de arquitetura.
