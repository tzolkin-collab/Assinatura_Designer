---
title: Secretaria A.I. — Fluxo Central do Sistema
type: workflow
tags:
  - "secretaria"
  - "gabi"
  - "bot"
  - "whatsapp"
  - "asana"
  - "google-agenda"
sources:
  - "Projeto Assinatura/wiki/concepts/secretaria-ai-sistema.md"
created: 2026-05-04
updated: 2026-05-04
---

# Secretaria A.I. — Fluxo Central

## Resumo
Visão de produto da Secretaria A.I. da Gabi: o bot recebe demandas brutas (áudio, foto, doc), classifica, organiza a pipeline e aciona os responsáveis — sem exigir que a Gabi conduza cada etapa manualmente.

## Detalhes

### Fluxo central

```
Gabi (entrada bruta: áudio, foto, doc)
    → Bot (triagem)
        ├── Novos Negócios → pipeline comercial
        └── Agenda Amanda → controle de agenda + eventos
```

### Regra de ouro
> O sistema deve **sustentar processos fixos ativos**. Uma vez que uma demanda entra, o bot sabe qual é o próximo passo e só devolve o status para a Gabi quando ela precisa tomar uma decisão.

### Etapas de processamento

| Etapa | O que o bot faz |
|-------|----------------|
| Triagem | Classifica a demanda recebida |
| Aprovação | Aciona financeiro e aguarda OK |
| Padronização | Garante que nenhuma etapa seja pulada |
| Comunicação | Centraliza pedidos e devolve autonomia para a Gabi |

### Integrações

| Sistema | Papel |
|---------|-------|
| WhatsApp (EvolutionAPI) | Entrada de demandas |
| Asana | Gestão de tasks |
| Google Agenda | Agenda da Amanda |
| Google Drive | Documentos |
| ChatGPT / Gemini | Processamento de linguagem |
| PostgreSQL | Banco de dados |

### Cronograma de desenvolvimento

| Mês | Semanas | Foco | MVP | Deadline |
|-----|---------|------|-----|----------|
| Mês 1 | 1–4 | Tasks WPP + Agenda Google | MVP 1 | 19/05/2026 |
| Mês 2 | 5–8 | Respostas automáticas + Lembretes | MVP 2 | 16/06/2026 |
| Mês 3 | 9–12 | Gestão de docs no Drive | MVP 3 | 14/07/2026 |
| Mês 4 | 13–16 | Geração de ativos visuais | Lançamento | ~Ago/2026 |

## Relacionados
- [[bot-gabi]]
- [[secretaria-ai-mes2]]
- [[gabi]]
- [[amanda-coelho]]
- [[infraestrutura-tecnica]]
