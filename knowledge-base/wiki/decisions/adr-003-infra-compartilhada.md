---
title: "ADR-003 — Infraestrutura compartilhada entre Bot Gabi e Agente Marcelle"
type: decision
tags:
  - "adr"
  - "infraestrutura"
  - "gabi"
  - "marcelle"
  - "easypanel"
  - "evolution-api"
  - "redis"
  - "postgresql"
sources:
  - "features/bot-gabi.md"
  - "features/automacao-notificacao-marcelle.md"
  - "workflows/escopo-projeto-assinatura.md"
created: 2026-05-03
updated: 2026-05-03
---

# ADR-003 — Infraestrutura compartilhada entre Bot Gabi e Agente Marcelle

## Resumo

Decisão de reutilizar a infraestrutura técnica construída para o Bot Gabi (FastAPI + Evolution API + Redis + PostgreSQL + EasyPanel) para o Agente Marcelle, sem nenhum custo adicional de infraestrutura.

## Contexto

Os dois contratos da Assinatura (Gabi 4 meses, Marcelle 4 meses) rodam em paralelo. O Bot Gabi foi construído primeiro. Quando chegou a hora de planejar o Agente Marcelle, havia dois caminhos: (1) infraestrutura nova, (2) reaproveitamento da base do Gabi.

## Decisão

**Reutilizar 100% da camada de infraestrutura do Bot Gabi** para o Agente Marcelle:

| Camada | Componente | Reuso |
|---|---|---|
| WhatsApp | Evolution API v2 | ✅ Mesmo provider, nova instância |
| Runtime | FastAPI + Python 3.12 | ✅ Mesmo framework |
| Estado/debounce | Redis | ✅ Mesmo cluster, namespace separado |
| Persistência | PostgreSQL | ✅ Mesmo banco, schemas separados |
| Deploy | EasyPanel (Docker Compose) | ✅ Mesmo painel, novo serviço |

Apenas os **handlers e a lógica de negócio** da Marcelle serão desenvolvidos do zero (controle de projetos, status de clientes, reports Asana).

## Consequências

| Aspecto | Resultado |
|---|---|
| Custo | Zero custo adicional de infra para o Agente Marcelle |
| Time-to-market | Estimativa de setup 2–3 dias em vez de 2 semanas |
| Acoplamento | Qualquer mudança de infra afeta ambos os bots — isolar com configurações independentes |
| Risco | Falha no Redis/PostgreSQL afeta Gabi e Marcelle simultaneamente |

## Alternativas rejeitadas

- **Infraestrutura separada** — custo e tempo de setup injustificados dado o modelo de contrato.
- **Serviço monolito** — Gabi e Marcelle no mesmo processo — rejeitado por separação de responsabilidades e risco de interferência entre handlers.

## Relacionados

- [[bot-gabi]]
- [[automacao-notificacao-marcelle]]
- [[infraestrutura-tecnica]]
- [[escopo-projeto-assinatura]]
