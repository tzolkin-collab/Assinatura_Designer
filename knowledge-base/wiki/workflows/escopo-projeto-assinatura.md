---
title: Escopo do Projeto Assinatura
type: workflow
tags:
  - "assinatura"
  - "escopo"
  - "contrato"
  - "diagnóstico"
  - "marcelle"
  - "gabi"
sources:
  - "Diagnostico_Assinatura.docx"
  - "CONTEXTO.md"
created: 2026-04-22
updated: 2026-04-22
---

# Escopo do Projeto Assinatura

## Resumo

Contrato de prestação de serviços entre Lucas de Oliveira Lopes e Assinatura Consultoria Treinamento e Comercio Ltda, vigente desde 01/04/2026. O projeto entrega dois produtos paralelos: **Secretária A.I. (Gabi)** e **Automação de Projetos (Marcelle)**. O diagnóstico técnico foi concluído para a frente Gabriela; o da Marcelle está em andamento, com sessão presencial pendente.

## Detalhes

### Partes

| Campo | Valor |
|---|---|
| Contratante | Assinatura Consultoria Treinamento e Comercio Ltda |
| CNPJ Contratante | 33.825.369/0001-92 |
| Contratada | Lucas de Oliveira Lopes |
| CNPJ Contratada | 61.418.797/0001-36 |
| Data do Contrato | 01/04/2026 |
| Relatório de Diagnóstico | 15/04/2026 |

### Dois Produtos

| Produto | Responsável | Prazo | Período | Financeiro |
|---|---|---|---|---|
| Secretária A.I. + Designer | Gabriela (Gabi) | 4 meses | 24/03–21/07/2026 | R$ 1.200/mês × 10 parcelas |
| Automação de Projetos | Marcelle | 4 meses | 24/03–21/07/2026 | R$ 1.000/mês × 10 parcelas |

- Detalhes Gabi → [[secretaria-ai-gabi]]
- Detalhes Marcelle → [[automacao-notificacao-marcelle]]

### Status do Diagnóstico por Frente

| Frente | Status | Observação |
|---|---|---|
| Gabriela — Expansão/Assessoria | ✅ Concluído | Sessão presencial realizada. Todos os pontos mapeados. |
| Marcelle — Projetos | 🔄 Em andamento | Base levantada via Asana. Diagnóstico presencial pendente. |

### Fluxo Geral de Entrega

```
Diagnóstico (abr/2026)
  → Secretária A.I. (Gabi) — 4 meses em paralelo (24/03–21/07/2026)
  → Automação Marcelle      — 4 meses em paralelo (24/03–21/07/2026)
      ↓ ambas compartilham infraestrutura (Evolution API + EasyPanel + Postgres + Redis)
```

## Decisões Tomadas

- **Execução em paralelo:** Gabi e Marcelle rodam simultaneamente nos mesmos 4 meses — infraestrutura compartilhada sem custo adicional para nenhuma das frentes.
- **Dashboard unificado fora do escopo:** Marcelle mencionou querer "tudo em uma tela" — não está no escopo; formalizar exige UX dedicada e revisão de valor.
- **Pipeline de atas (Gabi):** Gemini estrutura diretamente → Asana (ChatGPT não está no fluxo de atas — ver `bot-gabi.md`).

## Learnings

- O diagnóstico da Marcelle foi indireto (análise do Asana); sessão presencial pendente — escopo final pode expandir.
- A base do agente designer já está construída e funcional, reduzindo risco técnico da fase final da Gabi.
- Infraestrutura compartilhada (Evolution API + EasyPanel) multiplica valor: serve ambas as frentes.

## Relacionados

- [[secretaria-ai-gabi]] — produto 1
- [[automacao-notificacao-marcelle]] — produto 2
- [[infraestrutura-tecnica]] — base técnica compartilhada
