---
title: Galeria — Gestão de Ativos e Pastas
type: feature
tags:
  - "galeria"
  - "assets"
  - "drag-and-drop"
  - "management"
status: stable
created: 2026-04-27
updated: 2026-04-27
---

# 🎨 Galeria — Gestão de Ativos e Pastas

A Galeria evoluiu de uma simples lista de visualização para um gerenciador de ativos robusto com suporte a manipulação direta e organização hierárquica.

## 🖱️ Drag-and-Drop (DND)
Implementamos um sistema de arrastar e soltar para organização de artes:
- **Origem**: Cards de artes (`postCard`).
- **Destino**: Pastas (`folderCard`).
- **Feedback**: As pastas mudam de cor (`folderCardDragOver`) ao receber um item.
- **Restrições**:
    - Não é permitido drop em "Todas as Artes" (filtro global).
    - Não é permitido drop na mesma pasta onde o item já reside.
    - Drop em "Sem Pasta" move o item para `folderId: null`.

## 🗑️ Gestão de Exclusão
Adicionamos suporte completo para limpeza de ativos:
- **Artes**: Botão de exclusão rápida no card e no modal de preview. Aciona `DELETE /api/posts/:id`.
- **Pastas**: Botão de exclusão na lista de pastas.
- **UX**: Confirmação via `confirm()` antes de ações destrutivas.

## 🔄 Sincronização de Estado
Uso do padrão de **Mutação SWR-like** (via `mutate` no `useBrandPosts`):
- As ações de mover e excluir atualizam a UI instantaneamente sem reload da página.
- O preview em tela cheia é fechado automaticamente se a arte for excluída.

## 🛠️ API & Backend
Novas implementações:
- `DELETE /api/posts/:id`: Remoção física do registro no Prisma.
- `PUT /api/posts/:id`: Atualizado para suportar troca de `folderId`.

## 📁 Arquivos Relacionados
- Frontend: `src/app/[marca]/galeria/page.tsx`, `src/app/[marca]/galeria/brand-galeria.module.css`
- Backend: `src/routes/posts.ts`
- Hooks: `src/lib/hooks.ts` (adicionado suporte a `mutate`)

## ✅ Status
- [x] Drag-and-Drop de arquivos para pastas
- [x] Exclusão de artes (Frontend + Backend)
- [x] Atualização de UI sem reload
- [x] Prevenção de drops redundantes
