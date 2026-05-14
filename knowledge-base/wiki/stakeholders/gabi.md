---
title: Gabi — Gestora de Novos Projetos
type: stakeholder
tags:
  - "gabi"
  - "gabriela"
  - "gestora"
  - "whatsapp"
  - "asana"
  - "secretaria-ai"
  - "expansão"
  - "palestras"
sources:
  - "Diagnostico_Assinatura.docx"
created: 2026-04-22
updated: 2026-04-22
---

# Gabi — Gestora de Novos Projetos

## Resumo

Gabriela é a gestora das novas frentes de receita da Assinatura — palestras, expansão de negócios e outros produtos que partem dos funis criados por Amanda (a dona). Sua principal dor é o gargalo de tempo: ela lida com múltiplas frentes simultaneamente e perde capacidade de resposta. O projeto para ela é uma secretária literal no WhatsApp, integrada ao Asana.

## Detalhes

### Papel na Empresa

| Campo | Valor |
|---|---|
| Cargo | Gestora de Novos Projetos / Expansão e Assessoria |
| Responsabilidade | Palestras, novos produtos, expansão de negócios, funis da Amanda |
| Principal dor | Gargalo de tempo — muitas frentes simultâneas sem suporte operacional |
| Ferramenta principal | WhatsApp (comunicação) + Asana (gestão de tarefas) |

### Mapeamento de Necessidades (diagnóstico presencial — concluído)

| Necessidade | Solução no Projeto |
|---|---|
| Responder WhatsApp durante reuniões/eventos | Mensagens automáticas via agente (Mês 1) |
| Gerar e publicar atas de reunião no Asana | Pipeline Gemini → ChatGPT → Asana (Mês 2) |
| Criar imagens e apresentações para os funis | Agente Designer com interface UX externa (Mês 3–4) |

### Fluxo de Trabalho Atual (antes da automação)

```
Amanda cria funil / nova frente
  → Gabi recebe e precisa:
      - Responder leads no WhatsApp (interrompendo reuniões)
      - Fazer anotações e publicar atas manualmente
      - Criar materiais visuais para palestras/eventos
      - Agendar e acompanhar tarefas no Asana
  → Gargalo: tudo passa pela Gabi manualmente
```

### Fluxo com a Secretária A.I.

```
Amanda cria funil / nova frente
  → Agente responde WhatsApp automaticamente durante ausências
  → Atas geradas via Gemini → ChatGPT → Asana automaticamente
  → Materiais visuais gerados pelo Agente Designer
  → Gabi foca nas decisões estratégicas, não no operacional
```

## Decisões Tomadas

- Diagnóstico presencial com Gabi já concluído — escopo totalmente mapeado.
- Interface do Agente Designer é **externa ao WhatsApp** — operações visuais complexas não cabem no chat.

## Relacionados

- [[secretaria-ai-gabi]] — produto sendo desenvolvido para ela
- [[amanda-coelho]] — origem dos funis que Gabi gere
- [[assinatura-marca-propria]] — empresa onde atua
- [[infraestrutura-tecnica]] — WhatsApp + Asana API
