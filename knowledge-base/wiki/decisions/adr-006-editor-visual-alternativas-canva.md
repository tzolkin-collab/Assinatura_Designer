---
title: "ADR-006 — Editor Visual: Canva vs Penpot vs Fabric.js vs CanvasEditor"
type: decision
tags:
  - "editor"
  - "canva"
  - "penpot"
  - "fabric-js"
  - "react-rnd"
  - "ux"
  - "infra"
  - "designer"
sources: []
created: 2026-05-06
updated: 2026-05-11
status: aceita
---

# ADR-006 — Editor Visual: Canva vs Penpot vs Fabric.js

## Contexto

ADR-005 decidiu migrar o editor próprio para a **Canva Connect API**. Durante a implementação surgiu um requisito não mapeado anteriormente: a Gabi (usuária principal do Designer) **não pode sair do app** para editar designs — isso quebra o fluxo de trabalho e aumenta fricção.

Investigação revelou que o Canva **não pode ser embutido via iframe** (`X-Frame-Options: SAMEORIGIN`). As alternativas oferecidas pela Canva são:

| Mecanismo | Comportamento |
|---|---|
| Redirect OAuth | Usuária é redirecionada para canva.com — sai completamente do app |
| Canva Button SDK | Abre popup/nova janela — ainda sai do contexto visual |
| Canva Apps SDK | Plugin que roda *dentro* do Canva — inverte o fluxo, Canva vira o app principal |

Nenhuma dessas opções mantém a Gabi dentro do app. O requisito é: **editor totalmente embarcado, sem saída**.

## Alternativas Avaliadas

### Opção A — Fabric.js (biblioteca canvas)

**O que é:** Biblioteca open source de canvas 2D para React. Não é um editor pronto — você constrói a UI em cima.

**Prós:**
- Totalmente gratuito (MIT)
- Roda 100% no browser do cliente
- Zero impacto no servidor/VPS
- Embarcado nativamente como componente React
- Controle total sobre a UX

**Contras:**
- Requer desenvolvimento do editor do zero (drag, resize, text, layers, export)
- Ecossistema de assets, fontes e templates precisa ser construído separadamente
- Estimativa: 2–3 semanas para MVP funcional comparável ao editor removido em ADR-005

---

### Opção B — Penpot self-hosted (editor profissional open source)

**O que é:** Editor de design profissional open source (equivalente ao Figma/Canva), rodando em Docker na própria VPS. Embarcável via iframe.

**Prós:**
- Totalmente gratuito (open source)
- Editor completo: vetores, componentes, protótipos, exportação PNG/SVG/PDF
- Embarcável via iframe sem restrição (domínio próprio)
- Sem dependência de vendor externo

**Contras:**
- Exige ~1.5–2 GB de RAM disponível (backend JVM + PostgreSQL + Redis + exporter)
- VPS atual tem 2.7 GB total com 71.1% ocupado → apenas ~780 MB livres → **insuficiente**
- Necessita upgrade de RAM antes de viabilizar

**Specs da VPS no momento da avaliação (2026-05-06):**

| Recurso | Total | Usado | Livre |
|---|---|---|---|
| CPU | 2 cores | ~3% | ~97% |
| RAM | 2.7 GB | 71.1% (~1.92 GB) | ~780 MB |
| Disco | 76.4 GB | 30.9% (~23.6 GB) | ~52.8 GB |

---

### Opção C — CanvasEditor próprio (react-rnd, já implementado) ✅ ESCOLHIDA

**O que é:** O `CanvasEditor.tsx` que existia antes de ADR-005 estava marcado como artefato mas o código estava completo. Em vez de construir algo do zero (Fabric.js) ou instalar infra pesada (Penpot), a decisão foi **reativar e corrigir o componente existente**.

**Prós:**
- Zero custo de desenvolvimento de infraestrutura
- Já usa `react-rnd` (dependência existente no projeto)
- Embarcado nativamente no Next.js — zero saída do app
- `scale` prop do Rnd corrige coordenadas de drag/resize em canvas escalado via CSS
- Sem custo de RAM extra na VPS

**Contras:**
- Editor mais simples que Penpot (sem vetores, protótipos, etc.) — adequado para o caso de uso
- Sem assets/templates nativos (mas integrado ao pipeline da Fábrica)

**Implementação (2026-05-11):**
- `CanvasEditor.tsx` reescrito como componente controlado com `ResizeObserver` + escala dinâmica
- `LayerPropertiesPanel.tsx` criado: edição de posição, tamanho, opacidade, zIndex; texto (conteúdo, fonte, tamanho, peso, alinhamento, cor); shape (cor, arredondamento, gradiente); imagem (URL, arredondamento); borda e sombra para todos
- `editor/[postId]/page.tsx` integrado: save via `PUT /posts/:id`, seleção de layer sincronizada entre canvas e sidebar
- `editor/page.tsx` virou landing com grid de designs disponíveis
- Sidebar: link "Editor" descomentado

## Decisão

**Status: ACEITA (2026-05-11) — Opção C: CanvasEditor próprio (react-rnd).**

| Opção | Status | Motivo da rejeição/escolha |
|---|---|---|
| Canva Connect API (ADR-005) | ❌ Descartada | iframe bloqueado (`X-Frame-Options: SAMEORIGIN`) |
| Penpot self-hosted | ❌ Adiada | RAM insuficiente na VPS (~780 MB livre vs ~1.5 GB necessário) |
| Fabric.js | ❌ Preterida | Semanas de desenvolvimento desnecessárias dado que o CanvasEditor já existia |
| **CanvasEditor próprio (react-rnd)** | ✅ **Escolhida** | Já implementado, embarcado, zero infra extra |

## Impacto em ADR-005

ADR-005 permanece como registro histórico. As deps NPM removidas (html-to-image, html2canvas, jspdf, @ffmpeg) continuam removidas — o CanvasEditor não as usava. A única dep reativada é `react-rnd` (que continuou no package.json). `canvaClient.ts` e as rotas `/api/canva/*` permanecem como código morto que pode ser removido em limpeza futura.

## Próximos Passos

1. ~~Verificar custo de upgrade de RAM~~ — não necessário com a escolha atual
2. Avaliar se Penpot vale como upgrade futuro se RAM for expandida para outros fins
3. Expandir LayerPropertiesPanel conforme necessidades de edição da Gabi

## Relacionados

- [[adr-005-canva-api-migração]]
- [[canva-connect-api]]
- [[infraestrutura-tecnica]]
- [[agente-designer]]
