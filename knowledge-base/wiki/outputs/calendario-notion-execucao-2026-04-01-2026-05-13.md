---
title: "Calendário Notion — Execução 2026-04-01 a 2026-05-13"
type: output
tags:
  - "notion"
  - "calendario"
  - "execucao"
  - "gabi"
  - "designer"
  - "marcelle"
sources:
  - "wiki/log.md"
  - "wiki/workflows/designer-timeline-execucao.md"
  - "wiki/features/bot-gabi.md"
  - "wiki/features/secretaria-ai-gabi.md"
  - "wiki/features/automacao-notificacao-marcelle.md"
  - "wiki/overview.md"
created: 2026-05-14
updated: 2026-05-14
---

# Calendário Notion — Execução 2026-04-01 a 2026-05-13

## Uso no Notion

- Granularidade: semanal.
- Período coberto: 2026-04-01 a 2026-05-13.
- Formato recomendado no Notion: database com propriedades `Name`, `Start Date`, `End Date`, `Áreas`, `Status`, `Principais entregas`, `Evidências KB` e `Observações`.
- CSV gerado para importação: `calendario-notion-execucao-2026-04-01-2026-05-13.csv`.

## Resumo executivo

Entre 01/04 e 13/05, a execução saiu de uma fase inicial de implementação do Bot Gabi e base do Designer para um estado com MVPs adiantados, Designer funcional, Fábrica v2/Galeria estabilizadas, CanvasEditor próprio reativado e auditoria geral consolidada. A frente Marcelle teve o Mês 1 consolidado como entregue e foi reposicionada para teste operacional na semana de 18/05.

## Calendário semanal

| Semana | Início | Fim | Áreas | Status | Principais entregas | Evidências KB | Observações |
|---|---:|---:|---|---|---|---|---|
| Semana 1 — Preparação operacional inicial | 2026-04-01 | 2026-04-06 | Gabi, Marcelle, Designer | Histórico / parcialmente documentado | Janela inicial do período solicitado. O contrato já estava ativo desde 24/03. As entregas formais registradas na KB para Gabi/Marcelle cobrem o Mês 1, mas a rastreabilidade detalhada começa depois, com commits do Bot Gabi em 09–11/04 e consolidação em 22/04. | [[secretaria-ai-gabi]], [[automacao-notificacao-marcelle]], [[escopo-projeto-assinatura]] | Não há evento granular no `log.md` entre 01/04 e 06/04; registrar como semana de preparação/execução anterior à KB canônica. |
| Semana 2 — Bot Gabi MVP 1/2 implementado | 2026-04-07 | 2026-04-13 | Gabi | Entregue | Commits de 09–11/04 registram implementação do Bot Gabi: auto-reply em reuniões/eventos, atas no Asana, handlers Asana, mídia, Redis, PostgreSQL, Evolution API e deploy EasyPanel. | [[bot-gabi]], [[secretaria-ai-gabi]], [[infraestrutura-tecnica]] | A KB registra esses commits como base real dos MVPs 1 e 2; a ingestão formal veio em 22/04. |
| Semana 3 — Base do Designer criada | 2026-04-14 | 2026-04-20 | Designer | Entregue / sem doc na época | Commit inicial do Designer em 19/04: frontend Next.js, backend Express, Prisma/PostgreSQL, rotas auth/settings/posts/ai, CanvasEditor, Fábrica, Galeria e estrutura base. | [[2026-04-22]], [[agente-designer]], [[designer-backend]], [[designer-frontend]] | A consolidação de 22/04 identificou que o commit existia mas ainda não tinha documentação correspondente. |
| Semana 4 — KB canônica, Sprint 0, qualidade, Fábrica v2 e Galeria | 2026-04-21 | 2026-04-27 | Designer, Gabi, Marcelle, KB | Entregue | 22/04: KB inicializada, ingestão de escopo, Gabi, Marcelle, infraestrutura, Designer, stakeholders e Bot Gabi. 24/04: pesquisa de imagem/PDF, auditoria de jornada, plano de implementação e auditoria de libs. 25/04: Sprint 0 do Designer com SDK `@google/genai`, Gemini 2.5, endpoint de imagem, env de API, correções de config e auditoria UX. 27/04: lint/build limpos, Fábrica v2 com wizard, preview responsivo, assets e Galeria com pastas/DND/exclusão. | [[log]], [[pesquisa-geracao-imagens-pdf-designer]], [[designer-auditoria-jornada]], [[designer-plano-implementacao]], [[auditoria-libs-configs]], [[auditoria-ux-logica-designer]], [[qualidade-lint-build]], [[fabrica-v2]], [[galeria-gestao]] | Semana mais densa do período: transforma o Designer de base funcional parcial em MVP técnico navegável. |
| Semana 5 — Consolidação, ADRs estruturais e evolução da Fábrica | 2026-04-28 | 2026-05-04 | Designer, Gabi, Marcelle, Infra | Entregue / decisões em aberto | 03/05: sanitização da KB, correção do contrato Marcelle para 4 meses paralelos, ingestão de Secretaria A.I. Mês 2, ADR-001, ADR-002, ADR-003, Stripe webhook e migration semanal. 04/05: ingestão de agente multimodelo, render layout-as-data, benchmarking UX da Fábrica, proposta Fábrica sem wizard, biblioteca de layouts, fluxo central da Secretaria A.I. e consolidação KB1→KB2. | [[2026-05-03]], [[secretaria-ai-mes2]], [[adr-001-next-express-separados]], [[adr-002-gemini-llm-designer]], [[adr-003-infra-compartilhada]], [[stripe-webhook]], [[benchmarking-fabrica-ux]], [[fabrica-redesign]], [[fabrica-biblioteca-layouts]], [[secretaria-ai-sistema]] | Semana de organização estratégica: arquitetura registrada e conflitos de direção da Fábrica explicitados. |
| Semana 6 — ADR-005/ADR-006 e retorno do CanvasEditor próprio | 2026-05-05 | 2026-05-11 | Designer | Entregue / direção corrigida | 05/05: ADR-005 aceita temporariamente para Canva Connect API, com integração Canva documentada. 06/05: ADR-006 aberta após descoberta de bloqueios do Canva iframe, Penpot por RAM e Fabric.js por custo de reconstrução; canvas de agentes criado. 11/05: ADR-006 aceita; CanvasEditor próprio reativado; geminiRetry, imageNormalizer, pipeline 3 passos, jobStore, FAL AI fallback Pollinations, Folder model, rotas folders/upload, correções de crash/null layers e fallback Pollinations. | [[adr-005-canva-api-migração]], [[canva-connect-api]], [[adr-006-editor-visual-alternativas-canva]], [[agentes-mapa-funcoes]], [[designer-backend]], [[designer-frontend]], [[agente-designer]] | Semana decisiva: Canva sai do caminho principal e o editor embarcado volta a ser a direção oficial. |
| Semana 7 — Multi-select, geração robusta, preview de animação e auditoria geral | 2026-05-12 | 2026-05-13 | Designer, Gabi, Marcelle, KB | Entregue / pronto para teste com pendências P0/P1 | 12/05: multi-select no editor, marquee, multi-drag, MultiSelectPanel, ShortcutsPanel e atalhos em massa. Auditoria da Fábrica com 6 correções no pipeline: text zones estruturadas, clamp de layers, prompt decisivo, cálculo de altura de texto e consistência visual. 13/05: preview de animação, persistência de abas, limpeza de dead code, timeline do Designer, status Gabi/Marcelle atualizado, ADR-004 adiada por último e auditoria geral com P0/P1/P2. | [[designer-frontend]], [[agente-designer]], [[designer-timeline-execucao]], [[secretaria-ai-gabi]], [[bot-gabi]], [[automacao-notificacao-marcelle]], [[adr-004-fabrica-arquitetura-v3]], [[auditoria-geral-designer-2026-05-13]], [[overview]] | Estado em 13/05: Gabi partindo para testes com Drive pendente; Marcelle prevista para teste na semana de 18/05; Designer funcional com P0 de ownership/folders a corrigir. |

## Linha do tempo de datas-chave

| Data | Evento | Área | Fonte |
|---:|---|---|---|
| 2026-04-09 a 2026-04-11 | Commits do Bot Gabi implementam MVP 1 e MVP 2 | Gabi | [[bot-gabi]], [[secretaria-ai-gabi]] |
| 2026-04-19 | Commit inicial do Designer | Designer | [[2026-04-22]] |
| 2026-04-22 | KB inicializada e ingestão de escopo, Gabi, Marcelle, infraestrutura, Designer e stakeholders | KB / Projetos | [[log]], [[index]] |
| 2026-04-24 | Pesquisa técnica, auditoria de jornada, plano de implementação e auditoria de libs/configs | Designer | [[pesquisa-geracao-imagens-pdf-designer]], [[designer-plano-implementacao]], [[auditoria-libs-configs]] |
| 2026-04-25 | Sprint 0 do Designer concluída | Designer | [[auditoria-ux-logica-designer]], [[agente-designer]] |
| 2026-04-27 | Qualidade/lint/build, Fábrica v2 e Galeria | Designer | [[qualidade-lint-build]], [[fabrica-v2]], [[galeria-gestao]] |
| 2026-05-03 | Consolidação semanal, ADRs 001–003 e Stripe | KB / Infra | [[2026-05-03]], [[stripe-webhook]] |
| 2026-05-04 | Benchmarking, Fábrica Redesign, biblioteca de layouts e fluxo central da Secretaria A.I. | Designer / Gabi | [[benchmarking-fabrica-ux]], [[fabrica-redesign]], [[fabrica-biblioteca-layouts]], [[secretaria-ai-sistema]] |
| 2026-05-05 | ADR-005 Canva Connect API aceita temporariamente | Designer | [[adr-005-canva-api-migração]], [[canva-connect-api]] |
| 2026-05-06 | ADR-006 aberta e mapa visual dos agentes criado | Designer / Gabi / Marcelle | [[adr-006-editor-visual-alternativas-canva]], [[agentes-mapa-funcoes]] |
| 2026-05-11 | ADR-006 aceita e CanvasEditor próprio reativado | Designer | [[adr-006-editor-visual-alternativas-canva]], [[designer-frontend]], [[designer-backend]] |
| 2026-05-12 | Multi-select do editor e auditoria/correções do pipeline da Fábrica | Designer | [[designer-frontend]], [[agente-designer]] |
| 2026-05-13 | Timeline, status real Gabi/Marcelle, ADR-004 adiada e auditoria geral | Designer / Gabi / Marcelle | [[designer-timeline-execucao]], [[overview]], [[auditoria-geral-designer-2026-05-13]] |

## Pendências após 13/05

- P0 Designer: ownership em posts/folders e validação de `folderId`.
- P1 Designer: validação real com Gabi, warnings de lint, upload/R2 com erro claro.
- Gabi: integração Google Drive antes/ao longo da bateria de testes.
- Marcelle: teste operacional previsto para semana de 18/05/2026.
- ADR-004: decisão Wizard vs No-Wizard fica por último.

## Relacionados

- [[log]]
- [[designer-timeline-execucao]]
- [[overview]]
- [[bot-gabi]]
- [[secretaria-ai-gabi]]
- [[automacao-notificacao-marcelle]]
- [[auditoria-geral-designer-2026-05-13]]
