---
title: Automação de Notificação (Marcelle)
type: feature
tags:
  - "marcelle"
  - "asana"
  - "whatsapp"
  - "reports"
  - "projetos"
  - "automação"
  - "erm"
  - "dashboard"
sources:
  - "Diagnostico_Assinatura.docx"
  - "CONTEXTO.md"
created: 2026-04-22
updated: 2026-05-13
---

# Automação de Notificação (Marcelle)

## Resumo

Sistema de visibilidade, estimativas e automação do fluxo de projetos para Marcelle (frente de projetos). Prazo de **4 meses** com 1 MVP por mês. Início: 24/03/2026 — Entrega final: ~21/07/2026. Financiamento via Mercado Pago: R$ 1.000/mês × 10 parcelas. Rodando **em paralelo** com a Secretária A.I. da Gabi.

## Detalhes

### Cronograma

| Mês | Período | Fase | Desenvolvimento | MVP | Status |
|---|---|---|---|---|---|
| Mês 1 | 24/03–21/04 | Infraestrutura + Consultoria | ERMs criados, banco de dados, integração Asana, estimativa de tempo, relatórios com dados reais, fluxo completo validado | MVP 1 — Base de dados e automação Asana funcionando | ✅ Entregue |
| Mês 2 | 22/04–19/05 | Preparação de teste | Agente reativo e fluxo operacional usando base Asana/WhatsApp | Teste operacional com Marcelle | 🔄 Saída para teste prevista na semana de 18/05/2026 |
| Mês 3 | 20/05–16/06 | Ajustes pós-teste | Correções de fluxo, reports e respostas por status de projeto | MVP 3 — fluxo validado e refinado | ⏳ Aguardando resultado dos testes |
| Mês 4 | 17/06–14/07 | Lançamento e estabilização | Validação final, documentação operacional e ajustes de confiabilidade | MVP 4 — operação estável | ⏳ Não iniciado |

> **Nota:** O escopo inicial documentado (4 semanas) correspondia ao Mês 1. Em 2026-05-13, o fluxo da Marcelle já está evoluindo para teste operacional na semana de 18/05/2026; Meses 3–4 dependem do resultado desses testes.

### Features Mapeadas

- **Controle de estágio do cliente** — visibilidade de onde cada projeto está no ciclo de vida
- **Agente reativo no WhatsApp** — Marcelle pergunta "como está o projeto X?" → resposta automática com status atualizado
- **Visualização interna e para o cliente** — funil de projetos, erros e atrasos (lado empresa + lado cliente)
- **Reports automáticos** — alertas sobre atrasos ou erros no andamento dos projetos
- **Fusão com infraestrutura da Gabi** — Agente Marcelle inicia após Secretária A.I., sem acréscimo de custo

### Fora do Escopo

- **Dashboard unificado** ("sonho" de Marcelle — ver tudo em uma tela): formalizar exige UX dedicada e revisão de valor contratual.

### Financeiro

| Campo | Valor |
|---|---|
| Gateway | Mercado Pago |
| Parcelas | R$ 1.000/mês × 10 |
| Status | ⚠️ Pendente: confirmar juros e número exato com gerente do Mercado Pago |

## Decisões Tomadas

- Contrato é de 4 meses em paralelo com Gabi (não sequencial como estava documentado anteriormente).
- Escopo dos Meses 2–4 a ser definido — Mês 1 entregou a base Asana; próximos meses devem expandir para agente WhatsApp reativo e reports avançados.
- **Base técnica:** reaproveitamento direto do `Bot_Gabi/` (FastAPI + Evolution API + Redis + PostgreSQL + EasyPanel) — apenas handlers e lógica de negócio próprios da Marcelle serão novos. Zero custo adicional de infraestrutura.

## Learnings

- ERM e integração Asana são o alicerce — atrasos na Semana 1 propagam para todas as semanas seguintes.
- Diagnóstico indireto (via Asana) é fonte de incerteza de escopo — realizar sessão presencial o quanto antes para reduzir risco.

## Relacionados

- [[escopo-projeto-assinatura]] — contrato e visão geral
- [[bot-gabi]] — base de código que será reaproveitada (FastAPI + Evolution API + Redis + PostgreSQL)
- [[secretaria-ai-gabi]] — produto Gabi entregue antes
- [[infraestrutura-tecnica]] — Asana API, WhatsApp, Evolution API
