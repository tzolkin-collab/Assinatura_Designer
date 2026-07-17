# Designer Assinatura - Diretrizes do Projeto

Este arquivo contém as diretrizes técnicas fundamentais, padrões arquiteturais e decisões de produto acordadas para o ecossistema do **Designer Assinatura**. Toda alteração no código deve respeitar rigorosamente estas regras.

---

## 🎯 Premissas de Produto e Escopo
1. **Ferramenta Interna de Contrato:** O sistema é uma ferramenta exclusiva para o contrato Assinatura. **Não é um SaaS**, não há planos, cobranças, nem fluxos de self-service.
2. **Sem Redes Sociais:** Não há publicação ou agendamento direto em redes sociais (recursos de agendamento e postagem foram cancelados).
3. **Canva como Caminho de Entrega:** O Canva Connect API é o único fluxo de entrega final, focado em **arte pronta para postar** (imagens estáticas renderizadas) enviadas via fila de processamento assíncrono. **Não há designs editáveis ou templates dinâmicos** construídos elemento por elemento via API.

---

## 🛠️ Arquitetura e Stack Técnica

### Backend (`/backend`)
- **Runtime & Framework:** Node.js, Express, TypeScript (ESM).
- **ORM & Database:** Prisma ORM com PostgreSQL.
- **Autorização e Segurança (RBAC):**
  - **Proibido** autorizar usando o campo legador `Brand.userId`.
  - **Obrigatório** usar o modelo baseado em `BrandMember` e `BrandRole` (`OWNER`, `EDITOR`, `VIEWER`).
  - Todas as rotas que exigem contexto de marca devem usar o middleware unificado `requireBrandRole`.
  - Convites de equipe devem exigir aceite e usar tokens seguros de uso único.
- **Processamento Assíncrono:** Fila com **BullMQ** e Redis para processos demorados (ex: Exportação Canva e renderização massiva).
- **Gerenciamento de Sessão:** Sessões do chat de IA salvas de forma fatiada em três chaves no Redis (`:meta`, `:messages`, `:design`) para otimização de banda de rede e performance.
- **Renderização (Puppeteer Cluster):** 
  - Utilizar isolamento de contexto (`CONCURRENCY_CONTEXT`).
  - Concorrência limitada pelo uso de memória (`RASTER_CONCURRENCY`).
  - Sempre definir timeouts estritos por página para evitar travamentos de slots.

### Frontend (`/frontend`)
- **Framework:** Next.js (com suporte para React 19, TypeScript e CSS Modules).
- **Estado Global & Editor:** Manipulação do formato intermediário de design (`DesignIR`).
- **Sistema de Edição Visual:** 
  - Painéis de edição granulares (`TransformPanel`, `MultiSelectPanel`, `TextPanel`, etc.) operam enviando patches de edição ao backend.
  - A lógica inteligente de patch de elementos fica centralizada no utilitário de mutação (`patcher.ts`).
  - O editor suporta histórico local com múltiplos passos (*Undo/Redo*) integrado com o histórico persistido de versões no backend.

---

## 🧪 Instruções de Teste e Qualidade

Sempre valide as alterações rodando a suíte de testes antes de considerar uma tarefa finalizada:

* **Testes do Backend:**
  ```bash
  cd backend
  npm test
  ```
* **Testes do Frontend:**
  ```bash
  cd frontend
  npm test
  ```
* **Higiene e Estilo:**
  - Garantir que o linter e o build passem sem erros de TypeScript (`no-explicit-any` é proibido) ou avisos que quebrem a compilação de produção (`npm run build`).
