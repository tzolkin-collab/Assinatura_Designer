---
title: Overview — Síntese Dinâmica
type: architecture
tags:
  - "overview"
  - "synthesis"
sources: []
created: 2026-04-22
updated: 2026-05-13
---

# 🗺️ Overview — Síntese Dinâmica do Projeto

> Este arquivo é **sobrescrito** por `/memory-consolidate` com base na semana corrente.
> Não editar à mão em seções geradas (marcadas com `<!-- auto -->`).

## Estado Atual

**Referência: 2026-05-13 — execução adiantada frente ao cronograma contratual**

- **Bot Gabi (Secretaria A.I.) — Mês 2/3:** MVP 1 e MVP 2 já implementados; bot partindo para testes. Principal pendência operacional informada: integração com Google Drive. Está adiantado em relação ao cronograma original, porque o Mês 3 só começaria em 20/05/2026.
- **Agente Designer — Mês 2/3:** CanvasEditor próprio reativado pela ADR-006; Fábrica v2, Galeria, pipeline IA, multi-select, preview de animação e validações lint/build estão funcionais. Está quase finalizado para a fase atual e indo para testes com Gabi. Pendências reais: validação de fluxo ponta-a-ponta, upload/R2 com erro claro, Drive no ecossistema Gabi e limpeza pós-ADR-006. A ideia de “Vercel AI SDK + agente por marca” é proposta histórica não implementada, não pendência ativa.
- **Automação Marcelle — Mês 2:** Mês 1 ✅ entregue; fluxo evoluindo para teste operacional na semana de 18/05/2026. Está saindo de escopo indefinido para validação prática antecipada.

## Pilares Arquiteturais

<!-- auto:pillars -->
- [[designer-backend]] — Express + Prisma + PostgreSQL + Gemini; Canva permanece histórico/stand-by após ADR-006
- [[designer-frontend]] — Next.js App Router, [marca] scoping, SSE streaming, CanvasEditor próprio reativado por ADR-006
<!-- /auto:pillars -->

## Features em Produção

<!-- auto:features -->
- [[agente-designer]] — App designer IA | ADR-006: CanvasEditor próprio reativado | Fábrica, Galeria, pipeline IA e editor visual funcionais 🔄 validação com Gabi
- [[fabrica-v2]] — Redesign procedural (Wizard) + Preview responsivo | status: ✅ Estável
- [[galeria-gestao]] — DND para pastas + Exclusão de artes | status: ✅ Estável
- [[secretaria-ai-gabi]] — Agente WhatsApp + atas + gerador de imagens | 4 meses | até 14/07/2026 | Mês 1 ✅ | Mês 2 ✅ | Mês 3 ✅ adiantado/testes
- [[secretaria-ai-mes2]] — Semanas 5–8 | deadline 19/05/2026 | contexto histórico; status atual adiantado em 2026-05-13
- [[automacao-notificacao-marcelle]] — 4 meses | até 21/07/2026 | Mês 1 ✅ | Mês 2 🔄 teste operacional semana 18/05/2026
<!-- /auto:features -->

## Integrações Ativas

<!-- auto:integrations -->
- [[infraestrutura-tecnica]] — Asana API ✅ · WhatsApp + Evolution API ✅ · EasyPanel ✅ · Agente Designer 🔄 · Agente Marcelle Mês 2 🔄 teste
- [[stripe-webhook]] — Webhook ✅ · Facebook CAPI ⚠️ (credenciais pendentes) · TikTok CAPI ⚠️ (falha auth) · UTM ❌ (não implementado)
- [[canva-connect-api]] — Histórico/stand-by pós-ADR-006; não é caminho principal do editor embarcado
<!-- /auto:integrations -->

## Decisões Recentes

<!-- auto:decisions -->
- [[adr-001-next-express-separados]] — Frontend e backend como processos distintos no Designer
- [[adr-002-gemini-llm-designer]] — Gemini Flash em vez de GPT-4o para geração de layouts JSON
- [[adr-003-infra-compartilhada]] — FastAPI + Evolution API + Redis + PostgreSQL reaproveitados
- [[adr-005-canva-api-migração]] — decisão histórica superada pela ADR-006 para edição principal embarcada
- [[adr-006-editor-visual-alternativas-canva]] — **ACEITA (2026-05-11)** CanvasEditor próprio reativado; Canva em stand-by
<!-- /auto:decisions -->

## Dívida Técnica Conhecida

<!-- auto:debt -->
_(populado por `/memory-lint`)_
<!-- /auto:debt -->

---

## Como Manter

- Seções automáticas: não tocar — `/memory-consolidate` cuida.
- Seções livres (ex: "Estado Atual"): pode editar à mão; consolidate preserva.
