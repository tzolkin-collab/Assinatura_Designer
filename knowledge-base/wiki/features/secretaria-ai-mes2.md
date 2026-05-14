---
title: "Secretaria A.I. — Mês 2 (Semanas 5–8)"
type: feature
tags:
  - "gabi"
  - "secretaria-ai"
  - "mes2"
  - "whatsapp"
  - "google-agenda"
  - "asana"
  - "novos-negocios"
  - "pipelines"
  - "mvp2"
sources:
  - "wiki/relatorio-semanas-1-8.md"
  - "features/secretaria-ai-gabi.md"
  - "features/bot-gabi.md"
created: 2026-05-03
updated: 2026-05-03
---

# Secretaria A.I. — Mês 2 (Semanas 5–8)

## Resumo

Fase atual do contrato Gabi — Secretaria A.I. Período: 21/04 → 19/05/2026. Meta: fluxo WhatsApp → triagem → Agenda Amanda + Pipeline Novos Negócios funcionando end-to-end. MVPs 1 e 2 do cronograma original já foram entregues no Mês 1; o Mês 2 avança para os pipelines de negócio reais.

## Detalhes

### Cronograma do Mês 2

| Semana | Período | Foco | Entrega esperada | Status |
|---|---|---|---|---|
| Semana 5 | 21/04–28/04 | Infraestrutura base | EvolutionAPI configurada, Postgres schema, webhook recebendo mensagens, triagem básica | ✅ Concluída |
| Semana 6 | 28/04–05/05 | Processamento de mídia + Agenda | Transcrição de áudios, extração de fotos/docs, leitura e escrita na Google Agenda da Amanda | 🔄 Em andamento |
| Semana 7 | 05/05–12/05 | Pipelines de negócio | Pipeline Novos Negócios (briefing → Asana) + Pipeline Agenda Amanda (evento → Agenda sem conflito) | ⏳ Planejado |
| Semana 8 | 12/05–19/05 | Integração e entrega | Fluxo end-to-end testado com a Gabi, ajustes de UX, entrega MVP 2 | ⏳ Planejado |

### Status Semana 5 (detalhado — via Asana)

| Tarefa | Responsável | Status |
|---|---|---|
| Primeira Visita com a Gabi e Marcelle | Lucas + Sales | ✅ |
| Configuração da VPS (servidor) | Saleco | ✅ |
| EvolutionAPI (wpp) + Postgres | Lucas + Sales | ✅ |
| Conexão Básica Asana | Lucas | ✅ |
| Funções de conversa + Rotas Básicas | Saleco | ✅ |
| Testes end-to-end com a Gabi | Saleco | ✅ |

### Status Semana 6 (parcial — via Asana)

| Tarefa | Responsável | Status |
|---|---|---|
| Pipelines Novos Negócios + Agenda Amanda | Lucas | 🔄 Em andamento |
| Preparação para conexão com o Google Drive | Lucas | ✅ |
| Conseguir os acessos de contas da Gabi | Lucas | ✅ |
| Configuração do Postgres + Backend Básico | Saleco | ❌ Pendente |
| Renderizador Satori + Resvg → PNG, tabela Brand | Saleco | ❌ Pendente |

> ⚠️ **Atenção:** "Renderizador Satori + Resvg → PNG" aparece como tarefa da Semana 6 do Bot Gabi no Asana, mas pertence ao escopo do **Designer da Gabi** (Mês 2, semana de geração de imagens). Verificar se houve reclassificação de escopo ou se é task do Designer rodando em paralelo.

### Integrações críticas desta fase

- **EvolutionAPI** — entrada de mensagens WhatsApp ✅ (Semana 5 concluída)
- **Google Agenda** — leitura + escrita de eventos da Amanda ⏳
- **Google Drive** — conexão preparada ✅, implementação ⏳ (Mês 3 do contrato original)
- **Asana** — criação de tasks pipeline Novos Negócios ⏳
- **PostgreSQL** — schema do Mês 2 ❌ (Semana 6, pendente)

### Dois pipelines do MVP 2

```
Pipeline 1 — Novos Negócios:
  Mensagem WhatsApp (cliente/parceiro) 
  → Bot extrai briefing (Gemini)
  → Cria task no Asana (projeto Novos Negócios)
  → Confirma para a Gabi

Pipeline 2 — Agenda Amanda:
  Mensagem WhatsApp (pedido de agenda)
  → Bot lê Google Agenda (verificar conflito)
  → Se livre: cria evento + confirma
  → Se ocupado: sugere alternativas
  → Gabi aprova → agenda
```

## Riscos ativos

| Risco | Mitigação |
|---|---|
| EvolutionAPI com breaking changes | Adapter isolado — trocar provider sem afetar handlers |
| Conflito de agenda Amanda sem regra clara | Definir regra com a Gabi antes da Semana 7 |
| Acesso Google Agenda via OAuth em produção | OAuth já iniciado (Semana 6) — verificar escopo dos tokens |
| Semana 6 com 2 tasks ❌ (Postgres + Satori) | Priorizar Postgres para não bloquear Semana 7 |

## Decisões Tomadas

- Triagem básica implementada na Semana 5 — keyword match + fallback LLM (padrão do Bot Gabi).
- Google Drive postergado para Mês 3 do contrato — não bloqueia MVP 2.
- Satori/Resvg para renderização PNG pertence ao Designer, não ao Bot — verificar se ficou na sprint errada.

## Relacionados

- [[bot-gabi]] — base técnica deste mês
- [[secretaria-ai-gabi]] — cronograma dos 4 meses
- [[agente-designer]] — rodando em paralelo
- [[gabi]]
