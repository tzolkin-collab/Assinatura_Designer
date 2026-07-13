# Gestão de Equipe (Múltiplos usuários por Marca)

## Objetivo
Permitir que uma marca (Brand) seja gerenciada por uma equipe em vez de um único usuário. Isso é essencial para o modelo B2B, permitindo que o dono (Admin), designers e clientes (Viewers/Approvers) acessem o mesmo workspace sem compartilhar senhas.

## Alterações Propostas no `schema.prisma`

```prisma
// Substituir a relação direta (1:N) de User -> Brand por uma relação (N:N) via tabela pivot.

model BrandMember {
  id        String       @id @default(uuid())
  role      BrandRole    @default(EDITOR)
  createdAt DateTime     @default(now())
  
  userId    String
  user      User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  brandId   String
  brand     Brand        @relation(fields: [brandId], references: [id], onDelete: Cascade)

  @@unique([userId, brandId]) // Um usuário só pode ter um vínculo por marca
  @@index([brandId])
}

enum BrandRole {
  OWNER      // Dono absoluto, pode excluir a marca e gerenciar faturamento
  ADMIN      // Pode convidar/remover membros
  EDITOR     // Pode criar e editar posts/designs (Designer)
  VIEWER     // Apenas visualiza ou aprova designs (Cliente)
}

// Em Brand, remover o `userId` direto e adicionar `members BrandMember[]`
// Em User, atualizar para `brandMemberships BrandMember[]`
```

## APIs Necessárias
- `POST /brands/:id/members/invite` - Envia email de convite para a marca ou adiciona direto se o usuário já existir.
- `GET /brands/:id/members` - Lista a equipe vinculada.
- `PATCH /brands/:id/members/:userId` - Altera a role (permissão) de um membro.
- `DELETE /brands/:id/members/:userId` - Remove o membro da marca.

## Componentes Frontend (A fazer)
- **TeamSettingsPage**: Tela na aba de configurações da marca listando os membros.
- **InviteModal**: Componente para digitar e-mails e selecionar cargos (`Role`).
- **RoleGuard (HOC)**: Componente/Middleware no Frontend e Backend para bloquear ações destrutivas se o usuário for apenas `VIEWER`.
