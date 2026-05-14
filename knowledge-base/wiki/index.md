---
title: Index — Catálogo Master da Wiki
type: architecture
tags:
  - "index"
  - "toc"
sources: []
created: 2026-04-22
updated: 2026-05-13
---

# 🗂️ Index — Catálogo Master

> Toda página nova da wiki DEVE ser registrada aqui na seção correspondente.
> O `/memory-query` usa este arquivo como ponto de partida para localizar conteúdo.

## 🏛️ Architecture

- [[designer-backend]] — Express + Prisma + PostgreSQL + Gemini; rotas, auth middleware, nanoBanana engine
- [[designer-frontend]] — Next.js App Router, [marca] dynamic routes, Fábrica (chat/SSE), CanvasEditor
- [[agente-multimodelo]] — Proposta histórica LLM + tools; Vercel AI SDK não foi implementado no Designer atual
- [[render-layout-as-data]] — JSON layers → SVG → PNG; adapter layersToJsx; BrandFont no R2; versionamento de schema

## ✨ Features

- [[bot-gabi]] — FastAPI+Python; MVP 1 ✅ (auto-reply) e MVP 2 ✅ (atas→Asana) implementados; deploy EasyPanel
- [[agente-designer]] — App Next.js+Express de geração de designs via Nano Banana (Gemini JSON mode); Sprint 1 🔄
- [[fabrica-v2]] — Novo fluxo wizard 3-steps, preview responsivo e gestão de assets (2026-04-27)
- [[fabrica-redesign]] — ⚠️ CONFLITO com v2; proposta sem wizard, React+Supabase; pendente decisão de arquitetura
- [[fabrica-biblioteca-layouts]] — 6 layouts MVP, layoutKey canônico, metadados, benchmarking de modelos
- [[galeria-gestao]] — Drag-and-drop para pastas, exclusão de artes e atualização reativa (2026-04-27)
- [[secretaria-ai-gabi]] — Agente WhatsApp + atas + gerador de imagens; bot partindo para testes; Drive pendente; execução adiantada (2026-05-13)
- [[secretaria-ai-mes2]] — Semanas 5–8 | deadline 19/05/2026 | histórico; status atual avançou para testes
- [[automacao-notificacao-marcelle]] — 4 meses paralelos, R$ 1.000/mês × 10 | Mês 1 ✅ | Mês 2 🔄 teste operacional semana 18/05/2026

## 🔌 Integrations

- [[infraestrutura-tecnica]] — Asana API ✅ + WhatsApp/Evolution API ✅ + EasyPanel + Gemini + ChatGPT
- [[stripe-webhook]] — Webhook ✅ | Facebook CAPI ⚠️ | TikTok CAPI ⚠️ | UTM ❌ (não implementado)
- [[canva-connect-api]] — Histórico/stand-by pós-ADR-006; não é o caminho principal do editor embarcado

## 🔐 Security

_Nenhuma página ainda. Criar: JWT httpOnly vs localStorage (ADR pendente)._

## 🔄 Workflows

- [[escopo-projeto-assinatura]] — Contrato Lucas × Assinatura Ltda; dois produtos paralelos (Gabi 4m + Marcelle 4m)
- [[qualidade-lint-build]] — Lint e build limpos no frontend e backend (2026-04-27)
- [[secretaria-ai-sistema]] — Visão de produto: triagem→pipeline; integrações WPP/Asana/GAgenda; cronograma 4 meses

## 👥 Stakeholders

- [[amanda-coelho]] — Fundadora/CEO da Assinatura; origina funis e estratégia; decisora final
- [[assinatura-marca-propria]] — Consultoria de marca própria em cosméticos; BH; 2.000+ clientes
- [[gabi]] — Gestora de novos projetos (palestras, expansão); dor: gargalo de tempo; produto: Secretária A.I.
- [[marcelle]] — Gestora do projeto principal; gênio operacional; produto: Automação via WhatsApp

## 🧭 Decisions (ADRs)

- [[adr-001-next-express-separados]] — Frontend e backend como processos distintos no Agente Designer
- [[adr-002-gemini-llm-designer]] — Gemini Flash em vez de GPT-4o para geração de layouts JSON
- [[adr-003-infra-compartilhada]] — FastAPI + Evolution API + Redis + PostgreSQL reaproveitados sem custo extra
- [[adr-004-fabrica-arquitetura-v3]] — ⏳ PENDENTE/ADIADA: decisão fica por último; Fábrica v2/Wizard permanece base operacional
- [[adr-005-canva-api-migração]] — decisão histórica superada pela ADR-006 para edição principal embarcada
- [[adr-006-editor-visual-alternativas-canva]] — **ACEITA (2026-05-11):** CanvasEditor próprio (react-rnd) reativado — embarcado, zero infra extra; Penpot adiado por RAM insuficiente; Fabric.js preterido

## 📦 Migrations (Consolidações Semanais)

- [[2026-04-22]] — Primeira consolidação: 1 commit designer, 3 gaps de doc identificados
- [[2026-05-03]] — Semana 5 ✅ | Semana 6 🔄 | ADRs criados | Stripe mapeado | gaps ativos listados
- [[2026-05-05]] — **ADR-005 aceita:** Migração CanvasEditor → Canva Connect API | 3 novos docs | 6 docs atualizados

## 📚 Outputs (Queries Arquivadas)

- [[pesquisa-geracao-imagens-pdf-designer]] — Opções e recomendações para conectar a tool "Imagem" (stub) e adicionar export PDF ao CanvasEditor (2026-04-24)
- [[designer-auditoria-jornada]] — Canvas Obsidian: jornada do cliente, auditoria de configurações, gaps por etapa e urgências (2026-04-24)
- [[agentes-mapa-funcoes]] — Canvas Obsidian: Gabi (Fernanda) + Marcelle, funções por status, infraestrutura compartilhada (2026-05-06)
- [[designer-plano-implementacao]] — Sprints, necessidades técnicas, riscos e critérios de aceite para fechar os gaps do Designer (2026-04-24)
- [[auditoria-libs-configs]] — 9 problemas mapeados: L1+L2 resolvidos Sprint 0, L3–L9 em aberto (2026-04-24, atualizado 2026-04-25)
- [[auditoria-ux-logica-designer]] — Sprint 0 concluído; fluxo de config/referencias; gaps UX+segurança; needs para Sprint 1 (2026-04-25)
- [[benchmarking-fabrica-ux]] — Canva/Beautiful.ai/Gamma/Pitch/Slidebean; 5 padrões recorrentes; proposta de layout 3-painéis para a Fábrica (2026-05-04)
- [[calendario-notion-execucao-2026-04-01-2026-05-13]] — Calendário semanal para Notion cobrindo entregas de 01/04 a 13/05 com CSV importável (2026-05-14)

---

## 📖 Como Navegar

- **Visão geral rápida:** [[overview]]
- **Timeline linear:** [[log]]
- **Timeline visual:** abrir `tracking.canvas` no Obsidian
- **Schema e regras:** [[CLAUDE]]
