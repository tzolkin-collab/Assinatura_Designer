# Documentação Técnica — Designer Assinatura

Este documento detalha as decisões de engenharia, arquitetura de sistemas, modelagem de segurança (RBAC) e padrões de desenvolvimento que regem o ecossistema do **Designer Assinatura**. Ele serve como guia de referência para engenheiros, desenvolvedores e administradores de infraestrutura do projeto.

---

## 1. Arquitetura e Stack Tecnológica

O sistema é estruturado como um monorepo modular composto por duas partes principais integradas por APIs REST e WebSockets, utilizando serviços externos de banco de dados, cache e armazenamento:

```
                  ┌─────────────────────────────┐
                  │          FRONTEND           │
                  │   Next.js (React 19, TS)    │
                  └──────────────┬──────────────┘
                                 │
                         HTTPS / WebSockets
                                 │
                                 ▼
                  ┌─────────────────────────────┐
                  │           BACKEND           │
                  │     Node.js Express ESM    │
                  └──────────────┬──────────────┘
                                 │
         ┌───────────────────────┼──────────────────────┐
         ▼                       ▼                      ▼
┌─────────────────┐     ┌─────────────────┐    ┌─────────────────┐
│ BANCO DE DADOS  │     │ CACHE & QUEUES  │    │ OBJECT STORAGE  │
│  PostgreSQL     │     │  Redis / BullMQ │    │  Cloudflare R2  │
│  (Prisma ORM)   │     └─────────────────┘    └─────────────────┘
└─────────────────┘
```

### Tecnologias Core:
1. **Frontend (`/frontend`):** Next.js (utilizando o App Router, TypeScript, React 19 e CSS Modules). Gerenciamento de estado local para interações em tempo real com o Canvas e reidratação do chat via WebSocket.
2. **Backend (`/backend`):** Node.js rodando com suporte nativo a ESM (ECMAScript Modules), Express e TypeScript.
3. **Persistência de Dados:** PostgreSQL orquestrado com o Prisma ORM.
4. **Cache & Filas:** Redis e BullMQ para processamento de filas assíncronas (como renderização massiva e exportação para o Canva).
5. **Storage:** Cloudflare R2 (API S3 compatível) para armazenamento durável de mídias de marcas (Assets) e arquivos temporários.
6. **Renderização Gráfica:** Cluster gerenciado do Puppeteer (Chromium headless) no servidor para rasterização de imagens.

---

## 2. Modelo de Segurança e Isolamento (RBAC)

O Designer é um sistema **multitenant** corporativo de uso interno. Para evitar vazamentos de dados entre inquilinos (*cross-tenant data leaks*), o isolamento de acessos no banco e nas rotas de API segue regras estritas.

### O Modelo `BrandMember`
A propriedade direta de marcas pelo campo legado `Brand.userId` foi **totalmente descontinuada**. Todo o controle de acesso é baseado na tabela pivot `BrandMember` e no respectivo enum de privilégios `BrandRole`:

- **`OWNER`**: Dono absoluto. Possui controle de faturamento, exclusão de marca e controle de equipe.
- **`ADMIN`**: Administrador de equipe. Pode convidar novos membros, mudar privilégios e gerenciar mídias/designs.
- **`EDITOR`**: Usuário operacional (designer). Cria novos posts, edita o canvas e exporta para o Canva.
- **`VIEWER`**: Acesso de leitura (cliente). Visualiza designs e galerias, aprova ou solicita revisões, mas é impedido de realizar edições diretas ou modificações destrutivas.

### Middleware Unificado de Autorização
Toda rota no backend que interage sob o escopo de uma marca deve obrigatoriamente validar o acesso usando o middleware `requireBrandRole`.
- O middleware extrai a relação do usuário com a marca (`brandId` / `brandSlug`).
- Qualquer requisição feita por um usuário sem relacionamento ativo com a marca retornará HTTP `403 Forbidden`.
- O ID da marca resolvido pelo middleware é repassado estritamente para as queries do Prisma:
  ```typescript
  // Exemplo de isolamento obrigatório em consultas
  const posts = await prisma.post.findMany({
    where: {
      brandId: currentBrandId, // Isolamento estrito
    }
  });
  ```

### Segurança em Convites
O fluxo de convite de equipe utiliza tokens criptográficos de uso único, com data de expiração rápida, armazenados na tabela `BrandInvite`. O link gerado exige o aceite explícito do convidado no frontend antes de vincular a conta na tabela `BrandMember`.

---

## 3. Formato Intermediário de Design (DesignIR) e Editor

Para evitar a manipulação instável de HTML/CSS cru pela IA e no frontend, o sistema implementa um formato declarativo chamado **DesignIR** (Design Intermediate Representation).

### Estrutura Declarativa
O `DesignIR` define um slide como um array de elementos posicionados estruturalmente (composto por caixas de texto, formas geométricas, imagens e vetores).
- Cada elemento possui propriedades específicas de transformação (`x`, `y`, `width`, `height`, `rotation`), estilos (`fill`, `stroke`, `opacity`, `shadow`) e conteúdo.
- O frontend consome essa especificação reativamente no componente `IRSlideRenderer` (`frontend/src/components/DesignDocument/IRSlideRenderer.tsx`), desenhando as caixas correspondentes e anexando os controles de manipulação e redimensionamento interativos.

### Mutação por Patches
Ao invés de trafegar o JSON completo do deck a cada movimento no editor, as edições são compiladas em **patches de mutação incrementais** (`frontend/src/lib/designIR/patcher.ts`).
- Modificações de posição, cor ou texto geram um patch direcionado contendo as novas propriedades do elemento.
- No backend, o motor `lib/designIR/aiPatch.ts` aplica o patch ao modelo principal e incrementa o histórico.
- Isso viabiliza:
  1. Operações de **Undo/Redo** locais em memória rápidos.
  2. Salvamento histórico persistente de grandes alterações no banco usando `PostVersion`.
  3. Previews de "Aceitar/Descartar" modificações propostas via IA.

---

## 4. Pipeline de Agentes de IA (Manager-Worker) e Custo

A geração e modificação inteligente de designs no Designer Assinatura utiliza um modelo estruturado de orquestração de IA para reduzir latência e custos computacionais.

### Funcionamento do Pipeline Manager-Worker
A geração de decks extensos é dividida em dois papéis distintos:
1. **Manager (Gemini Pro):** É o cérebro conceitual. Ele lê o briefing (prompt), aplica as diretrizes visuais do *Brand Book* e planeja a estrutura global da apresentação em formato JSON estruturado (Slide Skeleton).
2. **Worker (Gemini Flash):** Executa o trabalho de layout em segundo plano. Ele consome a fila no Redis e popula os slides um a um, aplicando cópias de texto detalhadas, estilos e posicionamento de elementos sob o padrão `DesignIR`.

### Mecanismos de Resiliência da IA
Para evitar travamento de filas de processamento devido a instabilidades na API do Google Gemini, o backend adota:
- **Controle de Timeout por Modelo:** Timeouts estritos são definidos por tentativa baseando-se no peso do modelo (25s para modelos Flash, 150s para modelos Pro).
- **Mecanismo de Circuit Breaker (Disjuntor):** Monitora falhas consecutivas de rede ou lentidão extrema dos modelos de IA. Se duas tentativas falharem consecutivas em uma janela de 5 minutos, o modelo entra em cooldown de 3 minutos, promovendo um fallback automático para o próximo modelo disponível.
- **Retry com Fallback:** Se uma requisição de IA falha por instabilidade (ex: erro 503 do Gemini), o pipeline tenta novamente promovendo a chamada de forma transparente.

### Guardrails e Auditoria de Custos de IA
- Cada chamada à API do Gemini tem seu consumo em tokens exato persistido no banco de dados (`AiUsage`).
- O backend monitora o teto diário de tokens permitidos por marca. Se a marca atinge o limite diário de tokens, novas solicitações na Fábrica de IA são bloqueadas.
- O frontend busca essas métricas estruturadas pelo endpoint `GET /brands/:slug/ai-usage` para plotar os dashboards de faturamento por modelo em tempo real.

---

## 5. Otimização de Sessões de Chat (Redis)

Nas versões anteriores do projeto, toda mensagem de chat causava tráfego excessivo ao ler e salvar dados brutos em uma única chave de string do Redis. Para decks gigantescos (acima de 200 slides), o payload de tráfego de rede estourava a CPU do Redis.

### Fatiamento de Chaves de Sessão
O backend implementa o **Fatiamento de Sessão de Chat**. Cada sessão de chat ativa possui chaves divididas no Redis (prefixadas com `:v2` para evitar colisão com chaves incompatíveis legadas):
1. **`:meta` (Redis HASH):** Metadados curtos da sessão (título, marca dona, status, configurações).
2. **`:messages` (Redis LIST):** Linha do tempo de mensagens. Adições utilizam operações `RPUSH` atômicas de complexidade $O(1)$.
3. **`:design` (Redis STRING):** O payload completo do design (`DesignIR`). Esta chave só é lida ou gravada quando há uma mudança estrutural nas caixas ou slides.

### Reidratação Automática
Para evitar o consumo persistente de RAM do Redis, as chaves de sessão possuem um tempo de vida (TTL) de 24 horas. Se uma sessão expira do cache Redis, o backend intercepta a conexão e reidrata a sessão a partir do banco PostgreSQL de forma transparente ao usuário.

---

## 6. Fila de Exportação Canva e Renderização

A Canva Connect API não aceita estruturas flexíveis criadas elemento por elemento. A única entrega de arte suportada pela API do Canva de forma consistente é a injeção de imagens estáticas renderizadas de alta qualidade.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Solicitação │ ──► │ Fila BullMQ  │ ──► │  Puppeteer   │ ──► │ Cloudflare R2│
│  no Editor   │     │   (Redis)    │     │  (raster.ts) │     │ (Storage S3) │
└──────────────┘     └──────────────┘     └──────┬───────┘     └──────┬───────┘
                                                 │                    │
                                                 ▼                    ▼
                                          ┌──────────────┐     ┌──────────────┐
                                          │ Canva API    │ ──► │ Design Pronto│
                                          │ OAuth/Upload │     │  no Canva    │
                                          └──────────────┘     └──────────────┘
```

### Processamento por Fila (BullMQ)
Toda a renderização e upload das páginas é delegada para os workers do BullMQ. O request HTTP de exportação encerra imediatamente após colocar o Job na fila, devolvendo um ID para o frontend acompanhar o progresso via canal WebSocket.

### Cluster de Puppeteer e Rasterização (`raster.ts`)
A geração das imagens estáticas ocorre no servidor:
- O módulo `raster.ts` utiliza **Puppeteer Cluster** com isolamento por contexto (`CONCURRENCY_CONTEXT`). Isso evita a sobrecarga de iniciar múltiplos browsers Chromium na mesma CPU.
- A concorrência máxima de renderizações simultâneas é regulada dinamicamente com base na memória disponível no servidor (`RASTER_CONCURRENCY`).
- São definidos timeouts estritos por página no Puppeteer para evitar travamento de slots por scripts órfãos.
- As imagens geradas são salvas no Cloudflare R2 e enviadas para o Canva Connect API através de requests autenticados pelo token OAuth 2.0 PKCE do usuário logado.

---

## 7. Padrões de Desenvolvimento e Governança

Ao dar manutenção no código-fonte, os seguintes padrões arquiteturais devem ser mantidos sem exceção:

1. **Importações ESM no Backend:**
   - O backend roda estritamente sob módulos ECMAScript (ESM). Todos os caminhos de importação locais internos **devem obrigatoriamente incluir a extensão do arquivo** (ex: `import { prisma } from './lib/prisma.js';`).
2. **Qualidade de Tipagem TypeScript:**
   - É proibido desligar validações do linter ou utilizar declarações de tipo `any` / `@ts-ignore` para contornar verificações do compilador. O build de produção deve rodar limpo (`tsc --noEmit`).
3. **Gerenciamento de Banco e Migrations:**
   - Nunca utilize `prisma db push` em ambientes de desenvolvimento que reflitam alterações globais ou de produção. Todas as modificações no `schema.prisma` devem gerar uma migration estruturada na pasta `prisma/migrations` via `prisma migrate dev` para manter a integridade dos schemas do banco e evitar drift.
4. **Isolamento de Testes:**
   - Sempre execute a suíte de testes de integração (`npm test` no frontend e backend) após qualquer refatoração para garantir a integridade do isolamento cross-tenant e rotas RBAC.
