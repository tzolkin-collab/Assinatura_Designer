---
title: Infraestrutura Técnica Atual
type: integration
tags:
  - "asana"
  - "whatsapp"
  - "evolution-api"
  - "easypanel"
  - "gemini"
  - "chatgpt"
  - "agente-designer"
  - "infraestrutura"
sources:
  - "Diagnostico_Assinatura.docx"
created: 2026-04-22
updated: 2026-04-22
---

# Infraestrutura Técnica Atual

## Resumo

Estado da infraestrutura técnica levantada durante o diagnóstico (abril 2026). Asana API e WhatsApp via Evolution API já estão operacionais. O Agente Designer tem base funcional, aguardando integração completa. O Agente Marcelle ainda não foi iniciado — aguarda conclusão da Secretária A.I.

## Detalhes

### Status por Componente (referência: 15/04/2026 — verificar atualizações)

| Componente | Status | Observação |
|---|---|---|
| Asana API | ✅ Concluído | Integração ativa — criação de tasks via API funcionando |
| WhatsApp + Evolution API | ✅ Concluído | Integrado e operacional via EasyPanel |
| Agente Designer | 🔄 Em andamento | Base funcional; Sprint 0 concluído em 25/04; gaps residuais em revisão |
| Automação Marcelle | ⚠️ Verificar | Prazo 21/04/2026 vencido — status de entrega não confirmado nesta KB |

### Componentes e Papéis

| Componente | Papel |
|---|---|
| **Asana API** | Criação e atualização de tasks; base de todos os flows de automação |
| **WhatsApp + Evolution API** | Canal principal de comunicação dos agentes |
| **EasyPanel** | Plataforma de hospedagem dos serviços de backend |
| **Gemini** | LLM para geração de atas de reunião (input do pipeline) |
| **ChatGPT** | Lapidação dos pontos gerados pelo Gemini antes de publicar no Asana |
| **Agente Designer** | Geração autônoma de apresentações e artes (UX externa ao WhatsApp) |

### Pipeline de Atas (dois caminhos)

> ⚠️ CONFLITO RESOLVIDO: documentos de escopo descreviam "Gemini → ChatGPT → Asana". O código real (`bot-gabi.md`) confirma que ChatGPT **não participa** do pipeline de atas — Gemini estrutura e publica direto no Asana. ChatGPT é usado apenas para chat geral e classificação de intenção.

```
Caminho Automático (implementação real):
  Reunião → Gemini (estrutura a ata) → Asana (seção Reuniões Mensais) → PostgreSQL

Caminho Semi-manual:
  Reunião → Gabi puxa do Gemini → envia por WhatsApp → automação → Asana
```

## Decisões Tomadas

- Evolution API via EasyPanel escolhida para WhatsApp — já operacional e estável.
- Pipeline de atas usa dois LLMs: Gemini gera, ChatGPT lapida — trade-off de latência por qualidade de output.
- Infraestrutura compartilhada entre Gabi e Marcelle — sem custo adicional para o segundo agente.

## Learnings

- A infraestrutura compartilhada (Evolution API + EasyPanel) multiplica valor: serve ambas as frentes sem custo adicional.
- O pipeline Gemini → ChatGPT adiciona uma chamada de API extra — monitorar custo operacional ao escalar.

## Relacionados

- [[secretaria-ai-gabi]] — consumidora principal desta infraestrutura
- [[automacao-notificacao-marcelle]] — reutilizará após conclusão da Gabi
- [[escopo-projeto-assinatura]] — contexto geral do projeto
