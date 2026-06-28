---
name: ADR-0015-reguas-guias
description: Implementar réguas nas bordas do canvas e guias arrastáveis para alinhamento preciso
metadata:
  type: decision
  status: proposed
  priority: desejável
  created: 2026-06-27
---

# ADR-0015 — Réguas e Guias no Canvas

## Contexto

Ferramentas profissionais de design têm réguas nas bordas horizontal e vertical do canvas com unidade em pixels. Da régua é possível arrastar guias (linhas auxiliares) que ajudam no alinhamento manual.

## Problema

- Sem réguas, o designer não tem referência visual de posição/escala.
- Guias são o complemento de snap (ADR-0014) para layouts estruturados.
- Grids globais não substituem guias em posições arbitrárias.

## Decisão

### Réguas

Faixas de 20px de largura/altura nas bordas superior e esquerda do canvas area.

Renderizadas como `<canvas>` 2D com ticks a cada 10px (minor) e 50px (major), escalonadas pelo `effectiveScale` (ADR-0002).

Origem (0,0) = canto superior esquerdo do slide.

### Guias (Guides)

```typescript
interface Guide {
  id: string;
  axis: 'horizontal' | 'vertical';
  position: number; // em pixels no espaço do canvas
}
```

**Criar**: arrastar da régua para dentro do canvas.
**Mover**: drag da linha de guia.
**Deletar**: drag para fora do canvas, ou double-click.
**Render**: linha pontilhada cyan sobre todas as layers (z-index > tudo).

Guias participam do snap (ADR-0014): layers snapping em guias têm prioridade sobre snap em outras layers.

### Toggle

`Ctrl+R` → toggle réguas.
`Ctrl+;` → toggle guias visíveis (mas mantém posição).

### Persistência

Guias salvas por post no `localStorage` (não fazem parte do `Post.content` exportado).

## Arquivos afetados

- Novo: `frontend/src/components/Editor/Ruler.tsx`
- Novo: `frontend/src/components/Editor/GuideLayer.tsx`
- `frontend/src/app/[marca]/editor/[postId]/page.tsx`
- `frontend/src/lib/shortcuts.ts`

**Why:** Réguas dão contexto espacial; guias permitem layouts baseados em estrutura (colunas, margens).
**How to apply:** Implementar após ADR-0002 (zoom) e ADR-0014 (snap) para integrar com o sistema de escala.
