---
title: "Integração Stripe — Webhook e Rastreamento de Pagamentos"
type: integration
tags:
  - "stripe"
  - "webhook"
  - "pagamentos"
  - "utm"
  - "capi"
  - "facebook"
  - "tiktok"
  - "tracking"
sources: []
created: 2026-05-03
updated: 2026-05-03
---

# Integração Stripe — Webhook e Rastreamento de Pagamentos

## Resumo

O projeto usa Stripe como gateway de pagamentos para os contratos mensais (Gabi e Marcelle via parcelas). Um webhook Stripe foi configurado para capturar eventos de pagamento e acionar rastreamento de conversões (Purchase) para Facebook CAPI e TikTok CAPI. Problema histórico: evento Purchase sendo disparado em duplicata (frontend + webhook simultâneos).

## Detalhes

### Componentes

| Componente | Status | Observação |
|---|---|---|
| Stripe Checkout | ✅ Ativo | Gateway principal de pagamentos |
| Webhook `payment_intent.succeeded` | ✅ Configurado | Dispara Purchase no backend |
| Facebook CAPI | ⚠️ Verificar credenciais | Integração configurada, mas credenciais do backend pendentes |
| TikTok CAPI | ⚠️ Falha em troubleshooting | Integração iniciada — falha de autenticação reportada |
| UTM tracking no checkout | ❌ Não implementado | UTM params não estão sendo passados no flow de pagamento |

### Fluxo de Pagamento

```
Cliente → Stripe Checkout
  → payment_intent.succeeded (webhook)
      → Backend processa evento
          → Facebook CAPI: Purchase event
          → TikTok CAPI: Purchase event
          → Salva em PostgreSQL
```

### Problema Histórico: Duplicate Purchase Event

> ⚠️ **Bug resolvido (02/05/2026):** O evento "Purchase" estava sendo disparado duas vezes — uma vez pelo endpoint de tracking do frontend e uma vez pelo webhook Stripe. Decisão: **Purchase é responsabilidade exclusiva do webhook Stripe**. Frontend não deve disparar Purchase independentemente.

### UTM Tracking — Gap identificado

UTM parameters não estão sendo capturados no momento do checkout. Consequência: não é possível atribuir vendas a campanhas específicas no Facebook/TikTok Ads. 

**Recomendação pendente:** Passar UTM params como metadata no PaymentIntent no momento da criação do checkout, para que o webhook possa lê-los e enviá-los ao CAPI.

### Clientes / Subscriptions

| Produto | Valor | Parcelas | Gateway |
|---|---|---|---|
| Secretária A.I. (Gabi) | R$ 1.200/mês | × 10 | Mercado Pago (⚠️ confirmar juros) |
| Automação Marcelle | R$ 1.000/mês | × 10 | Mercado Pago (⚠️ confirmar juros) |

> **Nota:** Pagamentos mensais dos contratos são via Mercado Pago (parcelamento). Stripe pode ser usado para outros produtos/serviços da Assinatura. Confirmar escopo exato com Amanda.

## Decisões Tomadas

- **Purchase via webhook apenas** — elimina duplicata; garante que o evento só dispara após confirmação real de pagamento.
- **UTM no PaymentIntent metadata** — decisão pendente de implementação; necessário para atribuição de marketing.

## Learnings

- Nunca disparar eventos de conversão de dois pontos independentes (frontend + backend) sem deduplicação por `event_id`.
- Stripe webhook requer validação de assinatura (`stripe.webhooks.constructEvent`) — sem ela, qualquer POST pode acionar o handler.

## Relacionados

- [[escopo-projeto-assinatura]] — contexto financeiro
- [[secretaria-ai-gabi]] — produto associado
- [[automacao-notificacao-marcelle]] — produto associado
