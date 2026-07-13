> ⚫ **ESCOPO CANCELADO (2026-07-13).** O produto não publica em redes sociais — a única saída é o export
> para o Canva. Documento mantido apenas como registro histórico. **Não implementar.** Ver `docs/ROADMAP.md`.

# Agendamento e Publicação (Redes Sociais)

## Objetivo
Tornar a plataforma um hub completo, não apenas para gerar os designs, mas para distribuir. Permitirá que os posts criados pela IA ou pelo usuário sejam agendados para publicação automática no Instagram, Facebook, LinkedIn, etc.

## Alterações Propostas no `schema.prisma`

```prisma
model SocialIntegration {
  id             String    @id @default(uuid())
  platform       Platform  // INSTAGRAM, LINKEDIN, FACEBOOK
  accessToken    String
  refreshToken   String?
  tokenExpiresAt DateTime?
  externalAccountId String // ID da conta lá na rede social
  accountName    String    // Nome de exibição (ex: @tzolkin.ia)
  
  brandId        String
  brand          Brand     @relation(fields: [brandId], references: [id], onDelete: Cascade)

  @@index([brandId])
}

enum Platform {
  INSTAGRAM
  FACEBOOK
  LINKEDIN
}

// Alterações na tabela Post atual:
model Post {
  // ... campos existentes ...
  
  caption        String?   @db.Text // Legenda do post para a rede social
  scheduledFor   DateTime? // Data e hora programada para publicação
  publishedAt    DateTime? // Quando realmente foi publicado
  publishStatus  PublishStatus @default(UNPUBLISHED)
  socialError    String?   // Guarda erro caso a publicação falhe
}

enum PublishStatus {
  UNPUBLISHED
  SCHEDULED
  PUBLISHED
  FAILED
}
```

## APIs Necessárias
- `GET /brands/:id/social-auth/:platform` - Inicia fluxo OAuth (ex: Facebook Login).
- `POST /posts/:id/schedule` - Define a data (`scheduledFor`) e muda o status.
- **CRON JOB (Backend)**: Um worker (ex: node-cron ou BullMQ) rodando a cada minuto buscando `WHERE scheduledFor <= NOW() AND publishStatus = SCHEDULED` para disparar as APIs do Instagram/LinkedIn.

## Componentes Frontend (A fazer)
- **PublishDialog**: Modal no editor que mostra a legenda gerada pela IA, pré-visualização e um DatePicker para escolher a data.
- **CalendarView**: Uma nova página (Calendário) para visualizar todos os posts agendados do mês.
- **SocialAccountsSetup**: Página nas configurações da marca com botões "Conectar com Instagram", etc.
