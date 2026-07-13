# Histórico e Controle de Versão (Undo/Redo & Snapshots)

## Objetivo
Garantir segurança na edição. Permitir que o usuário e a IA façam alterações nos designs (Slides e Posts) sem o risco de perder configurações passadas. Cria um sistema de "Undo/Redo" persistente e de aprovação de versões de IA.

## Alterações Propostas no `schema.prisma`

```prisma
model SlideVersion {
  id            String   @id @default(uuid())
  slideId       String
  slide         Slide    @relation(fields: [slideId], references: [id], onDelete: Cascade)
  
  contentJson   Json     // O estado do slide naquele momento
  htmlRender    String?  @db.Text
  
  createdAt     DateTime @default(now())
  createdBy     String?  // Pode ser o ID de um User ou "AI"
  description   String?  // Ex: "Gerado pela IA (Prompt: Crie um título azul)"
  
  @@index([slideId])
}

// Na tabela Slide original, adicionar:
// versions SlideVersion[]
```

## APIs Necessárias
- `POST /slides/:id/versions` - Salva um novo snapshot na linha do tempo do slide.
- `GET /slides/:id/versions` - Retorna a lista de snapshots históricos.
- `POST /slides/:id/restore/:versionId` - Copia o `contentJson` do snapshot de volta para a tabela principal do Slide.

## Componentes Frontend (A fazer)
- **HistoryPanel**: Um painel lateral no Editor mostrando a linha do tempo de modificações (como no Figma ou Google Docs).
- **AIAcceptReject**: Quando a IA modificar o slide, em vez de salvar diretamente, cria uma versão temporária mostrando a diferença e botões para o usuário "Aceitar" ou "Descartar".
- **Undo/Redo Global State**: No editor, manter os estados curtos em memória (Zustand/Context), mas salvar os "grandes passos" ou gerações de IA como versões no banco (Debounce save).
