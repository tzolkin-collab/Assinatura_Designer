---
title: "Canva Connect API — Integração"
type: integration
tags:
  - "canva"
  - "api"
  - "oauth"
  - "assets"
  - "autofill"
  - "export"
  - "design"
sources:
  - "https://www.canva.dev/docs/connect/"
created: 2026-05-05
updated: 2026-05-05
status: planejado
---

# Canva Connect API — Integração

## Resumo

Integração com a Canva Connect API para substituir o CanvasEditor próprio (react-rnd + html-to-image). O Canva assume 100% da edição visual e exportação, enquanto o nosso sistema mantém orquestração (geração de conteúdo via IA, galeria, fluxo de criação). Decisão registrada em [[adr-005-canva-api-migração]].

## Detalhes

### Endpoints Canva que serão utilizados

| Endpoint | Método | Função no Sistema | Sprint |
|---|---|---|---|
| `/v1/oauth/authorize` | GET | Início do fluxo OAuth2 — conectar conta Canva da marca | 1 |
| `/v1/oauth/token` | POST | Trocar code por access_token + refresh_token | 1 |
| `/v1/users/me` | GET | Verificar identidade do usuário conectado | 1 |
| `/v1/asset-uploads` | POST | Upload de imagem gerada (Pollinations/Gemini) para galeria Canva | 2 |
| `/v1/asset-uploads/:jobId` | GET | Polling status do upload (assíncrono) | 2 |
| `/v1/exports` | POST | Exportar design como PNG/JPG/PDF/MP4 | 2 |
| `/v1/exports/:exportId` | GET | Polling status + URL de download | 2 |
| `/v1/designs` | POST | Criar design em branco ou a partir de template | 3 |
| `/v1/designs/:designId` | GET | Buscar metadados de um design | 3 |
| `/v1/autofills` | POST | Preencher template Canva com dados dinâmicos (texto, imagens) | 4 |
| `/v1/autofills/:jobId` | GET | Polling status do autofill | 4 |
| `/v1/folders` | GET/POST | Listar/criar pastas na conta Canva | 4 |

### Autenticação — OAuth2

- Fluxo: Authorization Code Grant
- Scopes necessários: `design:content:read`, `design:content:write`, `asset:read`, `asset:write`, `folder:read`, `folder:write`
- Tokens armazenados no model `CanvaIntegration` (Prisma)
- Refresh automático quando `tokenExpiresAt < now()`

### ENVs Novas

```env
CANVA_CLIENT_ID=xxx        # App ID do Canva Developer Portal
CANVA_CLIENT_SECRET=xxx    # App Secret
CANVA_REDIRECT_URI=http://localhost:4000/api/canva/callback
```

### Model Prisma Novo

```prisma
model CanvaIntegration {
  id                String   @id @default(uuid())
  brandId           String   @unique
  brand             Brand    @relation(fields: [brandId], references: [id], onDelete: Cascade)
  canvaAccessToken  String   @db.Text
  canvaRefreshToken String   @db.Text
  canvaUserId       String?
  tokenExpiresAt    DateTime
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

### Campos Novos no Post

```prisma
model Post {
  // ... campos existentes
  canvaDesignId   String?  // ID do design no Canva (ex: DAF...)
  canvaExportUrl  String?  // URL da última exportação
}
```

### Arquivos Novos (Backend)

| Arquivo | Função |
|---|---|
| `src/routes/canva.ts` | Rotas OAuth callback, proxy export, asset upload |
| `src/lib/canvaClient.ts` | Wrapper REST da Canva API (fetch + token refresh) |
| `src/middleware/canvaAuth.ts` | Middleware que verifica se marca tem Canva conectado |

### Arquivos Novos (Frontend)

| Arquivo | Função |
|---|---|
| `app/[marca]/configuracoes/canva/page.tsx` | Tela de conexão OAuth com Canva |
| `components/Canva/CanvaButton.tsx` | Botão "Editar no Canva" (redirect/embed) |
| `lib/canva.ts` | Helpers para URLs e estados do Canva |

### Fluxo de Autofill (Geração IA → Template Canva)

1. Nano Banana gera **conteúdo textual** (títulos, bullets, calls-to-action) — não mais JSON de layers
2. Backend chama `POST /v1/autofills` com `{ brand_template_id, data: { title, subtitle, body, ... } }`
3. Canva preenche template profissional com conteúdo gerado pela IA
4. Resultado: design profissional + conteúdo inteligente
5. Usuário pode editar no Canva se quiser ajustes

### Limitações Conhecidas

- **Canva Enterprise** necessário para integrações privadas — MVP usa modo dev (até 25 testers)
- **Assets API** aceita apenas formatos de mídia (JPEG, PNG, WEBP, SVG, MP4) com max 50MB
- **Sem CDN própria** — Canva não fornece URLs públicas permanentes; usar R2 para servir no frontend
- **Rate limits** — API tem limites por minuto; implementar retry com backoff exponencial

## Status de Implementação

| Sprint | Escopo | Status |
|---|---|---|
| 1 | Infraestrutura OAuth + Canva Client | ⏳ Planejado |
| 2 | Upload Assets + Galeria + Export | ⏳ Planejado |
| 3 | Editor Canva Embutido | ⏳ Planejado |
| 4 | Autofill + Templates + Migração de dados | ⏳ Planejado |

## Decisões Tomadas

- **Autofill com templates** preferido sobre design-from-scratch — maior qualidade visual com menor esforço do usuário
- **R2 como CDN** para servir imagens no frontend — Canva não fornece URLs públicas; R2 resolve
- **OAuth por marca** (não por usuário) — `CanvaIntegration` ligado a `Brand`, não a `User`

## Relacionados

- [[adr-005-canva-api-migração]]
- [[designer-frontend]]
- [[designer-backend]]
- [[agente-designer]]
