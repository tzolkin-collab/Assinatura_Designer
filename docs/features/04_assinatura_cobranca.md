> ⚫ **ESCOPO CANCELADO (2026-07-13).** O produto não é um SaaS — não há planos, cobrança nem self-service.
> Documento mantido apenas como registro histórico. **Não implementar.** Ver `docs/ROADMAP.md`.

# Assinatura e Cobrança (Stripe / Pagamentos)

## Objetivo
Implementar o motor financeiro do SaaS para gerenciar planos (Free, Pro, Enterprise), controlar acesso a funcionalidades premium (ex: limite de uso da IA) e processar os pagamentos via Stripe.

## Alterações Propostas no `schema.prisma`

```prisma
model Subscription {
  id                   String             @id @default(uuid())
  stripeCustomerId     String             @unique
  stripeSubscriptionId String?            @unique
  stripePriceId        String?            
  plan                 PlanTier           @default(FREE)
  status               SubscriptionStatus @default(ACTIVE)
  currentPeriodStart   DateTime?
  currentPeriodEnd     DateTime?
  cancelAtPeriodEnd    Boolean            @default(false)
  
  // A assinatura pode estar vinculada ao Usuário (se for B2C) ou à Marca (B2B)
  userId               String             @unique
  user                 User               @relation(fields: [userId], references: [id], onDelete: Cascade)
}

enum PlanTier {
  FREE
  PRO
  AGENCY
}

enum SubscriptionStatus {
  ACTIVE
  PAST_DUE
  CANCELED
  INCOMPLETE
}

// (Opcional) Limites de Uso
model UsageMetrics {
  id             String   @id @default(uuid())
  brandId        String   @unique
  aiTokensUsed   Int      @default(0)
  postsGenerated Int      @default(0)
  month          DateTime // Mês de referência (ex: 2026-07-01)
}
```

## APIs Necessárias
- `POST /billing/checkout` - Gera a URL de checkout do Stripe (Stripe Checkout Session).
- `POST /billing/portal` - Gera a URL do "Customer Portal" do Stripe para o usuário mudar cartão ou cancelar.
- `POST /webhooks/stripe` - Onde o Stripe avisa nosso sistema quando o pagamento for aprovado ou recusado (atualiza o status da Subscription no banco).

## Componentes Frontend (A fazer)
- **PricingTable**: Página com os planos e botões de assinar.
- **BillingSettings**: Tela de configurações financeiras com o botão "Gerenciar Assinatura".
- **Paywall / Limit Modals**: Modais avisando que o usuário bateu o limite (ex: "Você esgotou seus designs com IA este mês, faça upgrade").
