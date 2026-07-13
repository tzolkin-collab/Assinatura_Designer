# Biblioteca de Mídia / Assets (Uploads)

## Objetivo
Criar um repositório centralizado de arquivos (imagens, fontes, vetores e vídeos) atrelados a cada marca (Brand), permitindo que os usuários façam upload de mídias próprias e reutilizem arquivos gerados ou anexados em diferentes designs e projetos sem precisarem recarregá-los repetidamente.

## Alterações Propostas no `schema.prisma`

```prisma
model Asset {
  id           String     @id @default(uuid())
  name         String
  url          String
  fileType     String     // ex: 'image/png', 'font/ttf', 'video/mp4'
  sizeBytes    Int
  width        Int?
  height       Int?
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  
  brandId      String
  brand        Brand      @relation(fields: [brandId], references: [id], onDelete: Cascade)
  
  uploadedBy   String?
  user         User?      @relation(fields: [uploadedBy], references: [id], onDelete: SetNull)

  @@index([brandId])
}

// Em Brand, adicionar: assets Asset[]
```

## APIs Necessárias
- `POST /brands/:id/assets/upload` - Recebe multipart/form-data, faz upload para o Cloudflare R2 e salva no banco.
- `GET /brands/:id/assets` - Lista todos os arquivos da marca, aceitando paginação e filtro por `fileType`.
- `DELETE /assets/:id` - Remove o asset do banco e apaga o arquivo no R2.

## Componentes Frontend (A fazer)
- **AssetManagerModal**: Um modal global de seleção de mídias que abre quando o usuário clica em "Adicionar Imagem" no editor.
- **UploaderArea**: Área de "arraste e solte" (Drag & Drop) para upar novas mídias.
- **MediaGallery**: Grid de visualização de assets na tela de configurações da marca.
